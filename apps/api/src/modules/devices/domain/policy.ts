import type { Scope } from '@atekos/shared'

export type Actor =
	| { kind: 'anonymous' }
	| { kind: 'user'; userId: string }
	| { kind: 'token'; userId: string; tokenId: string; scopes: Scope[]; deviceId: string | null }

type Target = { id: string; ownerId: string; visibility: 'public' | 'private' }

export function canRead(actor: Actor, d: Target) {
	return d.visibility === 'public' || ownerWith(actor, d, 'devices:read')
}

export function canWrite(actor: Actor, d: Target, scope: Scope) {
	return ownerWith(actor, d, scope)
}

function ownerWith(actor: Actor, d: Target, scope: Scope) {
	if (actor.kind === 'anonymous' || actor.userId !== d.ownerId) return false
	if (actor.kind === 'user') return true
	return actor.scopes.includes(scope) && (actor.deviceId === null || actor.deviceId === d.id)
}
