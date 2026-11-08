import { BadRequest } from '../../../shared/errors'
import type { GetDevice } from '../../devices/application/get-device'
import type { Actor } from '../../devices/domain/policy'
import type { TelemetryRepository } from '../domain/ports'

const DAY_MS = 24 * 60 * 60 * 1000

export class QueryTelemetry {
	constructor(private readonly deps: { get: GetDevice; repo: TelemetryRepository }) {}

	async execute(actor: Actor, id: string, q: { from?: string; to?: string; limit: number }) {
		await this.deps.get.execute(actor, id) // lanza NotFound si no puede leerlo
		// Por defecto, las 24 h anteriores a `to`, que por defecto es ahora.
		const to = q.to ? new Date(q.to) : new Date()
		const from = q.from ? new Date(q.from) : new Date(to.getTime() - DAY_MS)
		if (from > to) throw BadRequest('from no puede ser posterior a to')
		return this.deps.repo.list(id, from, to, q.limit)
	}
}
