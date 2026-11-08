import type { DisplayTemplate } from '@atekos/shared'
import { Unprocessable } from '../../../shared/errors'
import type { Actor } from '../../devices/domain/policy'
import { findAdmin, toDetail, type DisplayDeps } from './access'
import { assertFits, publishAll, snapshotMessages } from './messages'

export class PutTemplateById {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo' | 'presence' | 'outbox'>) {}

	// Guarda sin activar: sirve para las pantallas destino de `screen.*`. Si es la activa, el dispositivo la recibe ya.
	async execute(actor: Actor, hardwareId: string, templateId: string, t: DisplayTemplate) {
		if (t.id !== templateId)
			throw Unprocessable('invalid_template', 'El id de la plantilla no coincide con el de la ruta')
		const d = await findAdmin(this.deps.repo, actor, hardwareId)
		const messages = snapshotMessages(d, t)
		assertFits(messages) // también si no es la activa: algún día lo será
		await this.deps.repo.upsertTemplate(d.id, t)
		if (d.activeTemplateId === t.id) await publishAll(this.deps.outbox, d.id, messages)
		return toDetail(this.deps, d) // guardar sin activar no cambia la fila de la pantalla
	}
}
