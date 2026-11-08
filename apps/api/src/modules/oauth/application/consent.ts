import { randomBytes } from 'node:crypto'
import type { OAuthDecision, OAuthRequestInfo } from '@atekos/shared'
import type { TokenHasher } from '../../../shared/crypto'
import { NotFound } from '../../../shared/errors'
import type { OAuthRepository, OAuthStore } from '../domain/ports'

const CODE_TTL = 5 * 60

// Lo que hace la web con sesión: enseñar y decidir una petición de /authorize, y ver o revocar apps conectadas.
export class OAuthConsent {
	constructor(private readonly deps: { repo: OAuthRepository; store: OAuthStore; hasher: TokenHasher }) {}

	async getRequest(id: string): Promise<OAuthRequestInfo> {
		const r = await this.deps.store.getRequest(id)
		if (!r) throw NotFound('Solicitud de autorización')
		const u = new URL(r.redirectUri)
		return { clientName: r.clientName, redirectHost: u.host || u.protocol, scopes: r.scopes }
	}

	// La decisión consume la petición. El código queda a nombre de quien aprueba.
	async decide(userId: string, id: string, approve: boolean): Promise<OAuthDecision> {
		const r = await this.deps.store.takeRequest(id)
		if (!r) throw NotFound('Solicitud de autorización')
		const to = new URL(r.redirectUri)
		if (approve) {
			const code = randomBytes(32).toString('base64url')
			await this.deps.store.putCode(this.deps.hasher.hash(code), { ...r, userId }, CODE_TTL)
			to.searchParams.set('code', code)
		} else {
			to.searchParams.set('error', 'access_denied')
			to.searchParams.set('error_description', 'El usuario denegó el acceso')
		}
		if (r.state !== undefined) to.searchParams.set('state', r.state)
		return { redirectTo: to.href }
	}

	listGrants(userId: string) {
		return this.deps.repo.listGrants(userId)
	}

	async revokeGrant(userId: string, id: string) {
		if (!(await this.deps.repo.revokeGrant(id, userId))) throw NotFound('App conectada')
	}
}
