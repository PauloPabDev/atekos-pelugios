import type { Device, DeviceEventType } from '@atekos/shared'
import type { Logger } from 'pino'
import type { Actor } from '../domain/policy'
import type { DeviceCache, DeviceEventBus, DeviceEventLog, NewDeviceEvent } from '../domain/ports'

export type Source = 'http' | 'ws' | 'schedule'
export type DeviceChange = { type: DeviceEventType; before: Device | null; after: Device; actor: Actor; source: Source }
export type OnDeviceChanged = (change: DeviceChange) => Promise<void>

type Deps = { cache: DeviceCache; bus: DeviceEventBus; eventLog: DeviceEventLog; logger: Pick<Logger, 'error'> }

const actorRef = (a: Actor) => ({
	kind: a.kind,
	id: a.kind === 'user' ? a.userId : a.kind === 'token' ? a.tokenId : null,
})

// Documento de §5. En un borrado `after` es null y el dispositivo sale de `before`.
export function toEvent(c: Omit<DeviceChange, 'after'> & { after: Device | null }): NewDeviceEvent {
	const { id, ownerId } = (c.after ?? c.before)!
	return {
		deviceId: id,
		ownerId,
		type: c.type,
		before: c.before,
		after: c.after,
		actor: actorRef(c.actor),
		source: c.source,
	}
}

// Todo cambio pasa por aquí: caché → pub/sub → historial.
export const makeOnDeviceChanged =
	({ cache, bus, eventLog, logger }: Deps): OnDeviceChanged =>
	async (change) => {
		await cache.set(change.after)
		await bus.publish(change.after)
		await eventLog.append(toEvent(change)).catch((err) => logger.error({ err }, 'no se pudo guardar el evento'))
	}
