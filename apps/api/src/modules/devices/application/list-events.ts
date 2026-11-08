import type { Actor } from '../domain/policy'
import type { DeviceEventLog } from '../domain/ports'
import type { GetDevice } from './get-device'

export class ListEvents {
	constructor(private readonly deps: { get: GetDevice; eventLog: DeviceEventLog }) {}

	async execute(actor: Actor, id: string, limit: number) {
		await this.deps.get.execute(actor, id) // lanza NotFound si no puede leerlo
		return this.deps.eventLog.list(id, limit)
	}
}
