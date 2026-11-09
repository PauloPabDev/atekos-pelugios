import { lookup } from 'node:dns'
import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { AppError, Unprocessable } from '../shared/errors'
import { MAX_SOURCE_BYTES, tooLarge } from './images'

// Descarga de imágenes para upload_display_image con guardia SSRF: la URL la elige la IA, así que nunca puede
// llevar a la red interna (Redis, PG, la API misma) ni a los metadatos de la nube.

const MAX_REDIRECTS = 3
const TIMEOUT_MS = 10_000

const blocked = new BlockList()
for (const [net, prefix] of [
	['0.0.0.0', 8], // «esta red»
	['10.0.0.0', 8],
	['100.64.0.0', 10], // CGNAT (y metadatos de algunas nubes)
	['127.0.0.0', 8],
	['169.254.0.0', 16], // link-local: 169.254.169.254 = metadatos
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['224.0.0.0', 3], // multicast (224/4) y reservado (240/4)
] as const)
	blocked.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [
	['::', 128],
	['::1', 128],
	['64:ff9b::', 96], // NAT64: llevaría a cualquier IPv4
	['fc00::', 7], // ULA
	['fe80::', 10], // link-local
	['fec0::', 10],
	['ff00::', 8], // multicast
] as const)
	blocked.addSubnet(net, prefix, 'ipv6')

// Las IPv4 mapeadas (::ffff:10.0.0.1) las comprueba BlockList con las reglas IPv4.
export const isForbiddenIp = (ip: string) => {
	const v = isIP(ip)
	return v === 0 || blocked.check(ip, v === 6 ? 'ipv6' : 'ipv4')
}

const forbidden = (message: string) => Unprocessable('forbidden_url', message)
const failed = (message: string) => new AppError(502, 'fetch_failed', message)

// La comprobación va en el lookup de la propia conexión: así un DNS que cambia entre la comprobación y la
// conexión (rebinding) no la esquiva.
const guardedLookup: LookupFunction = (host, opts, cb) =>
	lookup(host, { ...opts, all: true }, (err, addrs) => {
		if (err) return cb(err, '', 0)
		const bad = addrs.find((a) => isForbiddenIp(a.address))
		if (bad) return cb(forbidden(`${host} resuelve a una dirección privada (${bad.address})`), '', 0)
		if (opts.all) return cb(null, addrs)
		cb(null, addrs[0]!.address, addrs[0]!.family)
	})

const get = (url: URL, signal: AbortSignal) =>
	new Promise<IncomingMessage>((resolve, reject) => {
		https
			.get(url, { lookup: guardedLookup, signal, headers: { accept: 'image/png, image/jpeg, image/*' } }, resolve)
			.on('error', reject)
	})

// Solo https, como mucho 3 redirecciones (cada una se vuelve a comprobar), 10 s en total y ≤ 8 MB de imagen.
export async function fetchImage(raw: string): Promise<Buffer> {
	const signal = AbortSignal.timeout(TIMEOUT_MS)
	let url: URL
	try {
		url = new URL(raw)
	} catch {
		throw forbidden('URL inválida')
	}
	try {
		for (let hop = 0; ; hop++) {
			if (url.protocol !== 'https:') throw forbidden('Solo se aceptan URLs https')
			const host = url.hostname.replace(/^\[|\]$/g, '')
			// Una IP literal no pasa por el lookup: se comprueba aquí.
			if (isIP(host) && isForbiddenIp(host)) throw forbidden(`${host} es una dirección privada`)
			const res = await get(url, signal)
			const status = res.statusCode ?? 0
			if (status >= 300 && status < 400 && res.headers.location) {
				res.resume()
				if (hop === MAX_REDIRECTS) throw failed(`Más de ${MAX_REDIRECTS} redirecciones`)
				url = new URL(res.headers.location, url)
				continue
			}
			if (status !== 200) {
				res.resume()
				throw failed(`La URL respondió ${status}`)
			}
			const type = res.headers['content-type'] ?? ''
			if (!type.startsWith('image/')) {
				res.resume()
				throw Unprocessable('unsupported_image', `La URL no es una imagen (content-type: ${type || 'ninguno'})`)
			}
			const tooBig = tooLarge(`La imagen pasa de ${MAX_SOURCE_BYTES / 1024 / 1024} MB`)
			if (Number(res.headers['content-length']) > MAX_SOURCE_BYTES) {
				res.destroy()
				throw tooBig
			}
			const chunks: Buffer[] = []
			let size = 0
			for await (const chunk of res as AsyncIterable<Buffer>) {
				size += chunk.length
				if (size > MAX_SOURCE_BYTES) {
					res.destroy()
					throw tooBig
				}
				chunks.push(chunk)
			}
			return Buffer.concat(chunks)
		}
	} catch (err) {
		if (err instanceof AppError) throw err
		throw failed(
			signal.aborted ? `Sin respuesta en ${TIMEOUT_MS / 1000} s` : `No se pudo descargar: ${(err as Error).message}`,
		)
	}
}
