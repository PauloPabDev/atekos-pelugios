import type { RedisClientType as Redis } from 'redis'
import type { DisplayOutbox, DisplayOutMessage } from '../domain/ports'

const CHANNEL = 'display-out'

// Misma pareja de conexiones que el bus de devices: `sub` ya está en modo subscribe y admite varios canales.
export const makeRedisDisplayOutbox = (redis: Redis, sub: Redis): DisplayOutbox => ({
	publish: (displayId, message) => redis.publish(CHANNEL, JSON.stringify({ displayId, message })).then(() => {}),
	subscribe: (fn) =>
		sub.subscribe(CHANNEL, (raw) => {
			const { displayId, message } = JSON.parse(raw) as { displayId: string; message: DisplayOutMessage }
			fn(displayId, message)
		}),
})
