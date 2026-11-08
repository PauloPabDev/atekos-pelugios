import type { RequestHandler } from 'express'
import { parseCookie } from 'cookie'
import type { Container } from '../container'
import type { Actor } from '../modules/devices/domain/policy'
import { Unauthorized } from './errors'

export async function resolveActor(c: Container, authorization?: string, cookieHeader?: string): Promise<Actor> {
	if (authorization?.startsWith('Bearer ')) {
		const t = await c.tokens.verify.execute(authorization.slice(7))
		if (!t) throw Unauthorized('token inválido, vencido o revocado')
		return { kind: 'token', userId: t.userId, tokenId: t.id, scopes: t.scopes, deviceId: t.deviceId }
	}
	const sid = parseCookie(cookieHeader ?? '').sid
	const userId = sid ? await c.auth.sessions.get(sid) : null
	return userId ? { kind: 'user', userId } : { kind: 'anonymous' }
}

// Express 5 reenvía al middleware de error las promesas rechazadas
export const authenticate =
	(c: Container): RequestHandler =>
	async (req, _res, next) => {
		req.actor = await resolveActor(c, req.headers.authorization, req.headers.cookie)
		next()
	}

// Guardas: devuelven el actor ya acotado para que el handler lea `userId` sin casts.
export function requireUser(actor: Actor) {
	if (actor.kind !== 'user') throw Unauthorized('Requiere sesión')
	return actor
}

export function requireActor(actor: Actor) {
	if (actor.kind === 'anonymous') throw Unauthorized()
	return actor
}
