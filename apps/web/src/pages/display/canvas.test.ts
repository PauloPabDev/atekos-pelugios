import { describe, expect, test } from 'vitest'
import { decodeImage, encodeImage } from '@atekos/shared'
import { checkBox, draftImages, fitRect, floodFill, hexRgb, placeImage, toHex, toRGBA } from './canvas'

describe('fitRect', () => {
	// Escalas exactas en binario (0,25 y 1,5) para comparar sin redondeos
	const photo = { width: 400, height: 200 }
	const screen = { width: 100, height: 300 }

	test('ajustar cabe entera y centrada, rellenar cubre y recorta, estirar deforma', () => {
		expect(fitRect('contain', photo, screen)).toEqual({ x: 0, y: 125, w: 100, h: 50 })
		expect(fitRect('cover', photo, screen)).toEqual({ x: -250, y: 0, w: 600, h: 300 })
		expect(fitRect('fill', photo, screen)).toEqual({ x: 0, y: 0, w: 100, h: 300 })
	})

	test('el zoom escala desde el centro y el desplazamiento se suma', () => {
		expect(fitRect('contain', photo, screen, 2, { x: 5, y: -10 })).toEqual({ x: -45, y: 90, w: 200, h: 100 })
		expect(fitRect('fill', photo, screen, 0.5)).toEqual({ x: 25, y: 75, w: 50, h: 150 })
	})
})

describe('floodFill', () => {
	// 4×3: blanco con una pared negra en la columna 1
	const W = [255, 255, 255, 255]
	const K = [0, 0, 0, 255]
	const image = () => Uint8ClampedArray.from([W, K, W, W, W, K, W, W, W, K, W, W].flat())
	const at = (a: Uint8ClampedArray, i: number) => [...a.slice(i * 4, i * 4 + 4)]

	test('pinta en dst solo la zona contigua de src', () => {
		const src = image()
		const dst = new Uint8ClampedArray(src.length)
		expect(floodFill(src, dst, 4, 3, 0, 1, [255, 0, 0])).toBe(3)
		for (const i of [0, 4, 8]) expect(at(dst, i)).toEqual([255, 0, 0, 255])
		for (const i of [1, 2, 3, 5, 6, 7]) expect(at(dst, i)).toEqual([0, 0, 0, 0])
		expect(src).toEqual(image())
	})

	test('sobre la misma imagen; tolera colores parecidos y no se sale', () => {
		const img = image()
		img.set([240, 250, 255], 3 * 4) // casi blanco
		expect(floodFill(img, img, 4, 3, 3, 0, [0, 0, 255])).toBe(6)
		expect(at(img, 3)).toEqual([0, 0, 255, 255])
		expect(at(img, 0)).toEqual(W)
		expect(floodFill(img, img, 4, 3, 4, 0, [0, 0, 0])).toBe(0)
	})
})

test('checkBox explica por qué no cabe', () => {
	const screen = { width: 172, height: 320 }
	expect(checkBox({ x: 0, y: 0, w: 172, h: 320 }, screen)).toBeNull()
	expect(checkBox({ x: 10, y: 0, w: 172, h: 320 }, screen)).toMatch('x + ancho = 182 px')
	expect(checkBox({ x: 0, y: 1, w: 10, h: 320 }, screen)).toMatch('y + alto = 321 px')
	expect(checkBox({ x: -1, y: 0, w: 10, h: 10 }, screen)).toMatch('enteros')
	expect(checkBox({ x: 0, y: 0, w: 1.5, h: 10 }, screen)).toMatch('enteros')
	expect(checkBox({ x: 0, y: 0, w: 0, h: 10 }, screen)).toMatch('enteros')
})

test('toRGBA deja los píxeles como estaban al volver a codificarlos', () => {
	const rgba = Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 18, 52, 86, 255])
	const { encoding, data } = encodeImage(rgba, 2, 2)
	const px = decodeImage(encoding, data, 2, 2)!
	expect(decodeImage(encoding, encodeImage(toRGBA(px), 2, 2).data, 2, 2)).toEqual(px)
	expect(toRGBA(px).slice(0, 8)).toEqual(Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255]))
})

test('toHex y hexRgb', () => {
	expect(toHex(255, 8, 0)).toBe('#ff0800')
	expect(hexRgb('#ff0800')).toEqual([255, 8, 0])
})

describe('la imagen en el borrador', () => {
	const pixel = { x: 2, y: 3, w: 1, h: 1, ...encodeImage([255, 255, 255, 255], 1, 1) }
	const text = JSON.stringify({
		id: 'a',
		version: 1,
		elements: [
			{ type: 'text', x: 0, y: 0, value: 'HOLA' },
			{ type: 'image', x: 0, y: 0, w: 1, h: 1, encoding: 'rgb565', data: 'AAA=' },
			{ type: 'image', x: 0, y: 0, w: 1, h: 1, encoding: 'rgb565', data: 'roto' },
			{ type: 'image', x: 0, y: 0, w: 1, h: 1, encoding: 'rgb565', data: 'AAA=', binds: { x: 'pos' }, visible: false },
		],
		actions: [],
	})
	const elements = (r: ReturnType<typeof placeImage>) => ('text' in r ? JSON.parse(r.text).elements : r)

	test('draftImages lista las imágenes válidas con su índice', () => {
		expect(draftImages(JSON.parse(text)).map((i) => i.index)).toEqual([1, 3])
		expect(draftImages(null)).toEqual([])
	})

	test('añade al final, o al principio como fondo', () => {
		expect(elements(placeImage(text, pixel))[4]).toEqual({ type: 'image', ...pixel })
		expect(elements(placeImage(text, pixel, { background: true }))[0]).toEqual({ type: 'image', ...pixel })
	})

	test('reemplaza en su índice conservando binds, when y visible', () => {
		const out = elements(placeImage(text, pixel, { replace: 3 }))
		expect(out).toHaveLength(4)
		expect(out[3]).toEqual({ type: 'image', ...pixel, binds: { x: 'pos' }, visible: false })
	})

	test('un borrador que no es JSON se explica', () => {
		expect(placeImage('{ roto', pixel)).toEqual({ error: expect.stringMatching('no es una plantilla JSON válida') })
		expect(placeImage('[]', pixel)).toHaveProperty('error')
	})
})
