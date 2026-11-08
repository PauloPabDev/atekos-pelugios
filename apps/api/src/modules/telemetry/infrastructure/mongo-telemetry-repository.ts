import type { TelemetryReading } from '@atekos/shared'
import type { Db } from 'mongodb'
import type { TelemetryRepository } from '../domain/ports'

// `ts` es un Date (timeField) y `deviceId` un string (metaField), igual que en device_events.
type Doc = Omit<TelemetryReading, 'ts'> & { ts: Date }

export const makeMongoTelemetryRepository = (db: Db): TelemetryRepository => {
	const telemetry = db.collection<Doc>('telemetry')
	return {
		async append(r) {
			// Objeto nuevo: insertOne le añade `_id` al que recibe y `r` es la respuesta del POST.
			await telemetry.insertOne({ ...r, ts: new Date(r.ts) })
		},
		async list(deviceId, from, to, limit) {
			const docs = await telemetry
				.find({ deviceId, ts: { $gte: from, $lte: to } }, { projection: { _id: 0 } })
				.sort({ ts: 1 })
				.limit(limit)
				.toArray()
			return docs.map((d) => ({ ...d, ts: d.ts.toISOString() }))
		},
	}
}
