import { readFileSync } from 'node:fs'
import {
	CreateTokenInput,
	DISPLAY_MAX_FRAME,
	DisplayClientMessage,
	DisplayHardwareId,
	DisplayTemplate,
	DisplayValues,
} from '@atekos/shared'
import { describe, expect, it } from 'vitest'

const example = (name: string) =>
	JSON.parse(readFileSync(new URL(`../../../docs/metadisplay/examples/${name}`, import.meta.url), 'utf8'))
const goal = example('goal-template.json')
const displayId = '7b1e2c4a-1111-4222-8333-944455556666'

describe('esquemas MetaDisplay', () => {
	it('aceptan los ejemplos del contrato', () => {
		expect(DisplayTemplate.safeParse(goal).success).toBe(true)
		expect(DisplayTemplate.safeParse(example('status-template.json')).success).toBe(true)
		expect(DisplayValues.safeParse(example('goal-data.json')).success).toBe(true)
		expect(JSON.stringify({ type: 'template.set', template: goal }).length).toBeLessThan(DISPLAY_MAX_FRAME)
	})

	it('normalizan el id de hardware y rechazan formatos inválidos', () => {
		expect(DisplayHardwareId.parse('md-34b7da01abcd')).toBe('md-34B7DA01ABCD')
		expect(DisplayHardwareId.safeParse('md-123').success).toBe(false)
		expect(DisplayHardwareId.safeParse('xx-34B7DA01ABCD').success).toBe(false)
	})

	it.each([
		['un rect que se sale de 172', { elements: [{ type: 'rect', x: 100, y: 0, w: 100, h: 10 }] }],
		['un text sin value ni bind', { elements: [{ type: 'text', x: 1, y: 1 }] }],
		['un tipo de elemento desconocido', { elements: [{ type: 'image', x: 1, y: 1 }] }],
		['un color que no es #RRGGBB', { elements: [{ type: 'line', x: 0, y: 0, x2: 1, y2: 1, color: 'red' }] }],
		['ids de acción repetidos', { actions: [goal.actions[0], goal.actions[0]] }],
		['una zona táctil fuera de 320', { actions: [{ ...goal.actions[0], y: 300, h: 40 }] }],
		['más de 45 elementos', { elements: Array.from({ length: 46 }, () => goal.elements[0]) }],
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
	})
})
