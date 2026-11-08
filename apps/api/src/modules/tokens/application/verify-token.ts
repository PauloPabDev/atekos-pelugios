import type { RedisClientType as Redis } from 'redis'
import type { TokenHasher } from '../../../shared/crypto'
import type { TokenRepository, VerifiedToken } from '../domain/ports'

export class VerifyToken {
	constructor(private readonly deps: { repo: TokenRepository; redis: Redis; hasher: TokenHasher }) {}

	async execute(plain: string) {
		const hash = this.deps.hasher.hash(plain)
		const cached = await this.deps.redis.get(`tok:${hash}`)
		if (cached) return JSON.parse(cached) as VerifiedToken
		const token = await this.deps.repo.findActiveByHash(hash)
		if (!token) return null
		// La caché nunca sobrevive al vencimiento: min(60 s, segundos que le quedan), redondeado hacia abajo.
		const left = token.expiresAt ? Math.floor((Date.parse(token.expiresAt) - Date.now()) / 1000) : 60
		const ttl = Math.min(60, left)
		if (ttl > 0) await this.deps.redis.set(`tok:${hash}`, JSON.stringify(token), { EX: ttl })
		await this.deps.repo.touchLastUsed(token.id) // como mucho una escritura por minuto por token
		return token
	}
}
