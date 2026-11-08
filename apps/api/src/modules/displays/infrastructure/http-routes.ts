import { Router, type Request } from 'express'
import { z } from 'zod'
import {
	CreateDisplayInput,
	DISPLAY_COMMANDS,
	DisplayCommand,
	DisplayHardwareId,
	DisplayTemplate,
	DisplayValues,
	PatchDisplayInput,
} from '@atekos/shared'
import type { Container } from '../../../container'
import { requireActor, requireUser } from '../../../shared/auth'
import { NotFound, Unprocessable } from '../../../shared/errors'

const EventsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) })

// `version` es integer en PG: más allá de 2^31-1 el INSERT fallaría con un 500.
const Template = DisplayTemplate.refine((t) => t.version <= 2_147_483_647, {
	message: 'version fuera de rango',
	path: ['version'],
})

// Una plantilla o unos valores inválidos → 422 con `issues` (DISENO §3), no el 400 genérico de zod.
const valid =
	<T extends z.ZodType>(schema: T, code: string, message: string) =>
	(body: unknown): z.output<T> => {
		const r = schema.safeParse(body)
		if (!r.success) throw Unprocessable(code, message, r.error.issues)
		return r.data
	}
const template = valid(Template, 'invalid_template', 'Plantilla inválida')
const values = valid(DisplayValues, 'invalid_data', 'Datos inválidos')

// `md-` + 12 hex, normalizado; cualquier otra cosa es una pantalla que no existe.
const hardwareId = (req: Request<{ deviceId: string }>) => {
	const r = DisplayHardwareId.safeParse(req.params.deviceId)
	if (!r.success) throw NotFound('Pantalla')
	return r.data
}

// Tabla de DISENO §3. «admin» = requireActor + canAdminDisplay en el caso de uso; «sesión» = requireUser.
export function displayRoutes(c: Container) {
	const r = Router()
	const d = c.displays

	r.get('/', async (req, res) => {
		res.json(await d.list.execute(requireActor(req.actor)))
	})

	r.post('/', async (req, res) => {
		const actor = requireUser(req.actor)
		res.status(201).json(await d.create.execute(actor, CreateDisplayInput.parse(req.body)))
	})

	r.get('/:deviceId', async (req, res) => {
		res.json(await d.get.execute(requireActor(req.actor), hardwareId(req)))
	})

	r.patch('/:deviceId', async (req, res) => {
		const actor = requireActor(req.actor)
		res.json(await d.patch.execute(actor, hardwareId(req), PatchDisplayInput.parse(req.body)))
	})

	r.delete('/:deviceId', async (req, res) => {
		const actor = requireUser(req.actor)
		await d.delete.execute(actor, hardwareId(req))
		res.status(204).end()
	})

	r.put('/:deviceId/template', async (req, res) => {
		const actor = requireActor(req.actor)
		res.json(await d.putTemplate.execute(actor, hardwareId(req), template(req.body)))
	})

	r.get('/:deviceId/templates', async (req, res) => {
		res.json(await d.listTemplates.execute(requireActor(req.actor), hardwareId(req)))
	})

	r.put('/:deviceId/templates/:templateId', async (req, res) => {
		const actor = requireActor(req.actor)
		res.json(await d.putTemplateById.execute(actor, hardwareId(req), req.params.templateId, template(req.body)))
	})

	r.delete('/:deviceId/templates/:templateId', async (req, res) => {
		await d.deleteTemplate.execute(requireActor(req.actor), hardwareId(req), req.params.templateId)
		res.status(204).end()
	})

	r.put('/:deviceId/data', async (req, res) => {
		res.json(await d.putData.execute(requireActor(req.actor), hardwareId(req), values(req.body)))
	})

	r.patch('/:deviceId/data', async (req, res) => {
		res.json(await d.patchData.execute(requireActor(req.actor), hardwareId(req), values(req.body)))
	})

	r.get('/:deviceId/events', async (req, res) => {
		const { limit } = EventsQuery.parse(req.query)
		res.json(await d.listEvents.execute(requireActor(req.actor), hardwareId(req), limit))
	})

	r.post('/:deviceId/commands', async (req, res) => {
		const actor = requireActor(req.actor)
		const id = hardwareId(req)
		// trust.* y ota.install quedan fuera hasta homologar el hardware (DISENO §1).
		if (!DISPLAY_COMMANDS.includes(req.body?.type)) throw Unprocessable('command_not_allowed', 'Comando no permitido')
		await d.sendCommand.execute(actor, id, DisplayCommand.parse(req.body))
		res.status(202).json({ ok: true })
	})

	return r
}
