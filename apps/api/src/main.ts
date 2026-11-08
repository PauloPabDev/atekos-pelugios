import http from 'node:http'
import pino from 'pino'
import { z } from 'zod'
import { loadEnv } from './config/env'
import { createContainer } from './container'
import { buildApp } from './app'
import { attachWebSocket } from './ws/server'
import { attachDeviceWebSocket } from './ws/device-server'

const env = (() => {
	try {
		return loadEnv()
	} catch (err) {
		// Mensaje claro y salida antes de conectar a nada; prettifyError no imprime los valores (secretos).
		console.error(`Entorno inválido:\n${err instanceof z.ZodError ? z.prettifyError(err) : err}`)
		process.exit(1)
	}
})()

const logger = pino()
const c = await createContainer(env, logger)
const server = http.createServer(buildApp(c))
const ws = await attachWebSocket(server, c)
const deviceWs = await attachDeviceWebSocket(server, c)
server.listen(env.PORT, () => logger.info({ port: env.PORT }, 'api escuchando'))

const shutdown = (signal: string) => {
	logger.info({ signal }, 'cerrando')
	server.close(async () => {
		await c.close()
		process.exit(0)
	})
	// Los sockets WS cuentan como conexiones abiertas: hasta cerrarlos, server.close no llama a su callback.
	void ws.close()
	void deviceWs.close()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
