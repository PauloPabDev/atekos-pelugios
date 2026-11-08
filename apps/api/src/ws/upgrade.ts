import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'

type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void
const routes = new WeakMap<Server, Map<string, UpgradeHandler>>()

// Un único listener de 'upgrade' por servidor: reparte por ruta exacta (/ws, /ws/device) y corta cualquier otra.
export function onUpgrade(server: Server, path: string, handler: UpgradeHandler) {
	let byPath = routes.get(server)
	if (!byPath) {
		const m = new Map<string, UpgradeHandler>()
		routes.set(server, (byPath = m))
		server.on('upgrade', (req, socket, head) => {
			// split y no new URL: un req.url raro no puede lanzar dentro del listener.
			const h = m.get((req.url ?? '/').split('?')[0]!)
			if (!h) return socket.destroy()
			h(req, socket, head)
		})
	}
	byPath.set(path, handler)
}
