import type { RedisClientType as Redis } from 'redis'
import type { Device } from '@atekos/shared'
import type { DeviceCache } from '../domain/ports'

const TTL_SEC = 60 * 60
const key = (id: string) => `device:${id}`

// SET solo si no hay nada más nuevo en caché: con escrituras concurrentes el último SET en llegar puede ser el
// de un UPDATE anterior. updatedAt sale de clock_timestamp() (orden de bloqueo de fila) en ISO, comparable como texto.
// shortcut: precisión de ms (toISOString); dos escrituras en el mismo ms pueden quedar en cualquier orden.
const SET_IF_NEWER = `
local cur = redis.call('GET', KEYS[1])
if cur and cjson.decode(cur).updatedAt > ARGV[2] then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1`

export const makeRedisDeviceCache = (redis: Redis): DeviceCache => ({
	async get(id) {
		const raw = await redis.get(key(id))
		return raw ? (JSON.parse(raw) as Device) : null
	},
	async set(d) {
		await redis.eval(SET_IF_NEWER, { keys: [key(d.id)], arguments: [JSON.stringify(d), d.updatedAt, String(TTL_SEC)] })
	},
	async delete(id) {
		await redis.del(key(id))
	},
})
