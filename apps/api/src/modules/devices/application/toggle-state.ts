import { NotFound, Forbidden } from '../../../shared/errors'
import { canRead, canWrite, type Actor } from '../domain/policy'
import type { DeviceRepository } from '../domain/ports'
import type { OnDeviceChanged, Source } from './on-device-changed'

export class ToggleState {
	constructor(private readonly deps: { repo: DeviceRepository; onChanged: OnDeviceChanged }) {}

	async execute(actor: Actor, deviceId: string, source: Source) {
		const before = await this.deps.repo.findById(deviceId)
		if (!before || !canRead(actor, before)) throw NotFound('Dispositivo')
		if (!canWrite(actor, before, 'devices:write')) throw Forbidden()
		const after = await this.deps.repo.toggleState(deviceId)
		await this.deps.onChanged({ type: 'state.changed', before, after, actor, source })
		return after
	}
}
