import type { Server } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { WsClientMessage, type WsServerMessage } from '@atekos/shared'
import type { Container } from '../container'
import { resolveActor } from '../shared/auth'
import { AppError } from '../shared/errors'
import { canRead, type Actor } from '../modules/devices/domain/policy'
import { onUpgrade } from './upgrade'

// Async: resuelve cuando Redis confirma el SUBSCRIBE del bus, así ningún cambio posterior se pierde.
export async function attachWebSocket(server: Server, c: Container) {
	// Mismo límite que el JSON de HTTP; si se supera, ws cierra la conexión con 1009.
	const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 })
	const subscribers = new Map<string, Map<WebSocket, Actor>>() // deviceId → socket → actor
	const send = (ws: WebSocket, msg: WsServerMessage) => {
		if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
	}

	function toWsError(err: unknown): WsServerMessage {
		if (err instanceof AppError) return { type: 'error', code: err.code, message: err.message }
		c.logger.error({ err }, 'error no controlado en ws')
		return { type: 'error', code: 'internal', message: 'Error interno' }
	}

	onUpgrade(server, '/ws', async (req, socket, head) => {
		const url = new URL(req.url ?? '/', 'http://x')
		// Node quita sus listeners al hacer upgrade: sin este, un RST del cliente mientras se resuelve el actor tumba el proceso.
		const onSocketError = () => socket.destroy()
		socket.on('error', onSocketError)
		const qToken = url.searchParams.get('token')
		try {
			// Orden de §8: Bearer, cookie, ?token= y, si no hay nada, anónimo.
			let actor = await resolveActor(c, req.headers.authorization, req.headers.cookie)
			if (actor.kind === 'anonymous' && qToken) actor = await resolveActor(c, `Bearer ${qToken}`)
			socket.off('error', onSocketError)
			wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, actor))
		} catch (err) {
			if (err instanceof AppError) return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
			c.logger.error({ err }, 'error en el handshake ws')
			socket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n')
		}
	})

	function onConnection(ws: WebSocket, actor: Actor) {
		const mine = new Set<string>()
		let alive = true
		// Sin listener, un 'error' del socket (p. ej. trama > maxPayload, que ws ya cierra con 1009) tumba el proceso.
		ws.on('error', (err) => c.logger.warn({ err }, 'error en /ws'))
		ws.on('pong', () => (alive = true))
		const heartbeat = setInterval(() => {
			if (!alive) return ws.terminate() // ESP sin WiFi: se limpia solo
			alive = false
			ws.ping()
		}, 30_000)

		ws.on('message', async (raw) => {
			let msg
			try {
				msg = WsClientMessage.parse(JSON.parse(raw.toString()))
			} catch {
				return send(ws, { type: 'error', code: 'bad_message', message: 'JSON inválido o tipo desconocido' })
			}
			try {
				switch (msg.type) {
					case 'ping':
						return send(ws, { type: 'pong' })
					case 'subscribe':
						await c.devices.get.execute(actor, msg.deviceId) // lanza NotFound si no puede leer
						// Si el socket se cerró durante el await, su 'close' ya limpió: no registrarlo (fuga con ESP que reconectan).
						if (ws.readyState !== WebSocket.OPEN) return
						mine.add(msg.deviceId)
						if (!subscribers.has(msg.deviceId)) subscribers.set(msg.deviceId, new Map())
						subscribers.get(msg.deviceId)!.set(ws, actor)
						return send(ws, { type: 'subscribed', deviceId: msg.deviceId })
					case 'unsubscribe':
						mine.delete(msg.deviceId)
						subscribers.get(msg.deviceId)?.delete(ws)
						return
					case 'toggle':
						await c.devices.toggle.execute(actor, msg.deviceId, 'ws')
						return
					case 'set':
						await c.devices.setState.execute(actor, msg.deviceId, msg.state, 'ws')
						return
				}
			} catch (err) {
				send(ws, toWsError(err))
			}
		})

		ws.on('close', () => {
			clearInterval(heartbeat)
			for (const id of mine) subscribers.get(id)?.delete(ws)
		})
	}

	// Cada instancia de la API recibe todos los cambios vía Redis y reenvía a sus sockets.
	// Se vuelve a comprobar canRead por si el dispositivo pasó de público a privado.
	await c.devices.bus.subscribe((device) => {
		for (const [ws, actor] of subscribers.get(device.id) ?? [])
			if (canRead(actor, device)) send(ws, { type: 'device.updated', device })
	})

	return {
		wss,
		// wss.close() espera a que se cierren todos los clientes; el 'close' de cada uno limpia su heartbeat.
		close: () =>
			new Promise<void>((resolve) => {
				for (const ws of wss.clients) ws.terminate()
				wss.close(() => resolve())
			}),
	}
}
