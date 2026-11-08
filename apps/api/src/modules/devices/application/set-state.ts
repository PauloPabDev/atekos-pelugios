import { NotFound, Forbidden } from '../../../shared/errors'
import { canRead, canWrite, type Actor } from '../domain/policy'
import type { DeviceRepository } from '../domain/ports'
import type { OnDeviceChanged, Source } from './on-device-changed'

export class SetState {
	constructor(private readonly deps: { repo: DeviceRepository; onChanged: OnDeviceChanged }) {}

	async execute(actor: Actor, deviceId: string, state: boolean, source: Source) {
		const before = await this.deps.repo.findById(deviceId)
		if (!before || !canRead(actor, before)) throw NotFound('Dispositivo')
		if (!canWrite(actor, before, 'devices:write')) throw Forbidden()
		const after = await this.deps.repo.setState(deviceId, state)
		await this.deps.onChanged({ type: 'state.changed', before, after, actor, source })
		return after
	}
}
