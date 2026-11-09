import { createHash } from 'node:crypto'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import type { RedisClientType as Redis } from 'redis'
import { DISPLAY_HEIGHT, DISPLAY_WIDTH, encodeImage, type DisplayTemplate, type ImageEncoding } from '@atekos/shared'
import { AppError, Unprocessable } from '../shared/errors'
import type { DisplayRepository } from '../modules/displays/domain/ports'

// Imágenes del MCP (docs/MCP.md): la IA no copia cientos de KB de base64, los nombra por referencia.

export const IMAGE_TTL_SEC = 24 * 60 * 60
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024
export const MAX_SOURCE_SIDE = 4096
export const FITS = ['contain', 'cover', 'fill'] as const
export type Fit = (typeof FITS)[number]
export type StoredImage = { encoding: ImageEncoding; data: string; w: number; h: number }
type Image = Extract<DisplayTemplate['elements'][number], { type: 'image' }>

export const imageRef = (data: string) => `ref:${createHash('sha256').update(data).digest('hex').slice(0, 16)}`
const imageKey = (displayId: string, ref: string) => `dimg:${displayId}:${ref}`

// Cada elemento image de la plantilla (elements y fotogramas) pasado por fn, con su ruta para los errores.
function mapImages(t: DisplayTemplate, fn: (e: Image, path: (string | number)[]) => Image): DisplayTemplate {
	const map = (els: DisplayTemplate['elements'], path: (string | number)[]) =>
		els.map((e, i) => (e.type === 'image' ? fn(e, [...path, i]) : e))
	return {
		...t,
		elements: map(t.elements, ['elements']),
		...(t.animation && {
			animation: {
				...t.animation,
				frames: t.animation.frames.map((f, i) => ({
					...f,
					elements: map(f.elements, ['animation', 'frames', i, 'elements']),
				})),
			},
		}),
	}
}

// Lo que sale por el MCP: cada `data` sustituido por su referencia.
export const withRefs = (t: DisplayTemplate) => mapImages(t, (e) => ({ ...e, data: imageRef(e.data) }))

// Sustituye cada `data` «ref:…» por la imagen que nombra: primero las subidas recientes de la pantalla (Redis)
// y después las imágenes de sus plantillas guardadas. La codificación la pone la imagen encontrada.
export async function resolveRefs(
	t: DisplayTemplate,
	deps: { redis: Redis; repo: DisplayRepository; displayId: string },
): Promise<DisplayTemplate> {
	const refs = new Set<string>()
	mapImages(t, (e) => {
		if (e.data.startsWith('ref:')) refs.add(e.data)
		return e
	})
	if (!refs.size) return t
	const found = new Map<string, Pick<StoredImage, 'encoding' | 'data'>>()
	for (const ref of refs) {
		const raw = await deps.redis.get(imageKey(deps.displayId, ref))
		if (raw) found.set(ref, JSON.parse(raw) as StoredImage)
	}
	if (found.size < refs.size)
		for (const saved of await deps.repo.listTemplates(deps.displayId))
			mapImages(saved, (e) => {
				const ref = imageRef(e.data)
				if (refs.has(ref) && !found.has(ref)) found.set(ref, { encoding: e.encoding, data: e.data })
				return e
			})
	const missing: { path: (string | number)[]; message: string }[] = []
	const out = mapImages(t, (e, path) => {
		if (!e.data.startsWith('ref:')) return e
		const img = found.get(e.data)
		if (!img)
			missing.push({ path: [...path, 'data'], message: `${e.data} no es una subida reciente ni una imagen guardada` })
		return img ? { ...e, encoding: img.encoding, data: img.data } : e
	})
	if (missing.length)
		throw Unprocessable(
			'unknown_image_ref',
			'Referencia de imagen desconocida: súbela con upload_display_image (caduca a las 24 h) o cópiala de get_display_template',
			missing,
		)
	return out
}

export async function storeImage(redis: Redis, displayId: string, img: StoredImage) {
	const ref = imageRef(img.data)
	await redis.set(imageKey(displayId, ref), JSON.stringify(img), { EX: IMAGE_TTL_SEC })
	return ref
}

// Ancho y alto que caben en el lienzo en alguna orientación (172×320 o 320×172).
export const fitsCanvas = (w: number, h: number) =>
	(w <= DISPLAY_WIDTH && h <= DISPLAY_HEIGHT) || (w <= DISPLAY_HEIGHT && h <= DISPLAY_WIDTH)

export const tooLarge = (message: string) => new AppError(413, 'image_too_large', message)
const unsupported = (message: string) => Unprocessable('unsupported_image', message)
const checkSide = (w: number, h: number) => {
	if (w > MAX_SOURCE_SIDE || h > MAX_SOURCE_SIDE)
		throw tooLarge(`La imagen mide ${w}×${h}: como mucho ${MAX_SOURCE_SIDE}×${MAX_SOURCE_SIDE}`)
}

export type RawImage = { width: number; height: number; data: Uint8Array } // RGBA

