import type { ApiToken, Scope } from '@atekos/shared'

// Lo que se guarda en `tok:{hash}` y usa resolveActor.
export type VerifiedToken = {
	id: string
	userId: string
	scopes: Scope[]
	deviceId: string | null
	displayId: string | null
	expiresAt: string | null
}

export interface TokenRepository {
	/** Consulta `devices` directamente: el módulo devices llega en la fase 6. */
	deviceBelongsTo(deviceId: string, userId: string): Promise<boolean>
	displayBelongsTo(displayId: string, userId: string): Promise<boolean>
	create(t: {
		userId: string
		deviceId: string | null
		displayId: string | null
		name: string
		prefix: string
		tokenHash: string
		scopes: Scope[]
		expiresAt: Date | null
	}): Promise<ApiToken>
	/** Incluye los revocados; más reciente primero. */
	listByUser(userId: string): Promise<ApiToken[]>
	/** Devuelve el hash del token, o null si no existe o es de otro usuario. */
	revoke(id: string, userId: string): Promise<string | null>
	/** revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) */
	findActiveByHash(hash: string): Promise<VerifiedToken | null>
	touchLastUsed(id: string): Promise<void>
}
