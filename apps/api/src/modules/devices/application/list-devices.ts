import { Forbidden } from '../../../shared/errors'
import type { Actor } from '../domain/policy'
import type { DeviceRepository } from '../domain/ports'

export class ListDevices {
	constructor(private readonly deps: { repo: DeviceRepository }) {}

	// Sesión o token con `devices:read`; un token ligado a un dispositivo solo ve ese.
	async execute(actor: Exclude<Actor, { kind: 'anonymous' }>) {
		if (actor.kind === 'token') {
			if (!actor.scopes.includes('devices:read')) throw Forbidden()
			if (actor.deviceId) {
				const device = await this.deps.repo.findById(actor.deviceId)
				return device ? [device] : []
			}
		}
		return this.deps.repo.listByOwner(actor.userId)
	}
}
