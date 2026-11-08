import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { TelemetryInput } from '@atekos/shared'
import type { Container } from '../../../container'
import { parseId } from '../../../shared/params'
import { rateLimit } from '../../../shared/rate-limit'

const TelemetryQuery = z.object({
	from: z.iso.datetime().optional(),
	to: z.iso.datetime().optional(),
	limit: z.coerce.number().int().min(1).max(1000).default(100),
})

const deviceId = (req: Request<{ id: string }>) => parseId(req.params.id, 'Dispositivo')

// Telemetría de §6. Va montado en la raíz de /api/v1, como deviceRoutes.
export function telemetryRoutes(c: Container) {
	const r = Router()
	const t = c.telemetry

	r.post(
		'/devices/:id/telemetry',
		// §9: 60 por minuto por token (o por sesión), además del general de 300. El anónimo cuenta por IP aunque no pueda escribir.
		rateLimit(c.redis, {
			name: 'telemetry',
			windowSec: 60,
			max: 60,
			key: ({ actor, ip }) => (actor.kind === 'user' ? actor.userId : actor.kind === 'token' ? actor.tokenId : `${ip}`),
		}),
		// Tipos explícitos: con un middleware delante, Express no infiere los params de la ruta.
		async (req: Request<{ id: string }>, res: Response) => {
			res.status(201).json(await t.ingest.execute(req.actor, deviceId(req), TelemetryInput.parse(req.body)))
		},
	)

	r.get('/devices/:id/telemetry', async (req, res) => {
		res.json(await t.query.execute(req.actor, deviceId(req), TelemetryQuery.parse(req.query)))
	})

	return r
}
