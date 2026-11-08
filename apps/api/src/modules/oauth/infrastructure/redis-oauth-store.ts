import type { RedisClientType as Redis } from 'redis'
import type { OAuthStore } from '../domain/ports'

const parse = <T>(s: string | null) => (s ? (JSON.parse(s) as T) : null)

export const makeRedisOAuthStore = (redis: Redis): OAuthStore => {
	const put = async (key: string, v: unknown, ttlSec: number) => {
		await redis.set(key, JSON.stringify(v), { EX: ttlSec })
	}
	return {
		putRequest: (id, r, ttl) => put(`oauth:req:${id}`, r, ttl),
		getRequest: async (id) => parse(await redis.get(`oauth:req:${id}`)),
		takeRequest: async (id) => parse(await redis.getDel(`oauth:req:${id}`)),
		putCode: (hash, c, ttl) => put(`oauth:code:${hash}`, c, ttl),
		getCode: async (hash) => parse(await redis.get(`oauth:code:${hash}`)),
		takeCode: async (hash) => parse(await redis.getDel(`oauth:code:${hash}`)),
	}
}
