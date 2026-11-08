import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { users } from '../../../db/schema'
import type { UserRepository } from '../domain/ports'

const publicCols = { id: users.id, email: users.email, username: users.username }

export const makePgUserRepository = (db: NodePgDatabase): UserRepository => ({
	async create(u) {
		// ON CONFLICT DO NOTHING sin target cubre los unique de email y username en una sola sentencia atómica.
		const [row] = await db.insert(users).values(u).onConflictDoNothing().returning(publicCols)
		return row ?? null
	},
	async findByEmail(email) {
		const [row] = await db
			.select({ user: publicCols, passwordHash: users.passwordHash })
			.from(users)
			.where(eq(users.email, email))
		return row ?? null
	},
	async findById(id) {
		const [row] = await db.select(publicCols).from(users).where(eq(users.id, id))
		return row ?? null
	},
})
