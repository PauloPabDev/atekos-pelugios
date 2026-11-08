import type { RedisClientType as Redis } from 'redis'
import { NotFound } from '../../../shared/errors'
import type { TokenRepository } from '../domain/ports'

export class RevokeToken {
	constructor(private readonly deps: { repo: TokenRepository; redis: Redis }) {}

	async execute(userId: string, id: string) {
		const hash = await this.deps.repo.revoke(id, userId)
		if (!hash) throw NotFound('Token')
		await this.deps.redis.del(`tok:${hash}`) // sin esto seguiría valiendo hasta 60 s desde la caché
	}
}
