import { readFileSync } from 'node:fs'
import {
	CreateTokenInput,
	DISPLAY_MAX_FRAME,
	DisplayClientMessage,
	DisplayHardwareId,
	DisplayTemplate,
	DisplayValues,
	encodeBase64,
} from '@atekos/shared'
import { describe, expect, it } from 'vitest'

const example = (name: string) =>
	JSON.parse(readFileSync(new URL(`../../../docs/metadisplay/examples/${name}`, import.meta.url), 'utf8'))
const goal = example('goal-template.json')
const displayId = '7b1e2c4a-1111-4222-8333-944455556666'
// 2×2 en RLE: un tramo de 4 píxeles rojos
const image = {
	type: 'image',
	x: 0,
	y: 0,
	w: 2,
	h: 2,
	encoding: 'rgb565-rle',
	data: encodeBase64(Uint8Array.of(3, 0xf8, 0)),
}
const circle = { type: 'circle', x: 50, y: 50, r: 10 }
const rule = (set: object) => ({ key: 'a', op: 'truthy', set })
const button = (id: string) => ({ id, trigger: 'button', button: 0, mode: 'remote' })

describe('esquemas MetaDisplay', () => {
	it('aceptan los ejemplos del contrato', () => {
		expect(DisplayTemplate.safeParse(goal).success).toBe(true)
		expect(DisplayTemplate.safeParse(example('status-template.json')).success).toBe(true)
		expect(DisplayValues.safeParse(example('goal-data.json')).success).toBe(true)
		expect(JSON.stringify({ type: 'template.set', template: goal }).length).toBeLessThan(DISPLAY_MAX_FRAME)
		expect(DisplayTemplate.safeParse(example('showcase-template.json')).success).toBe(true)
	})

	it('aceptan lo nuevo de la 1.1: horizontal, formas, imagen, capa dinámica, animación y botones', () => {
		const t = DisplayTemplate.safeParse({
			...goal,
			rotation: 90,
			elements: [
				{ type: 'text', x: 300, y: 160, format: '{a}' },
				{ ...circle, stroke: 3, binds: { r: 'radio', visible: 'ver' }, when: [rule({ color: '#FF0000' })] },
				{
					type: 'polygon',
					points: [
						[0, 0],
						[319, 171],
						[0, 171],
					],
					filled: true,
					closed: true,
				},
				{
					type: 'curve',
					points: [
						[0, 0],
						[100, 100],
						[200, 0],
						[319, 50],
					],
					stroke: 2,
				},
				{ type: 'arc', x: 100, y: 80, r: 50, start: -90, end: 180 },
				{ type: 'ellipse', x: 160, y: 86, rx: 100, ry: 40 },
				{ type: 'line', x: 0, y: 0, x2: 319, y2: 171, stroke: 32 },
				image,
			],
			animation: {
				frames: [
					{ ms: 200, elements: [circle] },
					{ ms: 200, elements: [] },
				],
				repeat: 3,
			},
			actions: [
				{ ...goal.actions[0], x: 200, y: 100, w: 120, h: 72 },
				{ ...button('a'), payload: { estado: 'ON' } },
				{ ...button('b'), press: 'long', x: 0, y: 0, w: 10, h: 10 },
				{ ...button('c'), button: 15 },
			],
			params: { a: { type: 'string', default: 'hola', description: 'Saludo' }, n: { type: 'number', min: 0, max: 9 } },
		})
		expect(t.error?.issues ?? []).toEqual([])
		// sin límite de elementos ni de acciones: manda el tope de bytes
		expect(
			DisplayTemplate.safeParse({ ...goal, elements: Array.from({ length: 500 }, () => goal.elements[0]) }).success,
		).toBe(true)
		// en vertical, lo mismo se sale
		expect(DisplayTemplate.safeParse({ ...goal, elements: [{ type: 'text', x: 300, y: 1, value: 'a' }] }).success).toBe(
			false,
		)
	})

	it('normalizan el id de hardware y rechazan formatos inválidos', () => {
		expect(DisplayHardwareId.parse('md-34b7da01abcd')).toBe('md-34B7DA01ABCD')
		expect(DisplayHardwareId.safeParse('md-123').success).toBe(false)
		expect(DisplayHardwareId.safeParse('xx-34B7DA01ABCD').success).toBe(false)
	})

	it.each([
		['un rect que se sale de 172', { elements: [{ type: 'rect', x: 100, y: 0, w: 100, h: 10 }] }],
		['un text sin value ni bind', { elements: [{ type: 'text', x: 1, y: 1 }] }],
		['un tipo de elemento desconocido', { elements: [{ type: 'sprite', x: 1, y: 1 }] }],
		['un color que no es #RRGGBB', { elements: [{ type: 'line', x: 0, y: 0, x2: 1, y2: 1, color: 'red' }] }],
		['ids de acción repetidos', { actions: [goal.actions[0], goal.actions[0]] }],
		['una zona táctil fuera de 320', { actions: [{ ...goal.actions[0], y: 300, h: 40 }] }],
		['un x de 300 en vertical', { elements: [{ type: 'text', x: 300, y: 1, value: 'a' }] }],
		['un círculo que se sale', { elements: [{ type: 'circle', x: 5, y: 50, r: 10 }] }],
		[
			'un polígono con un punto fuera',
			{
				elements: [
					{
						type: 'polygon',
						points: [
							[0, 0],
							[10, 330],
						],
					},
				],
			},
		],
		[
			'una curva de 2 puntos',
			{
				elements: [
					{
						type: 'curve',
						points: [
							[0, 0],
							[10, 10],
						],
					},
				],
			},
		],
		['un grosor de 0', { elements: [{ type: 'line', x: 0, y: 0, x2: 9, y2: 9, stroke: 0 }] }],
		['una imagen con menos píxeles de los que dice', { elements: [{ ...image, w: 3 }] }],
		['una imagen que no es base64', { elements: [{ ...image, data: '!!!!' }] }],
		['binds a una propiedad que el tipo no tiene', { elements: [{ ...circle, binds: { w: 'ancho' } }] }],
		['binds.data de una imagen', { elements: [{ ...image, binds: { data: 'img' } }] }],
		['when.set con un valor inválido', { elements: [{ ...circle, when: [rule({ color: 'rojo' })] }] }],
		['when.set que saca el elemento del lienzo', { elements: [{ ...circle, when: [rule({ r: 80 })] }] }],
		['when.set que cambia el tipo', { elements: [{ ...circle, when: [rule({ type: 'rect' })] }] }],
		['una regla gt sin value', { elements: [{ ...circle, when: [{ key: 'a', op: 'gt', set: {} }] }] }],
		['dos acciones para el mismo botón y pulsación', { actions: [button('a'), button('b')] }],
		['un botón 16', { actions: [{ ...button('a'), button: 16 }] }],
		['un botón con zona a medias', { actions: [{ ...button('a'), x: 1, y: 1 }] }],
		['un default que no es del tipo del parámetro', { params: { t: { type: 'number', default: 'x' } } }],
		['un fotograma de 10 ms', { animation: { frames: [{ ms: 10, elements: [] }] } }],
		['un fotograma con un elemento fuera', { animation: { frames: [{ ms: 100, elements: [{ ...circle, x: 170 }] }] } }],
		['una rotación de 45', { rotation: 45 }],
	])('rechazan %s', (_, patch) => {
		expect(DisplayTemplate.safeParse({ ...goal, ...patch }).success).toBe(false)
	})

	it('limitan los valores: texto ≤ 140, ≤ 64 claves, solo escalares', () => {
		expect(DisplayValues.safeParse({ a: 'x'.repeat(141) }).success).toBe(false)
		expect(
			DisplayValues.safeParse(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i]))).success,
		).toBe(false)
		expect(DisplayValues.safeParse({ a: { b: 1 } }).success).toBe(false)
		expect(DisplayValues.safeParse({ a: null, b: true, c: 1.5, d: 'ok' }).success).toBe(true)
	})

	it('separan el token del dispositivo del de administración', () => {
		const t = (x: object) => CreateTokenInput.safeParse({ name: 'x', ...x }).success
		expect(t({ scopes: ['display:connect'] })).toBe(false)
		expect(t({ scopes: ['display:connect', 'displays:write'], displayId })).toBe(false)
		expect(t({ scopes: ['devices:read'], displayId })).toBe(false)
		expect(t({ scopes: ['display:connect'], displayId, deviceId: displayId })).toBe(false)
		expect(t({ scopes: ['displays:write'], deviceId: displayId })).toBe(false)
		expect(t({ scopes: ['display:connect'], displayId })).toBe(true)
		expect(t({ scopes: ['displays:write'] })).toBe(true)
		expect(t({ scopes: ['devices:read', 'devices:write'] })).toBe(true)
	})

	it('aceptan los mensajes de ejemplo del dispositivo (CONTRATO §4–5)', () => {
		const hello = {
			type: 'device.hello',
			protocol: 1,
			deviceId: 'md-34B7DA01ABCD',
			firmware: '1.0.0-touch',
			display: { width: 172, height: 320, touch: true, color: 'RGB565' },
			template: { id: 'goal.v1', version: 1 },
			capabilities: ['text', 'rect'],
		}
		const tap = {
			type: 'touch.tap',
			eventId: 'md-34B7DA01ABCD-93351-7',
			deviceId: 'md-34B7DA01ABCD',
			actionId: 'refresh',
			name: 'goal.refresh',
			x: 43,
			y: 289,
			templateId: 'goal.v1',
			templateVersion: 1,
			uptimeMs: 93351,
		}
		expect(DisplayClientMessage.safeParse(hello).success).toBe(true)
		expect(DisplayClientMessage.safeParse(tap).success).toBe(true)
		expect(DisplayClientMessage.safeParse({ ...hello, protocol: 2 }).success).toBe(false)
		// 1.1: botones físicos en el hello y en el toque; frag.ack
		expect(DisplayClientMessage.safeParse({ ...hello, display: { ...hello.display, buttons: 3 } }).success).toBe(true)
		expect(DisplayClientMessage.safeParse({ ...tap, source: 'button', button: 2, press: 'long' }).success).toBe(true)
		expect(
			DisplayClientMessage.safeParse({ type: 'frag.ack', id: 'abc', ok: false, reason: 'too_large' }).success,
		).toBe(true)
	})
})
