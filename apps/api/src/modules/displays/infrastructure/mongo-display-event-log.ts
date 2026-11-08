import type { Db } from 'mongodb'
import type { DisplayEventLog, NewCommandEvent, NewTouchEvent } from '../domain/ports'

// Los dos tipos de documento de DISENO §2. `displayId` es el uuid como string (metaField).
type Doc = { ts: Date } & ((NewTouchEvent & { kind: 'touch' }) | (NewCommandEvent & { kind: 'command' }))
type TouchDoc = Extract<Doc, { kind: 'touch' }>

export const makeMongoDisplayEventLog = (db: Db): DisplayEventLog => {
	const events = db.collection<Doc>('display_events')
	return {
		async appendTouch(e) {
			await events.insertOne({ ts: new Date(), kind: 'touch', ...e })
		},
		async listTouches(displayId, limit) {
			const docs = await events
				.find<TouchDoc>({ displayId, kind: 'touch' })
				.sort({ ts: -1, _id: -1 }) // _id desempata dos toques del mismo ms
				.limit(limit)
				.toArray()
			return docs.map((d) => ({
				ts: d.ts.toISOString(),
				eventId: d.eventId,
				actionId: d.actionId,
				name: d.name,
				x: d.x,
				y: d.y,
				templateId: d.templateId,
				templateVersion: d.templateVersion,
				status: d.status,
				toast: d.toast,
			}))
		},
		async appendCommand(e) {
			await events.insertOne({ ts: new Date(), kind: 'command', ...e })
		},
	}
}
