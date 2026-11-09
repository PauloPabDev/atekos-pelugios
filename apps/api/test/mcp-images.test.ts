import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { decodeImage, encodeImage, rgb565, type DisplayTemplate } from '@atekos/shared'
import { describe, expect, it } from 'vitest'
import { fetchImage, isForbiddenIp } from '../src/mcp/fetch-image'
import { decodeSource, fitImage, imageRef, resolveRefs, toDisplayImage, withRefs } from '../src/mcp/images'
import type { DisplayRepository } from '../src/modules/displays/domain/ports'

const raw = (width: number, height: number, px: number[][]) => ({ width, height, data: Uint8Array.from(px.flat()) })
const rgb = (out: Uint8ClampedArray, i: number) => [...out.subarray(i * 4, i * 4 + 3)]
const [RED, BLUE, GREEN, WHITE] = [
	[255, 0, 0, 255],
	[0, 0, 255, 255],
	[0, 255, 0, 255],
	[255, 255, 255, 255],
]

function png(width: number, height: number, color: (x: number, y: number) => number[]) {
	const p = new PNG({ width, height })
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) p.data.set(color(x, y), (y * width + x) * 4)
	return PNG.sync.write(p)
}

describe('fitImage', () => {
	it('fill reduce con el promedio de área y amplía con bilineal', () => {
		expect(rgb(fitImage(raw(2, 2, [RED, BLUE, GREEN, WHITE]), 1, 1, 'fill', '#000000'), 0)).toEqual([128, 128, 128])
		const up = fitImage(raw(2, 1, [[0, 0, 0, 255], WHITE]), 4, 1, 'fill', '#000000')
		expect([0, 1, 2, 3].map((i) => rgb(up, i)[0])).toEqual([0, 64, 191, 255])
	})

	it('contain deja bandas del fondo y cover recorta el centro sin deformar', () => {
		const red = raw(4, 2, Array(8).fill(RED))
		const c = fitImage(red, 4, 4, 'contain', '#102030')
		expect([0, 4, 8, 12].map((i) => rgb(c, i))).toEqual([
			[16, 32, 48],
			[255, 0, 0],
			[255, 0, 0],
			[16, 32, 48],
		])
		// 4×2 con las dos columnas centrales roja y azul: cover a 2×2 se queda con ellas.
		const cover = fitImage(raw(4, 2, [GREEN, RED, BLUE, GREEN, GREEN, RED, BLUE, GREEN]), 2, 2, 'cover', '#000000')
		expect([0, 1, 2, 3].map((i) => rgb(cover, i))).toEqual([
			[255, 0, 0],
			[0, 0, 255],
			[255, 0, 0],
			[0, 0, 255],
		])
	})

	it('compone el alfa sobre el fondo', () => {
		expect(rgb(fitImage(raw(1, 1, [[255, 255, 255, 0]]), 1, 1, 'fill', '#102030'), 0)).toEqual([16, 32, 48])
		expect(rgb(fitImage(raw(1, 1, [[255, 255, 255, 128]]), 1, 1, 'fill', '#000000'), 0)).toEqual([128, 128, 128])
	})
})

describe('decodeSource y toDisplayImage', () => {
	it('PNG y JPEG → RGB565 del tamaño pedido', () => {
		const img = toDisplayImage(
			png(8, 4, (x) => (x < 4 ? RED : BLUE)),
			4,
			2,
			'fill',
			'#000000',
		)
		const px = decodeImage(img.encoding, img.data, 4, 2)!
		expect([...px]).toEqual([0, 0, 1, 1, 0, 0, 1, 1].map((b) => (b ? rgb565(0, 0, 255) : rgb565(255, 0, 0))))
		const jpg = jpeg.encode({ width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4, 255) }, 90).data
		const j = toDisplayImage(jpg, 2, 2, 'contain', '#000000')
		expect(decodeImage(j.encoding, j.data, 2, 2)).toEqual(new Uint16Array(4).fill(rgb565(255, 255, 255)))
	})

	it('rechaza lo que no es PNG/JPEG y las imágenes demasiado grandes', () => {
		expect(() => decodeSource(Buffer.from('hola, no soy una imagen'))).toThrow(
			expect.objectContaining({ code: 'unsupported_image' }),
		)
		const big = png(2, 2, () => RED)
		big.writeUInt32BE(5000, 16) // el IHDR dice 5000 de ancho: se rechaza sin descomprimir
		expect(() => decodeSource(big)).toThrow(expect.objectContaining({ code: 'image_too_large' }))
		expect(() => decodeSource(Buffer.alloc(8 * 1024 * 1024 + 1))).toThrow(
			expect.objectContaining({ code: 'image_too_large' }),
		)
	})
})

