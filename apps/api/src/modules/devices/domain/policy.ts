import type { Scope } from '@atekos/shared'

export type Actor =
	| { kind: 'anonymous' }
	| { kind: 'user'; userId: string }
	// displayId: token ligado a una pantalla MetaDisplay (ausente = no ligado)
	| {
			kind: 'token'
			userId: string
			tokenId: string
			scopes: Scope[]
			deviceId: string | null
			displayId?: string | null
	  }

type Target = { id: string; ownerId: string; visibility: 'public' | 'private' }

export function canRead(actor: Actor, d: Target) {
	return d.visibility === 'public' || ownerWith(actor, d, 'devices:read')
}

export function canWrite(actor: Actor, d: Target, scope: Scope) {
	return ownerWith(actor, d, scope)
}

// Altas (dispositivos y pantallas): la sesión, o un token sin ligar con el scope de escritura (el MCP con OAuth,
// docs/MCP.md). Las rutas REST siguen exigiendo sesión; esto es lo que permite el caso de uso.
export function canCreate(actor: Actor, scope: 'devices:write' | 'displays:write') {
	if (actor.kind === 'user') return true
	if (actor.kind !== 'token' || actor.deviceId || actor.displayId) return false
	return actor.scopes.includes(scope) && !actor.scopes.includes('display:connect')
}

function ownerWith(actor: Actor, d: Target, scope: Scope) {
	if (actor.kind === 'anonymous' || actor.userId !== d.ownerId) return false
	if (actor.kind === 'user') return true
	return actor.scopes.includes(scope) && (actor.deviceId === null || actor.deviceId === d.id)
}
