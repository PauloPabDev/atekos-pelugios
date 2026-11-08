import { asc, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Device } from '@atekos/shared'
import { apiTokens, devices } from '../../../db/schema'
import { NotFound } from '../../../shared/errors'
import type { DeviceRepository } from '../domain/ports'

type Row = typeof devices.$inferSelect

// Fechas en ISO: así el JSON es idéntico venga de PG o de Redis.
const toDevice = (r: Row): Device => ({
	...r,
	createdAt: r.createdAt.toISOString(),
	updatedAt: r.updatedAt.toISOString(),
})

// Primera fila de un UPDATE … RETURNING. Sin fila, el dispositivo se borró entre la lectura y la escritura.
async function one(q: Promise<Row[]>) {
	const [row] = await q
	if (!row) throw NotFound('Dispositivo')
	return toDevice(row)
}

export const makePgDeviceRepository = (db: NodePgDatabase): DeviceRepository => ({
	async create(d) {
		const [row] = await db
			.insert(devices)
			.values(d)
			.onConflictDoNothing({ target: [devices.ownerId, devices.slug] })
			.returning()
		return row ? toDevice(row) : null
	},
	async findById(id) {
		const [row] = await db.select().from(devices).where(eq(devices.id, id))
		return row ? toDevice(row) : null
	},
	async listByOwner(ownerId) {
		const rows = await db.select().from(devices).where(eq(devices.ownerId, ownerId)).orderBy(asc(devices.createdAt))
		return rows.map(toDevice)
	},
	async listPublic(page, limit) {
		const rows = await db
			.select()
			.from(devices)
			.where(eq(devices.visibility, 'public'))
			.orderBy(asc(devices.createdAt), asc(devices.id)) // id desempata: la paginación no repite ni salta filas
			.limit(limit)
			.offset((page - 1) * limit)
		return rows.map(toDevice)
	},
	update(id, patch) {
		return one(
			db
				.update(devices)
				.set({ ...patch, updatedAt: sql`clock_timestamp()` })
				.where(eq(devices.id, id))
				.returning(),
		)
	},
	setState(id, state) {
		return one(
			db
				.update(devices)
				.set({ state, updatedAt: sql`clock_timestamp()` })
				.where(eq(devices.id, id))
				.returning(),
		)
	},
	toggleState(id) {
		return one(
			db
				.update(devices)
				.set({ state: sql`NOT ${devices.state}`, updatedAt: sql`clock_timestamp()` })
				.where(eq(devices.id, id))
				.returning(),
		)
	},
	mergeData(id, patch) {
		return one(
			db
				.update(devices)
				.set({ data: sql`${devices.data} || ${JSON.stringify(patch)}::jsonb`, updatedAt: sql`clock_timestamp()` })
				.where(eq(devices.id, id))
				.returning(),
		)
	},
	async delete(id) {
		// Se leen antes de borrar: después ya no están (cascade).
		const tokens = await db.select({ hash: apiTokens.tokenHash }).from(apiTokens).where(eq(apiTokens.deviceId, id))
		await db.delete(devices).where(eq(devices.id, id))
		return tokens.map((t) => t.hash)
	},
})
