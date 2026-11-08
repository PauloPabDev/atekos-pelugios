import { Unauthorized } from '../../../shared/errors'
import type { UserRepository } from '../domain/ports'

export class Me {
	constructor(private readonly deps: { users: UserRepository }) {}

	async execute(userId: string) {
		const user = await this.deps.users.findById(userId)
		if (!user) throw Unauthorized() // la sesión o el token sobreviven a un usuario que ya no existe
		return user
	}
}
