import type { Db } from 'mongodb'
import type { DeviceEventLog, NewDeviceEvent } from '../domain/ports'

// `ts` es un Date (timeField) y `deviceId` un string (metaField): filtrar por él lo compara tal cual.
type Doc = NewDeviceEvent & { ts: Date }

export const makeMongoDeviceEventLog = (db: Db): DeviceEventLog => {
	const events = db.collection<Doc>('device_events')
	return {
		async append(e) {
			await events.insertOne({ ts: new Date(), ...e })
		},
		async list(deviceId, limit) {
			const docs = await events
				.find({ deviceId }, { projection: { _id: 0 } })
				.sort({ ts: -1 })
				.limit(limit)
				.toArray()
			return docs.map((d) => ({ ...d, ts: d.ts.toISOString() }))
		},
	}
}
