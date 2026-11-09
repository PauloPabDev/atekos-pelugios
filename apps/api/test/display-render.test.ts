import {
	currentFrame,
	decodeBase64,
	decodeImage,
	encodeBase64,
	encodeImage,
	encodePixels,
	resolveElement,
	rgb565,
	templateVariables,
	type DisplayElement,
	type DisplayTemplate,
} from '@atekos/shared'
import { describe, expect, it } from 'vitest'

describe('render.ts: capa dinámica de la plantilla', () => {
	const text: DisplayElement = { type: 'text', x: 1, y: 1, value: 'base', color: '#FFFFFF' }

	it('bind y format dan el texto final en value; una variable ausente o null queda vacía', () => {
		expect(resolveElement({ type: 'text', x: 1, y: 1, bind: 'a' }, { a: 7 })).toEqual({
			type: 'text',
			x: 1,
			y: 1,
			value: 7,
		})
		expect(resolveElement({ ...text, format: 'T: {t} C {falta}{n}' }, { t: 21.5, n: null })?.value).toBe('T: 21.5 C ')
		expect(resolveElement({ type: 'text', x: 1, y: 1, bind: 'toString' }, {})?.value).toBeUndefined()
	})

	it('binds convierte al tipo de la propiedad y si no sirve conserva la base', () => {
		const c: DisplayElement = {
			type: 'circle',
			x: 50,
			y: 50,
			r: 10,
			color: '#FFFFFF',
			binds: { r: 'r', color: 'c', filled: 'f' },
		}
		expect(resolveElement(c, { r: '12.6', c: '#FF0000', f: 1 })).toMatchObject({
			r: 13,
			color: '#FF0000',
			filled: true,
		})
		expect(resolveElement(c, { r: 'mucho', c: 'rojo', f: 'false' })).toMatchObject({
			r: 10,
			color: '#FFFFFF',
			filled: false,
		})
		expect(resolveElement(c, {})).not.toHaveProperty('binds')
	})

	it('when aplica en orden las reglas que se cumplen, después de binds; visible:false lo oculta', () => {
		const e: DisplayElement = {
			...text,
			binds: { color: 'c' },
			when: [
				{ key: 't', op: 'gt', value: 30, set: { color: '#FF0000' } },
				{ key: 't', op: 'gte', value: 40, set: { color: '#00FF00', value: 'muy alto' } },
				{ key: 'ocultar', op: 'truthy', set: { visible: false } },
			],
		}
		expect(resolveElement(e, { t: 20, c: '#0000FF' })?.color).toBe('#0000FF')
		expect(resolveElement(e, { t: 35, c: '#0000FF' })?.color).toBe('#FF0000')
		expect(resolveElement(e, { t: 40 })).toMatchObject({ color: '#00FF00', value: 'muy alto' })
		expect(resolveElement(e, { t: '35' })?.color).toBe('#FF0000') // gt compara como números
		expect(resolveElement(e, { t: true })?.color).toBe('#FFFFFF') // un booleano no es un número
		expect(resolveElement(e, { ocultar: 'si' })).toBeNull()
		const eq = (op: 'eq' | 'ne' | 'falsy', v: unknown) =>
			resolveElement({ ...text, when: [{ key: 'k', op, value: 5, set: { value: 'sí' } }] }, { k: v as number })?.value
		expect([eq('eq', 5), eq('eq', '5'), eq('ne', '5'), eq('falsy', 0)]).toEqual(['sí', 'base', 'sí', 'sí'])
	})

	it('templateVariables: las variables de bind, binds, format y when, también en los fotogramas, sin repetir', () => {
		const t: Pick<DisplayTemplate, 'elements' | 'animation'> = {
			elements: [
				{ type: 'text', x: 1, y: 1, bind: 'a' },
				{
					type: 'text',
					x: 1,
					y: 1,
					format: '{b} y {a}',
					binds: { color: 'c' },
					when: [{ key: 'd', op: 'truthy', set: { format: '{e}' } }],
				},
			],
			animation: { frames: [{ ms: 100, elements: [{ type: 'progress', x: 1, y: 1, w: 9, h: 9, bind: 'f' }] }] },
		}
		expect(templateVariables(t)).toEqual(['a', 'c', 'b', 'd', 'e', 'f'])
		expect(templateVariables({ elements: [{ type: 'text', x: 1, y: 1, value: '{no}' }] })).toEqual([])
	})

	it('currentFrame recorre los fotogramas y, con repeat, se queda en el último', () => {
		const a = {
			frames: [
				{ ms: 100, elements: [] },
				{ ms: 300, elements: [] },
			],
		}
		expect([0, 99, 100, 399, 400, 550].map((ms) => currentFrame(a, ms))).toEqual([0, 0, 1, 1, 0, 1])
		expect([0, 450, 550, 799, 800, 5000].map((ms) => currentFrame({ ...a, repeat: 2 }, ms))).toEqual([0, 0, 1, 1, 1, 1])
	})
})

describe('image.ts: RGB565 y RLE', () => {
	it('base64 de ida y vuelta, con y sin relleno', () => {
		for (const n of [0, 1, 2, 3, 4, 5, 255]) {
			const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255)
			expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes)
		}
		expect(encodeBase64(new TextEncoder().encode('Día'))).toBe(Buffer.from('Día').toString('base64'))
		expect(decodeBase64('abc')).toBeNull()
	})

	it('RLE: tramos [n-1][color BE] de hasta 256 píxeles', () => {
		const px = new Uint16Array(300).fill(0xf800)
		px[299] = 0x001f
		expect([...encodePixels(px, 'rgb565-rle')]).toEqual([255, 0xf8, 0, 42, 0xf8, 0, 0, 0, 0x1f])
		expect(rgb565(255, 0, 0)).toBe(0xf800)
	})

	it('encodeImage elige la más corta y decodeImage la recupera; si no da w·h píxeles, null', () => {
		const w = 20
		const h = 10
		const flat = Array.from({ length: w * h }, () => [10, 200, 30, 255]).flat()
		const noise = Array.from({ length: w * h }, (_, i) => [i * 7, i * 13, i * 29, 255].map((v) => v & 255)).flat()
		for (const [rgba, expected] of [
			[flat, 'rgb565-rle'],
			[noise, 'rgb565'],
		] as const) {
			const img = encodeImage(rgba, w, h)
			expect(img.encoding).toBe(expected)
			const px = decodeImage(img.encoding, img.data, w, h)!
			expect(px[5]).toBe(rgb565(rgba[20]!, rgba[21]!, rgba[22]!))
			expect(decodeImage(img.encoding, img.data, w, h + 1)).toBeNull()
		}
	})
})
