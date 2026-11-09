import type { PatchDisplayInput } from '@atekos/shared'
import { Unprocessable } from '../../../shared/errors'
import type { Actor } from '../../devices/domain/policy'
import { findAdmin, toDisplay, type DisplayDeps } from './access'
import { assertFits, publishAll, snapshotMessages } from './messages'

export class PatchDisplay {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo' | 'presence' | 'outbox' | 'maxMessageBytes'>) {}

	async execute(actor: Actor, hardwareId: string, patch: PatchDisplayInput) {
		const { repo, outbox } = this.deps
		let d = await findAdmin(repo, actor, hardwareId)
		if (patch.activeTemplateId !== undefined && patch.activeTemplateId !== d.activeTemplateId) {
			// Se lee antes para comprobar el tamaño sin haber guardado nada; setActive lo vuelve a exigir con la fila bloqueada.
			const t = await repo.findTemplate(d.id, patch.activeTemplateId)
			if (!t) throw Unprocessable('template_not_found', `No existe la plantilla ${patch.activeTemplateId}`)
			assertFits(snapshotMessages(d, t), this.deps.maxMessageBytes)
			const { display, template } = await repo.setActive(d.id, t.id)
			d = display
			await publishAll(outbox, d.id, snapshotMessages(display, template))
		}
		if (patch.name !== undefined) d = await repo.rename(d.id, patch.name)
		return toDisplay(d, await this.deps.presence.isOnline(d.id))
	}
}
