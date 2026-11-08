import { randomBytes } from 'node:crypto'
import type { RedisClientType as Redis } from 'redis'
import type { SessionStore } from '../domain/ports'

export const makeRedisSessionStore = (redis: Redis, ttlSec: number): SessionStore => ({
	async create(userId) {
		const sid = randomBytes(32).toString('base64url')
		await redis.set(`sess:${sid}`, userId, { EX: ttlSec })
		return sid
	},
	get: (sid) => redis.get(`sess:${sid}`),
	async delete(sid) {
		await redis.del(`sess:${sid}`)
	},
})