describe('referencias de imagen', () => {
	const pixels = (color: number[]) => encodeImage(Array(4).fill(color).flat(), 2, 2)
	const a = pixels(RED)
	const b = pixels(BLUE)
	type Img = Pick<ReturnType<typeof encodeImage>, 'encoding' | 'data'>
	const image = (i: Img) => ({ type: 'image' as const, x: 0, y: 0, w: 2, h: 2, ...i })
	const tpl = (el: Img, frame = el): DisplayTemplate => ({
		id: 't',
		version: 1,
		elements: [image(el)],
		animation: { frames: [{ ms: 100, elements: [image(frame)] }] },
		actions: [],
	})
	const deps = (stored: Record<string, string>, saved: DisplayTemplate[]) => ({
		displayId: 'd1',
		redis: { get: async (k: string) => stored[k] ?? null } as never,
		repo: { listTemplates: async () => saved } as unknown as DisplayRepository,
	})

	it('withRefs sustituye data en elements y fotogramas; resolveRefs lo deshace desde Redis o las guardadas', async () => {
		const t = tpl(a, b)
		const refs = withRefs(t)
		expect(refs.elements[0]).toMatchObject({ data: imageRef(a.data) })
		expect(refs.animation!.frames[0]!.elements[0]).toMatchObject({ data: imageRef(b.data) })
		expect(imageRef(a.data)).toMatch(/^ref:[0-9a-f]{16}$/)

		const fromRedis = { [`dimg:d1:${imageRef(a.data)}`]: JSON.stringify({ ...a, w: 2, h: 2 }) }
		const out = await resolveRefs(refs, deps(fromRedis, [tpl(b)]))
		expect(out.elements[0]).toMatchObject({ encoding: a.encoding, data: a.data })
		expect(out.animation!.frames[0]!.elements[0]).toMatchObject({ encoding: b.encoding, data: b.data })
	})

	it('una referencia desconocida → unknown_image_ref con la ruta', async () => {
		await expect(resolveRefs(tpl(a, { ...b, data: 'ref:0000000000000000' }), deps({}, []))).rejects.toMatchObject({
			code: 'unknown_image_ref',
			issues: [{ path: ['animation', 'frames', 0, 'elements', 0, 'data'] }],
		})
	})
})

describe('guardia SSRF de fetchImage', () => {
	it('isForbiddenIp: privadas, loopback, link-local, CGNAT, ULA, multicast y mapeadas', () => {
		const bad = ['10.1.2.3', '172.20.0.1', '192.168.1.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '0.0.0.0']
		const bad6 = ['::1', '::', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:a00:1', '64:ff9b::a00:1']
		for (const ip of [...bad, ...bad6, 'no-es-ip']) expect(isForbiddenIp(ip), ip).toBe(true)
		for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isForbiddenIp(ip), ip).toBe(false)
	})

	it('rechaza http, IPs privadas literales y nombres que resuelven a loopback, sin conectarse', async () => {
		for (const url of ['http://example.com/a.png', 'nada', 'https://127.0.0.1/a.png', 'https://[::1]/a.png'])
			await expect(fetchImage(url), url).rejects.toMatchObject({ code: 'forbidden_url' })
		await expect(fetchImage('https://localhost/a.png')).rejects.toMatchObject({ code: 'forbidden_url' })
	})
})
