import type { RedisClientType as Redis } from 'redis'
import type { Device } from '@atekos/shared'
import type { DeviceEventBus } from '../domain/ports'

const CHANNEL = 'device-events'

// Dos conexiones: una conexión en modo subscribe no puede ejecutar otros comandos.
export const makeRedisDeviceEventBus = (redis: Redis, sub: Redis): DeviceEventBus => ({
	publish: (d) => redis.publish(CHANNEL, JSON.stringify(d)).then(() => {}),
	subscribe: (fn) => sub.subscribe(CHANNEL, (raw) => fn(JSON.parse(raw) as Device)),
})
