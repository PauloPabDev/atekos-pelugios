import { NotFound } from '../../../shared/errors'
import { canRead, type Actor } from '../domain/policy'
import type { DeviceCache, DeviceRepository } from '../domain/ports'

export class GetState {
	constructor(private readonly deps: { repo: DeviceRepository; cache: DeviceCache }) {}

	// El polling del ESP: pega en Redis, no en Postgres.
	async execute(actor: Actor, id: string) {
		let device = await this.deps.cache.get(id)
		if (!device) {
			device = await this.deps.repo.findById(id)
			if (device) await this.deps.cache.set(device)
		}
		if (!device || !canRead(actor, device)) throw NotFound('Dispositivo')
		return device.state
	}
}
