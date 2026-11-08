import type { RedisClientType as Redis } from 'redis'
import type { DisplayPresence } from '../domain/ports'

const CONN_TTL_MS = 75_000 // > 2 pings de 30 s: una conexión viva siempre se renueva antes de caducar
const KEY_TTL_SEC = 120
const key = (displayId: string) => `dpres:${displayId}`

// ZSET de DISENO §2: miembro = connId, score = expiración en ms. Online = algún score en el futuro.
export const makeRedisDisplayPresence = (redis: Redis): DisplayPresence => {
	const add = async (displayId: string, connId: string) => {
		const now = Date.now()
		await redis
			.multi()
			.zAdd(key(displayId), { score: now + CONN_TTL_MS, value: connId })
			.zRemRangeByScore(key(displayId), '-inf', now) // las de instancias caídas que nunca hicieron remove
			.expire(key(displayId), KEY_TTL_SEC)
			.exec()
	}
	return {
		add,
		renew: add,
		async remove(displayId, connId) {
			await redis.zRem(key(displayId), connId)
		},
		async isOnline(displayId) {
			return (await redis.zCount(key(displayId), Date.now(), '+inf')) > 0
		},
	}
}
