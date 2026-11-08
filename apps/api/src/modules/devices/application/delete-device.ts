import type { Logger } from 'pino'
import type { RedisClientType as Redis } from 'redis'
import { NotFound, Forbidden } from '../../../shared/errors'
import { canRead, canWrite, type Actor } from '../domain/policy'
import type { DeviceCache, DeviceEventLog, DeviceRepository } from '../domain/ports'
import { toEvent } from './on-device-changed'

type Deps = {
	repo: DeviceRepository
	cache: DeviceCache
	eventLog: DeviceEventLog
	redis: Redis
	logger: Pick<Logger, 'error'>
}

export class DeleteDevice {
	constructor(private readonly deps: Deps) {}

	// Solo sesión (§7.3). Para un usuario, canWrite = ser el dueño.
	async execute(actor: Extract<Actor, { kind: 'user' }>, deviceId: string) {
		const before = await this.deps.repo.findById(deviceId)
		if (!before || !canRead(actor, before)) throw NotFound('Dispositivo')
		if (!canWrite(actor, before, 'devices:write')) throw Forbidden()
		const hashes = await this.deps.repo.delete(deviceId)
		await this.deps.cache.delete(deviceId)
		// Los tokens ligados cayeron en cascada, pero seguirían valiendo hasta 60 s desde `tok:{hash}`.
		if (hashes.length) await this.deps.redis.del(hashes.map((h) => `tok:${h}`))
		await this.deps.eventLog
			.append(toEvent({ type: 'device.deleted', before, after: null, actor, source: 'http' }))
			.catch((err) => this.deps.logger.error({ err }, 'no se pudo guardar el evento'))
	}
}
