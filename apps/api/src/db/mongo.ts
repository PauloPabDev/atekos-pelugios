import type { Db } from 'mongodb'

const DAY = 60 * 60 * 24

export async function ensureMongo(db: Db) {
	const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name))
	if (!names.has('device_events'))
		await db.createCollection('device_events', {
			timeseries: { timeField: 'ts', metaField: 'deviceId', granularity: 'seconds' },
			expireAfterSeconds: 180 * DAY,
		})
	if (!names.has('telemetry'))
		await db.createCollection('telemetry', {
			timeseries: { timeField: 'ts', metaField: 'deviceId', granularity: 'minutes' },
			expireAfterSeconds: 365 * DAY,
		})
	// MetaDisplay: toques y auditoría de comandos (docs/metadisplay/DISENO.md §2)
	if (!names.has('display_events'))
		await db.createCollection('display_events', {
			timeseries: { timeField: 'ts', metaField: 'displayId', granularity: 'seconds' },
			expireAfterSeconds: 90 * DAY,
		})
}
