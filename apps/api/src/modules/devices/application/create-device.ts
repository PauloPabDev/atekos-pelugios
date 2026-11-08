import type { CreateDeviceInput } from '@atekos/shared'
import { Conflict } from '../../../shared/errors'
import type { Actor } from '../domain/policy'
import type { DeviceRepository } from '../domain/ports'
import type { OnDeviceChanged } from './on-device-changed'

export class CreateDevice {
	constructor(private readonly deps: { repo: DeviceRepository; onChanged: OnDeviceChanged }) {}

	// Solo sesión (§7.3). La alta también pasa por onChanged: el «room.create nunca se emite» de hoy.
	async execute(actor: Extract<Actor, { kind: 'user' }>, input: CreateDeviceInput) {
		const after = await this.deps.repo.create({ ...input, ownerId: actor.userId })
		if (!after) throw Conflict('Ya tienes un dispositivo con ese slug')
		await this.deps.onChanged({ type: 'device.created', before: null, after, actor, source: 'http' })
		return after
	}
}
