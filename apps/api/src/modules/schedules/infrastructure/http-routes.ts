import { Router, type Request } from 'express'
import { CreateScheduleInput, DisplayHardwareId, PatchScheduleInput } from '@atekos/shared'
import type { Container } from '../../../container'
import { requireUser } from '../../../shared/auth'
import { NotFound } from '../../../shared/errors'
import { parseId } from '../../../shared/params'
import type { TargetRef } from '../application/schedules'

const device = (req: Request<{ id: string }>): TargetRef => ({
	kind: 'device',
	id: parseId(req.params.id, 'Dispositivo'),
})
const display = (req: Request<{ deviceId: string }>): TargetRef => {
	const r = DisplayHardwareId.safeParse(req.params.deviceId)
	if (!r.success) throw NotFound('Pantalla')
	return { kind: 'display', id: r.data }
}

// Programas: solo con sesión (la web); los tokens de los dispositivos no los gestionan.
export function scheduleRoutes(c: Container) {
	const r = Router()
	const s = c.schedules

	r.get('/schedules', async (req, res) => {
		res.json(await s.list.execute(requireUser(req.actor)))
	})
	r.patch('/schedules/:id', async (req, res) => {
		const actor = requireUser(req.actor)
		res.json(await s.patch.execute(actor, parseId(req.params.id, 'Programa'), PatchScheduleInput.parse(req.body)))
	})
	r.delete('/schedules/:id', async (req, res) => {
		await s.delete.execute(requireUser(req.actor), parseId(req.params.id, 'Programa'))
		res.status(204).end()
	})

	for (const [path, ref] of [
		['/devices/:id/schedules', device],
		['/displays/:deviceId/schedules', display],
	] as const) {
		r.get(path, async (req, res) => {
			res.json(await s.list.execute(requireUser(req.actor), ref(req as never)))
		})
		r.post(path, async (req, res) => {
			const actor = requireUser(req.actor)
			res.status(201).json(await s.create.execute(actor, ref(req as never), CreateScheduleInput.parse(req.body)))
		})
	}

	return r
}
