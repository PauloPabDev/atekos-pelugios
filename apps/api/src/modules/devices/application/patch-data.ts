import type { PatchDataInput } from '@atekos/shared'
import { NotFound, Forbidden } from '../../../shared/errors'
import { canRead, canWrite, type Actor } from '../domain/policy'
import type { DeviceRepository } from '../domain/ports'
import type { OnDeviceChanged } from './on-device-changed'

export class PatchData {
	constructor(private readonly deps: { repo: DeviceRepository; onChanged: OnDeviceChanged }) {}

	async execute(actor: Actor, deviceId: string, patch: PatchDataInput) {
		const before = await this.deps.repo.findById(deviceId)
		if (!before || !canRead(actor, before)) throw NotFound('Dispositivo')
		if (!canWrite(actor, before, 'devices:write')) throw Forbidden()
		const after = await this.deps.repo.mergeData(deviceId, patch)
		await this.deps.onChanged({ type: 'data.changed', before, after, actor, source: 'http' })
		return after
	}
}

// PATCH solo mezcla (`data || patch`): para quitar una clave hace falta esto. Mismo permiso y evento que PATCH.
export class DeleteDataKey {
	constructor(private readonly deps: { repo: DeviceRepository; onChanged: OnDeviceChanged }) {}

	async execute(actor: Actor, deviceId: string, key: string) {
		const before = await this.deps.repo.findById(deviceId)
		if (!before || !canRead(actor, before)) throw NotFound('Dispositivo')
		if (!canWrite(actor, before, 'devices:write')) throw Forbidden()
		if (!Object.hasOwn(before.data, key)) throw NotFound('Clave')
		const after = await this.deps.repo.deleteDataKey(deviceId, key)
		await this.deps.onChanged({ type: 'data.changed', before, after, actor, source: 'http' })
		return after
	}
}
