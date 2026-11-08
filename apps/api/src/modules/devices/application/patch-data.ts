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
