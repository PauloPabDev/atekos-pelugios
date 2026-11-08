import type { TelemetryInput, TelemetryReading } from '@atekos/shared'
import { Forbidden } from '../../../shared/errors'
import type { GetDevice } from '../../devices/application/get-device'
import { canWrite, type Actor } from '../../devices/domain/policy'
import type { TelemetryRepository } from '../domain/ports'

export class IngestTelemetry {
	constructor(private readonly deps: { get: GetDevice; repo: TelemetryRepository }) {}

	async execute(actor: Actor, id: string, input: TelemetryInput): Promise<TelemetryReading> {
		const device = await this.deps.get.execute(actor, id) // lanza NotFound si no puede leerlo
		if (!canWrite(actor, device, 'telemetry:write')) throw Forbidden()
		// Sin `ts`, la hora del servidor. toISOString deja la precisión en milisegundos, la misma que guarda Mongo.
		const reading = { ts: new Date(input.ts ?? Date.now()).toISOString(), deviceId: id, values: input.values }
		await this.deps.repo.append(reading)
		return reading
	}
}
