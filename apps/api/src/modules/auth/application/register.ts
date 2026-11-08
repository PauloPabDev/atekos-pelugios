import type { RegisterInput } from '@atekos/shared'
import { hashPassword } from '../../../shared/crypto'
import { Conflict } from '../../../shared/errors'
import type { SessionStore, UserRepository } from '../domain/ports'

export class Register {
	constructor(private readonly deps: { users: UserRepository; sessions: SessionStore }) {}

	async execute({ email, username, password }: RegisterInput) {
		const user = await this.deps.users.create({ email, username, passwordHash: await hashPassword(password) })
		if (!user) throw Conflict('El email o el nombre de usuario ya están en uso')
		return { user, sid: await this.deps.sessions.create(user.id) }
	}
}
