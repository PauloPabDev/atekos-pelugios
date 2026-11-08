import { Router } from 'express'
import { parseCookie } from 'cookie'
import { LoginInput, RegisterInput } from '@atekos/shared'
import type { Env } from '../../../config/env'
import type { Container } from '../../../container'
import { requireActor, requireUser } from '../../../shared/auth'
import { rateLimit } from '../../../shared/rate-limit'

const sessionCookie = (env: Env) => ({
	httpOnly: true,
	sameSite: 'lax' as const,
	path: '/',
	secure: env.NODE_ENV === 'production',
	maxAge: env.SESSION_TTL_SECONDS * 1000, // Express la convierte a segundos en Max-Age
})

export function authRoutes(c: Container) {
	const r = Router()

	r.post('/register', async (req, res) => {
		const { user, sid } = await c.auth.register.execute(RegisterInput.parse(req.body))
		res.status(201).cookie('sid', sid, sessionCookie(c.env)).json(user)
	})

	r.post(
		'/login',
		rateLimit(c.redis, {
			name: 'login',
			windowSec: 60,
			max: 5,
			key: (req) => `${req.ip}:${String(req.body?.email ?? '').toLowerCase()}`,
		}),
		async (req, res) => {
			const { user, sid } = await c.auth.login.execute(LoginInput.parse(req.body))
			res.cookie('sid', sid, sessionCookie(c.env)).json(user)
		},
	)

	r.post('/logout', async (req, res) => {
		requireUser(req.actor)
		// requireUser garantiza que el actor salió de esta cookie, así que el sid existe.
		await c.auth.logout.execute(parseCookie(req.headers.cookie ?? '').sid!)
		res.clearCookie('sid', sessionCookie(c.env)).status(204).end()
	})

	r.get('/me', async (req, res) => {
		res.json(await c.auth.me.execute(requireActor(req.actor).userId))
	})

	return r
}
