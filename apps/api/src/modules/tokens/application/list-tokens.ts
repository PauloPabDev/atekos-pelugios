import type { TokenRepository } from '../domain/ports'

export class ListTokens {
	constructor(private readonly deps: { repo: TokenRepository }) {}

	execute(userId: string) {
		return this.deps.repo.listByUser(userId)
	}
}
