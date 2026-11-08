import type { CreatedApiToken, CreateTokenInput } from '@atekos/shared'
import type { TokenHasher } from '../../../shared/crypto'
import { NotFound } from '../../../shared/errors'
import type { TokenRepository } from '../domain/ports'

const DAY_MS = 24 * 60 * 60 * 1000

export class CreateToken {
	constructor(private readonly deps: { repo: TokenRepository; hasher: TokenHasher }) {}

	// Solo con sesión (la ruta usa requireUser): un token nunca crea tokens.
	async execute(userId: string, input: CreateTokenInput): Promise<CreatedApiToken> {
		const deviceId = input.deviceId ?? null
		if (deviceId && !(await this.deps.repo.deviceBelongsTo(deviceId, userId))) throw NotFound('Dispositivo')
		const { plain, prefix, hash } = this.deps.hasher.create()
		const token = await this.deps.repo.create({
			userId,
			deviceId,
			name: input.name,
			prefix,
			tokenHash: hash,
			scopes: input.scopes,
			expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * DAY_MS) : null,
		})
		return { ...token, token: plain } // el valor en claro sale solo en esta respuesta
	}
}
