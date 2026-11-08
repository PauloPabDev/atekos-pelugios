import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { ApiToken, Scope } from '@atekos/shared'
import { apiTokens, devices } from '../../../db/schema'
import type { TokenRepository } from '../domain/ports'

// Columnas que ve el cliente: nunca el hash.
const publicCols = {
	id: apiTokens.id,
	name: apiTokens.name,
	prefix: apiTokens.prefix,
	scopes: apiTokens.scopes,
	deviceId: apiTokens.deviceId,
	expiresAt: apiTokens.expiresAt,
	lastUsedAt: apiTokens.lastUsedAt,
	revokedAt: apiTokens.revokedAt,
	createdAt: apiTokens.createdAt,
}

const iso = (d: Date | null) => d?.toISOString() ?? null

const toApiToken = (r: Omit<typeof apiTokens.$inferSelect, 'userId' | 'tokenHash'>): ApiToken => ({
	...r,
	scopes: r.scopes as Scope[],
	expiresAt: iso(r.expiresAt),
	lastUsedAt: iso(r.lastUsedAt),
	revokedAt: iso(r.revokedAt),
	createdAt: r.createdAt.toISOString(),
})

export const makePgTokenRepository = (db: NodePgDatabase): TokenRepository => ({
	async deviceBelongsTo(deviceId, userId) {
		const rows = await db
			.select({ id: devices.id })
			.from(devices)
			.where(and(eq(devices.id, deviceId), eq(devices.ownerId, userId)))
		return rows.length > 0
	},
	async create(t) {
		const [row] = await db.insert(apiTokens).values(t).returning(publicCols)
		return toApiToken(row!)
	},
	async listByUser(userId) {
		const rows = await db
			.select(publicCols)
			.from(apiTokens)
			.where(eq(apiTokens.userId, userId))
			.orderBy(desc(apiTokens.createdAt))
		return rows.map(toApiToken)
	},
	async revoke(id, userId) {
		const [row] = await db
			.update(apiTokens)
			.set({ revokedAt: sql`coalesce(${apiTokens.revokedAt}, now())` }) // revocar dos veces conserva la fecha original
			.where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
			.returning({ hash: apiTokens.tokenHash })
		return row?.hash ?? null
	},
	async findActiveByHash(hash) {
		const [row] = await db
			.select({
				id: apiTokens.id,
				userId: apiTokens.userId,
				scopes: apiTokens.scopes,
				deviceId: apiTokens.deviceId,
				expiresAt: apiTokens.expiresAt,
			})
			.from(apiTokens)
			.where(
				and(
					eq(apiTokens.tokenHash, hash),
					isNull(apiTokens.revokedAt),
					or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, sql`now()`)),
				),
			)
		return row ? { ...row, scopes: row.scopes as Scope[], expiresAt: iso(row.expiresAt) } : null
	},
	async touchLastUsed(id) {
		await db
			.update(apiTokens)
			.set({ lastUsedAt: sql`now()` })
			.where(eq(apiTokens.id, id))
	},
})
