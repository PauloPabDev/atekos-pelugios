import type { CreateDeviceInput } from '@atekos/shared'
import { Conflict, Forbidden } from '../../../shared/errors'
import { canCreate, type Actor } from '../domain/policy'
import type { DeviceRepository } from '../domain/ports'
import type { OnDeviceChanged } from './on-device-changed'

export class CreateDevice {
	constructor(private readonly deps: { repo: DeviceRepository; onChanged: OnDeviceChanged }) {}

	// La REST solo llega con sesión (§7.3); el MCP, con un token OAuth con devices:write (canCreate).
	// La alta también pasa por onChanged: el «room.create nunca se emite» de hoy.
	async execute(actor: Actor, input: CreateDeviceInput) {
		if (actor.kind === 'anonymous' || !canCreate(actor, 'devices:write')) throw Forbidden()
		const after = await this.deps.repo.create({ ...input, ownerId: actor.userId })
		if (!after) throw Conflict('Ya tienes un dispositivo con ese slug')
		await this.deps.onChanged({ type: 'device.created', before: null, after, actor, source: 'http' })
		return after
	}
}
