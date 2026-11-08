import { randomBytes } from 'node:crypto'
import type { LoginInput } from '@atekos/shared'
import { hashPassword, verifyPassword } from '../../../shared/crypto'
import { Unauthorized } from '../../../shared/errors'
import type { SessionStore, UserRepository } from '../domain/ports'

export class Login {
	// Si el email no existe se verifica igual contra este hash: tarda lo mismo y no revela qué emails hay.
	private readonly dummyHash = hashPassword(randomBytes(32).toString('hex'))

	constructor(private readonly deps: { users: UserRepository; sessions: SessionStore }) {}

	async execute({ email, password }: LoginInput) {
		const found = await this.deps.users.findByEmail(email)
		const ok = await verifyPassword(found?.passwordHash ?? (await this.dummyHash), password)
		if (!found || !ok) throw Unauthorized('Email o contraseña incorrectos')
		return { user: found.user, sid: await this.deps.sessions.create(found.user.id) }
	}
}
