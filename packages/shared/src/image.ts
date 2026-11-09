// Imágenes de la pantalla (docs/metadisplay/PLANTILLAS.md §Imágenes). TS puro: shared no tiene tipos DOM ni de Node.
//   rgb565:     w·h píxeles de 2 bytes, big-endian, por filas de arriba abajo.
//   rgb565-rle: tramos de 3 bytes [n-1][color alto][color bajo], cada uno con n = 1..256 píxeles iguales seguidos.
// `data` siempre va en base64 estándar (con relleno =).

export const IMAGE_ENCODINGS = ['rgb565', 'rgb565-rle'] as const
export type ImageEncoding = (typeof IMAGE_ENCODINGS)[number]

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]))
export const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export function encodeBase64(bytes: Uint8Array): string {
	let out = ''
	for (let i = 0; i < bytes.length; i += 3) {
		const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]]
		const n = (a << 16) | (b << 8) | c
		out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
		out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63]! : '='
		out += i + 2 < bytes.length ? ALPHABET[n & 63]! : '='
	}
	return out
}

// null si no es base64 válido
export function decodeBase64(s: string): Uint8Array | null {
	if (!BASE64.test(s)) return null
	const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0
	const out = new Uint8Array((s.length / 4) * 3 - pad)
	for (let i = 0, o = 0; i < s.length; i += 4) {
		const n = [0, 1, 2, 3].reduce((acc, k) => (acc << 6) | (INDEX.get(s[i + k]!) ?? 0), 0)
		for (const shift of [16, 8, 0]) if (o < out.length) out[o++] = (n >> shift) & 255
	}
	return out
}

export const rgb565 = (r: number, g: number, b: number) => ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)
// Inversa aproximada (para dibujar la vista previa): replica los bits altos en los bajos.
export const rgb888 = (c: number): [number, number, number] => {
	const r = (c >> 11) & 31
	const g = (c >> 5) & 63
	const b = c & 31
	return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]
}

export function encodePixels(px: Uint16Array, encoding: ImageEncoding): Uint8Array {
	if (encoding === 'rgb565') {
		const out = new Uint8Array(px.length * 2)
		px.forEach((c, i) => {
			out[i * 2] = c >> 8
			out[i * 2 + 1] = c & 255
		})
		return out
	}
	const runs: number[] = []
	for (let i = 0; i < px.length;) {
		const c = px[i]!
		let n = 1
		while (n < 256 && px[i + n] === c) n++
		runs.push(n - 1, c >> 8, c & 255)
		i += n
	}
	return Uint8Array.from(runs)
}

// RGBA (p. ej. ImageData.data de un canvas) → la codificación más corta. Ignora el canal alfa.
export function encodeImage(rgba: ArrayLike<number>, width: number, height: number) {
	const px = new Uint16Array(width * height)
	for (let i = 0; i < px.length; i++) px[i] = rgb565(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!)
	const rle = encodePixels(px, 'rgb565-rle')
	const encoding: ImageEncoding = rle.length < px.length * 2 ? 'rgb565-rle' : 'rgb565'
	return { encoding, data: encodeBase64(encoding === 'rgb565-rle' ? rle : encodePixels(px, 'rgb565')) }
}

// Píxeles RGB565 de una imagen, o null si `data` no da exactamente w·h píxeles.
export function decodeImage(encoding: ImageEncoding, data: string, width: number, height: number) {
	const bytes = decodeBase64(data)
	const total = width * height
	if (!bytes) return null
	const px = new Uint16Array(total)
	if (encoding === 'rgb565') {
		if (bytes.length !== total * 2) return null
		for (let i = 0; i < total; i++) px[i] = (bytes[i * 2]! << 8) | bytes[i * 2 + 1]!
		return px
	}
	if (bytes.length % 3) return null
	let o = 0
	for (let i = 0; i < bytes.length; i += 3) {
		const n = bytes[i]! + 1
		if (o + n > total) return null
		px.fill((bytes[i + 1]! << 8) | bytes[i + 2]!, o, o + n)
		o += n
	}
	return o === total ? px : null
}
