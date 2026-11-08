import type { RedisClientType as Redis } from 'redis'
import type { Device } from '@atekos/shared'
import type { DeviceCache } from '../domain/ports'

const TTL_SEC = 60 * 60
const key = (id: string) => `device:${id}`

export const makeRedisDeviceCache = (redis: Redis): DeviceCache => ({
	async get(id) {
		const raw = await redis.get(key(id))
		return raw ? (JSON.parse(raw) as Device) : null
	},
	async set(d) {
		await redis.set(key(d.id), JSON.stringify(d), { EX: TTL_SEC })
	},
	async delete(id) {
		await redis.del(key(id))
	},
})