// PNG o JPEG → RGBA, con JS puro (la API va empaquetada en un solo archivo, sin módulos nativos).
export function decodeSource(buf: Buffer): RawImage {
	if (buf.length > MAX_SOURCE_BYTES) throw tooLarge(`La imagen pasa de ${MAX_SOURCE_BYTES / 1024 / 1024} MB`)
	if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		if (buf.length < 24) throw unsupported('PNG incompleto')
		checkSide(buf.readUInt32BE(16), buf.readUInt32BE(20)) // IHDR, antes de descomprimir nada
		try {
			return PNG.sync.read(buf)
		} catch (err) {
			throw unsupported(`PNG inválido: ${(err as Error).message}`)
		}
	}
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
		let img: RawImage
		try {
			img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_SOURCE_SIDE ** 2 / 1e6 })
		} catch (err) {
			const message = (err as Error).message
			if (message.includes('maxResolutionInMP'))
				throw tooLarge(`La imagen pasa de ${MAX_SOURCE_SIDE}×${MAX_SOURCE_SIDE} px`)
			throw unsupported(`JPEG inválido: ${message}`)
		}
		checkSide(img.width, img.height)
		return img
	}
	throw unsupported('Solo PNG o JPEG')
}

// Pesos 1D de cada píxel de destino sobre el tramo [start, start + len) del origen:
// promedio de área al reducir y bilineal al ampliar.
function taps(start: number, len: number, n: number, size: number): [number, number][][] {
	const scale = len / n
	const clamp = (k: number) => Math.min(size - 1, Math.max(0, k))
	return Array.from({ length: n }, (_, i) => {
		const a = start + i * scale
		if (scale <= 1) {
			const c = a + scale / 2 - 0.5 // centro del píxel de destino en coordenadas del origen
			const k = Math.floor(c)
			return [
				[clamp(k), 1 - (c - k)],
				[clamp(k + 1), c - k],
			]
		}
		const out: [number, number][] = []
		for (let k = Math.floor(a); k < a + scale; k++) {
			const cover = Math.min(a + scale, k + 1) - Math.max(a, k)
			if (cover > 0) out.push([clamp(k), cover / scale])
		}
		return out
	})
}

// Encaja la imagen en w×h sobre `background`: contain (entera, con bandas), cover (llena y recorta el centro)
// o fill (estira). Devuelve RGBA opaco.
export function fitImage(src: RawImage, w: number, h: number, fit: Fit, background: string): Uint8ClampedArray {
	const bg = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16))
	const { width: sw, height: sh, data } = src
	// Caja de destino (dx, dy, dw, dh) y tramo del origen (sx, sy, cw, ch).
	let [dx, dy, dw, dh, sx, sy, cw, ch] = [0, 0, w, h, 0, 0, sw, sh]
	if (fit === 'contain') {
		const s = Math.min(w / sw, h / sh)
		dw = Math.max(1, Math.round(sw * s))
		dh = Math.max(1, Math.round(sh * s))
		dx = (w - dw) >> 1
		dy = (h - dh) >> 1
	} else if (fit === 'cover') {
		const s = Math.max(w / sw, h / sh)
		cw = w / s
		ch = h / s
		sx = (sw - cw) / 2
		sy = (sh - ch) / 2
	}
	const tx = taps(sx, cw, dw, sw)
	const ty = taps(sy, ch, dh, sh)
	// Pasada horizontal de cada fila, ya compuesta sobre el fondo: así el alfa no oscurece los bordes al promediar.
	const rows = new Float32Array(sh * dw * 3)
	for (let y = 0; y < sh; y++)
		for (let x = 0; x < dw; x++)
			for (const [k, wt] of tx[x]!) {
				const i = (y * sw + k) * 4
				const a = data[i + 3]! / 255
				const o = (y * dw + x) * 3
				for (let c = 0; c < 3; c++) rows[o + c]! += wt * (bg[c]! + (data[i + c]! - bg[c]!) * a)
			}
	const out = new Uint8ClampedArray(w * h * 4)
	for (let i = 0; i < w * h; i++) out.set([...bg, 255], i * 4)
	for (let y = 0; y < dh; y++)
		for (let x = 0; x < dw; x++) {
			const o = ((dy + y) * w + dx + x) * 4
			for (let c = 0; c < 3; c++) {
				let v = 0
				for (const [k, wt] of ty[y]!) v += wt * rows[(k * dw + x) * 3 + c]!
				out[o + c] = Math.round(v)
			}
		}
	return out
}

// Archivo PNG/JPEG → elemento listo para la plantilla, en la codificación más corta.
// shortcut: decodifica y redimensiona en el hilo principal (un JPEG de 4096×4096 bloquea el event loop unos 2 s);
// si las subidas grandes llegan a notarse en la API, pasarlo a un worker_thread.
export function toDisplayImage(buf: Buffer, w: number, h: number, fit: Fit, background: string): StoredImage {
	const rgba = fitImage(decodeSource(buf), w, h, fit, background)
	return { ...encodeImage(rgba, w, h), w, h }
}
