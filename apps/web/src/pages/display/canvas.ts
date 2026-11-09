// Lógica pura del Lienzo (ImageCanvas.tsx): encaje de la foto, bote de pintura y la imagen dentro del borrador
import { DisplayElement, rgb888 } from '@atekos/shared'
import type { ImageEncoding } from '@atekos/shared'
import { fmt } from './common'

export type Fit = 'contain' | 'cover' | 'fill'
type Size = { width: number; height: number }
export type Rect = { x: number; y: number; w: number; h: number }

// Dónde dibujar la foto entera en el lienzo: contain cabe entera (bandas), cover lo cubre (recorta) y fill estira.
// zoom 1 = ese encaje; offset desplaza desde el centro, en píxeles del lienzo.
export function fitRect(fit: Fit, src: Size, dst: Size, zoom = 1, offset = { x: 0, y: 0 }): Rect {
	const sx = dst.width / src.width
	const sy = dst.height / src.height
	const s = fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy)
	const w = (fit === 'fill' ? sx : s) * src.width * zoom
	const h = (fit === 'fill' ? sy : s) * src.height * zoom
	return { x: (dst.width - w) / 2 + offset.x, y: (dst.height - h) / 2 + offset.y, w, h }
}

// Bote de pintura: la zona contigua a (x, y) de color parecido en `src` (cada canal a ≤ tolerance, que absorbe el
// suavizado del canvas) se pinta opaca de `rgb` en `dst`. Ambos RGBA de width×height; pueden ser el mismo.
// Devuelve cuántos píxeles pintó.
export function floodFill(
	src: Uint8ClampedArray,
	dst: Uint8ClampedArray,
	width: number,
	height: number,
	x: number,
	y: number,
	rgb: [number, number, number],
	tolerance = 32,
) {
	if (x < 0 || y < 0 || x >= width || y >= height) return 0
	const start = y * width + x
	const base = [src[start * 4]!, src[start * 4 + 1]!, src[start * 4 + 2]!]
	const near = (p: number) => base.every((c, k) => Math.abs(src[p * 4 + k]! - c) <= tolerance)
	const seen = new Uint8Array(width * height)
	const stack = [start]
	seen[start] = 1
	let n = 0
	while (stack.length) {
		const p = stack.pop()!
		dst.set([...rgb, 255], p * 4)
		n++
		const col = p % width
		for (const q of [col > 0 ? p - 1 : -1, col < width - 1 ? p + 1 : -1, p - width, p + width])
			if (q >= 0 && q < seen.length && !seen[q] && near(q)) {
				seen[q] = 1
				stack.push(q)
			}
	}
	return n
}

// null si el rectángulo cabe en la pantalla; si no, por qué
export function checkBox({ x, y, w, h }: Rect, screen: Size) {
	if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1)
		return 'x e y tienen que ser enteros desde 0, y el ancho y el alto, enteros desde 1.'
	if (x + w > screen.width) return `No cabe a lo ancho: x + ancho = ${x + w} px y la pantalla mide ${screen.width} px.`
	if (y + h > screen.height) return `No cabe a lo alto: y + alto = ${y + h} px y la pantalla mide ${screen.height} px.`
	return null
}

// Píxeles RGB565 (decodeImage) → RGBA opaco para un ImageData
export function toRGBA(px: Uint16Array) {
	const out = new Uint8ClampedArray(px.length * 4)
	px.forEach((c, i) => out.set([...rgb888(c), 255], i * 4))
	return out
}

export const toHex = (r: number, g: number, b: number) =>
	`#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
export const hexRgb = (hex: string): [number, number, number] =>
	[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

type Draft = Record<string, unknown>

// Borrador del editor → la plantilla sin validar, o null si no es un objeto JSON
export function parseDraft(text: string): Draft | null {
	try {
		const t: unknown = JSON.parse(text)
		return typeof t === 'object' && t !== null && !Array.isArray(t) ? (t as Draft) : null
	} catch {
		return null
	}
}

const elementsOf = (t: Draft): unknown[] => (Array.isArray(t.elements) ? t.elements : [])

// Las imágenes válidas del borrador, con su índice en `elements`
export function draftImages(t: Draft | null) {
	return (t ? elementsOf(t) : []).flatMap((e, index) => {
		const el = DisplayElement.safeParse(e).data
		return el?.type === 'image' ? [{ ...el, index }] : []
	})
}

// La imagen al final de `elements`, al principio (fondo) o en lugar de la del índice `replace`, de la que conserva
// lo demás (binds, when, visible…)
export function placeImage(
	text: string,
	image: Rect & { encoding: ImageEncoding; data: string },
	at: { replace?: number; background?: boolean } = {},
): { text: string } | { error: string } {
	const t = parseDraft(text)
	if (!t) return { error: 'El borrador no es una plantilla JSON válida: corrígelo antes de añadir la imagen.' }
	const elements = [...elementsOf(t)]
	const el = { type: 'image', ...image }
	if (at.replace !== undefined) elements[at.replace] = { ...(elements[at.replace] as object), ...el }
	else if (at.background) elements.unshift(el)
	else elements.push(el)
	return { text: fmt({ ...t, elements }) }
}
