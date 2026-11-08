import type { DeviceRepository } from '../domain/ports'

export class ListPublicDevices {
	constructor(private readonly deps: { repo: DeviceRepository }) {}

	execute(page: number, limit: number) {
		return this.deps.repo.listPublic(page, limit)
	}
}
