import type { User } from '@atekos/shared'

export interface UserRepository {
	/** null si el email o el username ya existen (violación de unique en PG). */
	create(u: { email: string; username: string; passwordHash: string }): Promise<User | null>
	findByEmail(email: string): Promise<{ user: User; passwordHash: string } | null>
	findById(id: string): Promise<User | null>
}

export interface SessionStore {
	/** Crea `sess:{sid}` con el TTL de sesión y devuelve el sid. */
	create(userId: string): Promise<string>
	/** userId de la sesión, o null si no existe o caducó. */
	get(sid: string): Promise<string | null>
	delete(sid: string): Promise<void>
}
