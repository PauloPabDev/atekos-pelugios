import type { Actor } from '../../devices/domain/policy'

type Target = { id: string; ownerId: string }

// Acceso «admin» de DISENO §3: la sesión del dueño, o un token del dueño con displays:write
// (si está ligado, solo para su pantalla). El token del dispositivo (display:connect) nunca administra (CONTRATO §7).
export function canAdminDisplay(actor: Actor, d: Target) {
	if (actor.kind === 'anonymous' || actor.userId !== d.ownerId) return false
	if (actor.kind === 'user') return true
	if (actor.scopes.includes('display:connect') || !actor.scopes.includes('displays:write')) return false
	return !actor.displayId || actor.displayId === d.id
}
