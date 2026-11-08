import type { Display, DisplayDetail } from '@atekos/shared'
import { NotFound } from '../../../shared/errors'
import type { Actor } from '../../devices/domain/policy'
import { canAdminDisplay } from '../domain/policy'
import type { DisplayEventLog, DisplayOutbox, DisplayPresence, DisplayRecord, DisplayRepository } from '../domain/ports'

export type DisplayDeps = {
	repo: DisplayRepository
	presence: DisplayPresence
	outbox: DisplayOutbox
	eventLog: DisplayEventLog
}

export const toDisplay = (d: DisplayRecord, online: boolean): Display => ({
	id: d.id,
	deviceId: d.hardwareId,
	name: d.name,
	activeTemplateId: d.activeTemplateId,
	online,
	createdAt: d.createdAt,
	updatedAt: d.updatedAt,
})

// Display + plantilla activa + lista de plantillas + valores: lo que devuelven GET /:deviceId y los PUT de plantillas.
export async function toDetail(deps: Pick<DisplayDeps, 'repo' | 'presence'>, d: DisplayRecord): Promise<DisplayDetail> {
	const [templates, online] = await Promise.all([deps.repo.listTemplates(d.id), deps.presence.isOnline(d.id)])
	return {
		...toDisplay(d, online),
		template: templates.find((t) => t.id === d.activeTemplateId)!,
		templates: templates.map(({ id, version }) => ({ id, version })),
		values: d.values,
	}
}

// Ajena, inexistente o sin permiso de administración → 404, para no revelar que existe (DISENO §3).
export async function findAdmin(repo: DisplayRepository, actor: Actor, hardwareId: string) {
	const d = await repo.findByHardwareId(hardwareId)
	if (!d || !canAdminDisplay(actor, d)) throw NotFound('Pantalla')
	return d
}

// La activa siempre existe: create la inserta, setActive exige que exista y deleteTemplate no la borra.
export const activeTemplate = async (repo: DisplayRepository, d: DisplayRecord) =>
	(await repo.findTemplate(d.id, d.activeTemplateId))!
