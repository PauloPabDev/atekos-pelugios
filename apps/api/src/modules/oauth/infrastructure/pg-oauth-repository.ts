import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { Scope } from '@atekos/shared'
import { oauthClients, oauthGrants } from '../../../db/schema'
import type { OAuthRepository } from '../domain/ports'

const g = oauthGrants
const active = () => and(isNull(g.revokedAt), gt(g.refreshExpiresAt, sql`now()`))

export const makePgOAuthRepository = (db: NodePgDatabase): OAuthRepository => ({
	async getClient(id) {
		const [row] = await db.select({ info: oauthClients.info }).from(oauthClients).where(eq(oauthClients.id, id))
		return row?.info
	},
	async createClient(info) {
		await db.insert(oauthClients).values({ id: info.client_id, info })
		return info
	},
	async createGrant(grant) {
		await db.insert(g).values({ ...grant, lastUsedAt: sql`now()` })
	},
	async rotate(refreshHash, clientId, next) {
		// Un solo UPDATE: dos refrescos simultáneos con el mismo token no pueden ganar los dos.
		const [row] = await db
			.update(g)
			.set({ ...next, lastUsedAt: sql`now()` })
			.where(and(eq(g.refreshHash, refreshHash), eq(g.clientId, clientId), active()))
			.returning({ scopes: g.scopes })
		return row ? { scopes: row.scopes as Scope[] } : null
	},
	async findByAccess(accessHash) {
		const [row] = await db
			.select({
				id: g.id,
				userId: g.userId,
				clientId: g.clientId,
				scopes: g.scopes,
				accessExpiresAt: g.accessExpiresAt,
			})
			.from(g)
			.where(and(eq(g.accessHash, accessHash), isNull(g.revokedAt), gt(g.accessExpiresAt, sql`now()`)))
		return row ? { ...row, scopes: row.scopes as Scope[] } : null
	},
	async revokeByToken(hash, clientId) {
		await db
			.update(g)
			.set({ revokedAt: sql`coalesce(${g.revokedAt}, now())` })
			.where(and(eq(g.clientId, clientId), or(eq(g.accessHash, hash), eq(g.refreshHash, hash))))
	},
	async listGrants(userId) {
		const rows = await db
			.select({
				id: g.id,
				clientName: sql<string>`coalesce(${oauthClients.info}->>'client_name', ${oauthClients.id})`,
				scopes: g.scopes,
				createdAt: g.createdAt,
				lastUsedAt: g.lastUsedAt,
			})
			.from(g)
			.innerJoin(oauthClients, eq(oauthClients.id, g.clientId))
			.where(and(eq(g.userId, userId), active()))
			.orderBy(desc(g.createdAt))
		return rows.map((r) => ({
			...r,
			scopes: r.scopes as Scope[],
			createdAt: r.createdAt.toISOString(),
			lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
		}))
	},
	async revokeGrant(id, userId) {
		const rows = await db
			.update(g)
			.set({ revokedAt: sql`now()` })
			.where(and(eq(g.id, id), eq(g.userId, userId), isNull(g.revokedAt)))
			.returning({ id: g.id })
		return rows.length > 0
	},
})
