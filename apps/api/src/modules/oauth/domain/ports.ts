import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthGrant, Scope } from '@atekos/shared'

// Petición de /authorize ya validada por el SDK, a la espera del consentimiento (oauth:req:{id}).
export type PendingRequest = {
	clientId: string
	clientName: string
	redirectUri: string
	codeChallenge: string
	state?: string
	scopes: Scope[]
}

// Código de autorización (oauth:code:{hash}): la petición aprobada por un usuario.
export type AuthCode = PendingRequest & { userId: string }

// Hashes y caducidades del par access/refresh que se emite o rota.
export type TokenPair = { accessHash: string; accessExpiresAt: Date; refreshHash: string; refreshExpiresAt: Date }

export type ActiveGrant = { id: string; userId: string; clientId: string; scopes: Scope[]; accessExpiresAt: Date }

export interface OAuthRepository {
	getClient(id: string): Promise<OAuthClientInformationFull | undefined>
	createClient(info: OAuthClientInformationFull): Promise<OAuthClientInformationFull>
	createGrant(g: { userId: string; clientId: string; scopes: Scope[] } & TokenPair): Promise<void>
	/** Rota el par si el refresh es de ese cliente, no está revocado ni caducado. null si no. */
	rotate(refreshHash: string, clientId: string, next: TokenPair): Promise<{ scopes: Scope[] } | null>
	/** Grant no revocado cuyo access vigente tiene ese hash. */
	findByAccess(accessHash: string): Promise<ActiveGrant | null>
	/** Revoca el grant de ese cliente que tenga el token (access o refresh); si no hay ninguno, nada. */
	revokeByToken(hash: string, clientId: string): Promise<void>
	/** Apps conectadas: grants sin revocar con el refresh vigente; más reciente primero. */
	listGrants(userId: string): Promise<OAuthGrant[]>
	/** false si no existe, es de otro usuario o ya estaba revocado. */
	revokeGrant(id: string, userId: string): Promise<boolean>
}

export interface OAuthStore {
	putRequest(id: string, r: PendingRequest, ttlSec: number): Promise<void>
	getRequest(id: string): Promise<PendingRequest | null>
	/** Lee y borra: una petición se decide una sola vez. */
	takeRequest(id: string): Promise<PendingRequest | null>
	putCode(hash: string, c: AuthCode, ttlSec: number): Promise<void>
	getCode(hash: string): Promise<AuthCode | null>
	/** Lee y borra: un código se canjea una sola vez. */
	takeCode(hash: string): Promise<AuthCode | null>
}
