import { Router, type Request } from 'express'
import { z } from 'zod'
import { CreateDeviceInput, PatchDataInput, PatchDeviceInput, SetStateInput } from '@atekos/shared'
import type { Container } from '../../../container'
import { requireActor, requireUser } from '../../../shared/auth'
import { parseId } from '../../../shared/params'

const PublicQuery = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
})
const EventsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })

const deviceId = (req: Request<{ id: string }>) => parseId(req.params.id, 'Dispositivo')

// Rutas de §6. Va montado en la raíz de /api/v1 porque /public/devices está fuera de /devices.
export function deviceRoutes(c: Container) {
	const r = Router()
	const d = c.devices

	r.get('/devices', async (req, res) => {
		res.json(await d.list.execute(requireActor(req.actor)))
	})

	r.post('/devices', async (req, res) => {
		const actor = requireUser(req.actor)
		res.status(201).json(await d.create.execute(actor, CreateDeviceInput.parse(req.body)))
	})

	r.get('/public/devices', async (req, res) => {
		const { page, limit } = PublicQuery.parse(req.query)
		res.json(await d.listPublic.execute(page, limit))
	})

	r.get('/devices/:id', async (req, res) => {
		res.json(await d.get.execute(req.actor, deviceId(req)))
	})

	r.patch('/devices/:id', async (req, res) => {
		const actor = requireUser(req.actor)
		res.json(await d.patch.execute(actor, deviceId(req), PatchDeviceInput.parse(req.body)))
	})

	r.delete('/devices/:id', async (req, res) => {
		const actor = requireUser(req.actor)
		await d.delete.execute(actor, deviceId(req))
		res.status(204).end()
	})

	// Lo que lee el ESP: `true` o `false` en JSON plano.
	r.get('/devices/:id/state', async (req, res) => {
		res.json(await d.getState.execute(req.actor, deviceId(req)))
	})

	r.put('/devices/:id/state', async (req, res) => {
		const { state } = SetStateInput.parse(req.body)
		res.json(await d.setState.execute(req.actor, deviceId(req), state, 'http'))
	})

	r.post('/devices/:id/toggle', async (req, res) => {
		res.json(await d.toggle.execute(req.actor, deviceId(req), 'http'))
	})

	r.get('/devices/:id/data/:key', async (req, res) => {
		res.json(await d.getDataKey.execute(req.actor, deviceId(req), req.params.key))
	})

	r.patch('/devices/:id/data', async (req, res) => {
		res.json(await d.patchData.execute(req.actor, deviceId(req), PatchDataInput.parse(req.body)))
	})

	r.delete('/devices/:id/data/:key', async (req, res) => {
		res.json(await d.deleteDataKey.execute(req.actor, deviceId(req), req.params.key))
	})

	r.get('/devices/:id/events', async (req, res) => {
		const { limit } = EventsQuery.parse(req.query)
		res.json(await d.listEvents.execute(req.actor, deviceId(req), limit))
	})

	return r
}
