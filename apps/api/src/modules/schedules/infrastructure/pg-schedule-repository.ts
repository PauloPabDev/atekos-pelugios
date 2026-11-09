import { and, asc, count, eq, getTableColumns, lte, sql, type SQL } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { displays, schedules } from '../../../db/schema'
import { NotFound } from '../../../shared/errors'
import type { ScheduleRecord, ScheduleRepository, Target } from '../domain/ports'

const cols = { ...getTableColumns(schedules), hardwareId: displays.hardwareId }
const byTarget = (t: Target): SQL =>
	'deviceId' in t ? eq(schedules.deviceId, t.deviceId) : eq(schedules.displayId, t.displayId)
// Activos primero y por cuándo tocan; los pausados detrás
const order = [sql`${schedules.nextRunAt} asc nulls last`, asc(schedules.createdAt)]

export const makePgScheduleRepository = (db: NodePgDatabase): ScheduleRepository => {
	const select = () => db.select(cols).from(schedules).leftJoin(displays, eq(displays.id, schedules.displayId))
	const byId = async (id: string) => (await select().where(eq(schedules.id, id)))[0] ?? null

	return {
		listByTarget: (t) =>
			select()
				.where(byTarget(t))
				.orderBy(...order),
		listByOwner: (ownerId) =>
			select()
				.where(eq(schedules.ownerId, ownerId))
				.orderBy(...order),
		async countByTarget(t) {
			const [r] = await db.select({ n: count() }).from(schedules).where(byTarget(t))
			return r?.n ?? 0
		},
		findById: byId,
		async create(s) {
			const [row] = await db.insert(schedules).values(s).returning({ id: schedules.id })
			return (await byId(row!.id))!
		},
		async update(id, changes) {
			const [row] = await db.update(schedules).set(changes).where(eq(schedules.id, id)).returning({ id: schedules.id })
			if (!row) throw NotFound('Programa')
			return (await byId(id))!
		},
		async delete(id) {
			await db.delete(schedules).where(eq(schedules.id, id))
		},
		claimDue: (now, limit, next) =>
			db.transaction(async (tx) => {
				const due = await tx
					.select(cols)
					.from(schedules)
					.leftJoin(displays, eq(displays.id, schedules.displayId))
					.where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, now)))
					.orderBy(asc(schedules.nextRunAt))
					.limit(limit)
					.for('update', { of: schedules, skipLocked: true })
				for (const s of due) {
					const nextRunAt = next(s as ScheduleRecord)
					// Una vez: tras correr queda pausado (sin próxima) para que se vea como «hecho»
					await tx
						.update(schedules)
						.set({ nextRunAt, lastRunAt: now, enabled: nextRunAt !== null })
						.where(eq(schedules.id, s.id))
				}
				return due.map((s) => ({ ...(s as ScheduleRecord), dueAt: s.nextRunAt! }))
			}),
		async setResult(id, result) {
			await db.update(schedules).set({ lastResult: result }).where(eq(schedules.id, id))
		},
	}
}
