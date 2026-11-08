import type { Request, RequestHandler } from 'express'
import type { RedisClientType as Redis } from 'redis'
import { TooManyRequests } from './errors'

// Ventana fija por clave: un contador en Redis que caduca con la ventana.
export const rateLimit =
	(redis: Redis, o: { name: string; windowSec: number; max: number; key: (r: Request) => string }): RequestHandler =>
	async (req, _res, next) => {
		const k = `rl:${o.name}:${o.key(req)}:${Math.floor(Date.now() / 1000 / o.windowSec)}`
		const n = await redis.incr(k)
		if (n === 1) await redis.expire(k, o.windowSec)
		if (n > o.max) throw TooManyRequests()
		next()
	}
