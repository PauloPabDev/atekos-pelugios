import { setTimeout } from 'node:timers/promises'
import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { ZodError } from 'zod'
import type { Container } from './container'
import { AppError, NotFound, UnsupportedMediaType } from './shared/errors'
import { authenticate } from './shared/auth'
import { rateLimit } from './shared/rate-limit'
import { authRoutes } from './modules/auth/infrastructure/http-routes'
import { tokenRoutes } from './modules/tokens/infrastructure/http-routes'
import { deviceRoutes } from './modules/devices/infrastructure/http-routes'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Sin límite, el ping a una BD caída se cuelga (node-redis encola comandos mientras reconecta) y /health nunca da 503.
const within = (p: Promise<unknown>, ms = 2000) =>
	Promise.race([p, setTimeout(ms, undefined, { ref: false }).then(() => Promise.reject(new Error('timeout')))])

export function buildApp(c: Container) {
	const app = express()
	app.set('trust proxy', 1)
	app.use(helmet())
	app.use(
		pinoHttp({
			logger: c.logger,
			redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
		}),
	)
	// CSRF (§9): las escrituras con cuerpo solo se aceptan en JSON. `Content-Length: 0` no cuenta como cuerpo.
	app.use((req, _res, next) => {
		const hasBody = req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length']) > 0
		if (WRITE_METHODS.has(req.method) && hasBody && !req.is('application/json')) throw UnsupportedMediaType()
		next()
	})
	app.use(express.json({ limit: '32kb' }))

	const api = express.Router()
	api.get('/health', async (_req, res) => {
		const checks = {
			postgres: () => c.pool.query('select 1'),
			mongo: () => c.mongo.command({ ping: 1 }),
			redis: () => c.redis.ping(),
		}
		const results = await Promise.allSettled(Object.values(checks).map((check) => within(check())))
		const failed = Object.keys(checks).filter((_, i) => results[i]?.status === 'rejected')
		if (failed.length) return res.status(503).json({ status: 'error', failed })
		res.json({ status: 'ok' })
	})
	// Después de /health: el healthcheck no depende de Redis para resolver el actor.
	api.use(authenticate(c))
	// Resto de la API (§9): 300 por minuto por actor, o por IP si es anónimo.
	api.use(
		rateLimit(c.redis, {
			name: 'api',
			windowSec: 60,
			max: 300,
			key: ({ actor, ip }) => (actor.kind === 'user' ? actor.userId : actor.kind === 'token' ? actor.tokenId : `${ip}`),
		}),
	)
	api.use('/auth', authRoutes(c))
	api.use('/tokens', tokenRoutes(c))
	api.use(deviceRoutes(c))

	app.use('/api/v1', api)
	app.use('/api', () => {
		throw NotFound('Recurso')
	})
	app.use(errorHandler)
	return app
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express solo trata como handler de error a los de 4 parámetros
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
	if (err instanceof AppError) return res.status(err.status).json({ error: err.code, message: err.message })
	if (err instanceof ZodError) return res.status(400).json({ error: 'validation', issues: err.issues })
	// body-parser lanza http-errors 4xx con `expose` (JSON mal formado, cuerpo > 32kb): son culpa del cliente, no 500.
	if (err instanceof Error && 'expose' in err && err.expose && 'status' in err && typeof err.status === 'number')
		return res.status(err.status).json({ error: 'invalid_body', message: err.message })
	req.log.error({ err }, 'error no controlado')
	res.status(500).json({ error: 'internal', message: 'Error interno' })
}
