import { Router } from 'express'
import { CreateTokenInput } from '@atekos/shared'
import type { Container } from '../../../container'
import { requireUser } from '../../../shared/auth'
import { parseId } from '../../../shared/params'

// Todas las rutas de tokens son solo de sesión (§6).
export function tokenRoutes(c: Container) {
	const r = Router()

	r.get('/', async (req, res) => {
		res.json(await c.tokens.list.execute(requireUser(req.actor).userId))
	})

	r.post('/', async (req, res) => {
		const { userId } = requireUser(req.actor)
		res.status(201).json(await c.tokens.create.execute(userId, CreateTokenInput.parse(req.body)))
	})

	r.delete('/:id', async (req, res) => {
		const { userId } = requireUser(req.actor)
		await c.tokens.revoke.execute(userId, parseId(req.params.id, 'Token'))
		res.status(204).end()
	})

	return r
}
