import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { DISPLAY_MAX_FRAME, DisplayClientMessage, type DisplayServerMessage } from '@atekos/shared'
import type { Container } from '../container'
import { AppError, Unauthorized } from '../shared/errors'
import { activeTemplate } from '../modules/displays/application/access'
import { publishAll, snapshotMessages } from '../modules/displays/application/messages'
import type { DisplayRecord } from '../modules/displays/domain/ports'
import { onUpgrade } from './upgrade'

type Hello = Extract<DisplayClientMessage, { type: 'device.hello' }>
type Touch = Extract<DisplayClientMessage, { type: 'touch.tap' }>
type UiResult = Extract<DisplayServerMessage, { type: 'ui.result' }>

const DEDUP_TTL_SEC = 86_400

// WSS del firmware MetaDisplay (DISENO §4 y §5). Aparte del /ws de la web; mismo patrón que attachWebSocket:
// resuelve cuando Redis confirma el SUBSCRIBE de display-out.
export async function attachDeviceWebSocket(server: Server, c: Container) {
	const { repo, presence, outbox, eventLog } = c.displays
	// ws cierra con 1009 cualquier trama de más de 8192 bytes.
	const wss = new WebSocketServer({ noServer: true, maxPayload: DISPLAY_MAX_FRAME })
	const sockets = new Map<string, Set<WebSocket>>() // displayId → sockets de esta instancia que ya hicieron hello

	const send = (ws: WebSocket, msg: DisplayServerMessage) => {
		if (ws.readyState !== WebSocket.OPEN) return
		const data = JSON.stringify(msg)
		const bytes = Buffer.byteLength(data)
		// El firmware descarta tramas mayores: no se envía y queda en el log.
		if (bytes > DISPLAY_MAX_FRAME)
			return c.logger.error({ type: msg.type, bytes }, 'mensaje a pantalla demasiado grande')
		ws.send(data)
	}

	// Solo el header Bearer (CONTRATO §2): ni ?token= ni cookie.
	async function authorize(authorization?: string) {
		const t = authorization?.startsWith('Bearer ') ? await c.tokens.verify.execute(authorization.slice(7)) : null
		const d = t?.displayId && t.scopes.includes('display:connect') ? await repo.findById(t.displayId) : null
		if (!d) throw Unauthorized()
		return d
	}

	onUpgrade(server, '/ws/device', async (req, socket, head) => {
		// Como en /ws: sin este listener, un RST del cliente durante el await tumba el proceso.
		const onSocketError = () => socket.destroy()
		socket.on('error', onSocketError)
		try {
			const d = await authorize(req.headers.authorization)
			socket.off('error', onSocketError)
			wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, d))
		} catch (err) {
			if (err instanceof AppError) return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
			c.logger.error({ err }, 'error en el handshake de /ws/device')
			socket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n')
		}
	})

	function onConnection(ws: WebSocket, d: DisplayRecord) {
		const connId = randomUUID()
		const log = c.logger.child({ displayId: d.id, connId })
		const sameDevice = (deviceId: string) => deviceId.toUpperCase() === d.hardwareId.toUpperCase()
		let ready = false // hizo un hello válido: está en `sockets` y en la presencia
		let alive = true
		let queue = Promise.resolve()

		ws.on('error', (err) => log.warn({ err }, 'error en /ws/device')) // p. ej. trama > 8192: ws ya cierra con 1009
		ws.on('pong', () => {
			alive = true
			if (ready) presence.renew(d.id, connId).catch((err) => log.error({ err }, 'no se pudo renovar la presencia'))
		})
		const heartbeat = setInterval(() => {
			if (!alive) return ws.terminate()
			alive = false
			ws.ping()
		}, 30_000)

		ws.on('message', (raw, isBinary) => {
			if (isBinary) return ws.close(1003, 'solo texto')
			let json: unknown
			try {
				json = JSON.parse(raw.toString())
			} catch {
				return ws.close(1007, 'JSON invalido')
			}
			// En cola: los mensajes de una conexión se procesan en orden (dos touch.tap seguidos no se adelantan).
			queue = queue.then(() => onMessage(json)).catch((err) => log.error({ err }, 'error procesando un mensaje'))
		})

		ws.on('close', () => {
			clearInterval(heartbeat)
			if (!ready) return
			const mine = sockets.get(d.id)
			mine?.delete(ws)
			if (!mine?.size) sockets.delete(d.id)
			presence.remove(d.id, connId).catch((err) => log.error({ err }, 'no se pudo quitar la presencia'))
		})

		async function onMessage(json: unknown) {
			if (ws.readyState !== WebSocket.OPEN) return // ya se está cerrando: lo que quede en la cola se descarta
			const raw = (json ?? {}) as { type?: unknown; protocol?: unknown }
			// El esquema rechaza protocol ≠ 1 como cualquier hello mal formado; este caso cierra siempre, también tras el hello.
			if (raw.type === 'device.hello' && raw.protocol !== 1) return ws.close(1008, 'protocolo no soportado')
			const r = DisplayClientMessage.safeParse(json)
			if (!ready && r.data?.type !== 'device.hello') return ws.close(1008, 'falta device.hello')
			if (!r.success) return log.warn({ type: raw.type, issues: r.error.issues }, 'mensaje de pantalla ignorado')
			const m = r.data
			switch (m.type) {
				case 'device.hello':
					return hello(m)
				case 'touch.tap':
					if (!sameDevice(m.deviceId)) return ws.close(1008, 'deviceId no coincide')
					return touch(m)
				default: // template.ack, data.ack, trust.ack, ota.ack: solo se registran
					return log[m.ok ? 'info' : 'warn']({ ack: m }, 'ack de pantalla')
			}
		}

		async function hello(m: Hello) {
			if (!sameDevice(m.deviceId)) return ws.close(1008, 'deviceId no coincide')
			if (!ready) {
				// Se registra antes de leer: lo que se publique entretanto llega por el bus y no se pierde.
				ready = true
				if (!sockets.has(d.id)) sockets.set(d.id, new Set())
				sockets.get(d.id)!.add(ws)
				await presence.add(d.id, connId)
			}
			const display = await repo.findById(d.id) // fresca: la plantilla activa puede haber cambiado
			if (!display) return ws.close(1008, 'pantalla borrada')
			const t = await activeTemplate(repo, display)
			const [set, snapshot] = snapshotMessages(display, t)
			if (m.template?.id !== t.id || m.template?.version !== t.version) send(ws, set)
			send(ws, snapshot)
		}

		// DISENO §5: dedupe → validación → regla → guardar y enviar el ui.result → historial.
		async function touch(m: Touch) {
			const key = `dedup:${d.id}:${m.eventId}`
			// NX + GET en una sola orden atómica: null = evento nuevo (y ya marcado como pending).
			const prev = await c.redis.set(key, 'pending', { condition: 'NX', EX: DEDUP_TTL_SEC, GET: true })
			if (prev !== null)
				return send(ws, prev === 'pending' ? { type: 'event.ack', eventId: m.eventId } : JSON.parse(prev))
			let result: UiResult
			try {
				result = await applyRules(m)
				await c.redis.set(key, JSON.stringify(result), { EX: DEDUP_TTL_SEC })
			} catch (err) {
				await c.redis.del(key) // sin la marca, el reintento del firmware (≈5 s) lo vuelve a procesar
				throw err
			}
			send(ws, result) // después de publicar la navegación
			await eventLog
				.appendTouch({
					displayId: d.id,
					ownerId: d.ownerId,
					eventId: m.eventId,
					actionId: m.actionId,
					name: m.name ?? null,
					x: m.x,
					y: m.y,
					templateId: m.templateId ?? '',
					templateVersion: m.templateVersion,
					status: result.status,
					toast: result.toast ?? null,
					source: m.source ?? null,
					button: m.button ?? null,
					press: m.press ?? null,
				})
				.catch((err) => log.error({ err, eventId: m.eventId }, 'no se pudo guardar el toque'))
		}

		// Toasts en ASCII: la fuente del LCD no tiene tildes.
		async function applyRules(m: Touch): Promise<UiResult> {
			const result = (status: UiResult['status'], toast: string): UiResult => ({
				type: 'ui.result',
				eventId: m.eventId,
				status,
				toast,
			})
			const display = await repo.findById(d.id)
			const t = display && (await activeTemplate(repo, display))
			const action = t?.actions.find((a) => a.id === m.actionId)
			if (
				!display ||
				!t ||
				!action ||
				action.mode === 'local' ||
				m.templateId !== t.id ||
				m.templateVersion !== t.version
			)
				return result('rejected', 'Accion desactualizada')

			const event = action.event ?? ''
			if (event.startsWith('screen.')) {
				try {
					const next = await repo.setActive(d.id, event.slice('screen.'.length))
					await publishAll(outbox, d.id, snapshotMessages(next.display, next.template)) // a todos sus sockets
					return result('ok', 'Pantalla cambiada')
				} catch (err) {
					if (err instanceof AppError && err.code === 'template_not_found') return result('error', 'Pantalla no existe')
					throw err
				}
			}
			if (event === 'data.refresh') {
				send(ws, snapshotMessages(display, t)[1]) // solo a este socket
				return result('ok', 'Datos actualizados')
			}
			return result('ok', 'Accion recibida')
		}
	}

	// Cada instancia recibe todo display-out y lo entrega a sus sockets de esa pantalla que ya hicieron hello.
	await outbox.subscribe((displayId, msg) => {
		for (const ws of sockets.get(displayId) ?? []) {
			if (msg.type === 'close')
				ws.close(1008, 'pantalla borrada') // su 'close' limpia la presencia
			else send(ws, msg)
		}
	})

	return {
		wss,
		close: () =>
			new Promise<void>((resolve) => {
				for (const ws of wss.clients) ws.terminate()
				wss.close(() => resolve())
			}),
	}
}
