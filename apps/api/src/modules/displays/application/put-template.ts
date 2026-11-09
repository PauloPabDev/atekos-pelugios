import type { DisplayTemplate } from '@atekos/shared'
import type { Actor } from '../../devices/domain/policy'
import { findAdmin, toDetail, type DisplayDeps } from './access'
import { assertFits, publishAll, snapshotMessages } from './messages'

export class PutTemplate {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo' | 'presence' | 'outbox' | 'maxMessageBytes'>) {}

	// PUT /template: guarda y activa (CONTRATO §7). Devuelve el DisplayDetail para que la web refresque de una vez.
	async execute(actor: Actor, hardwareId: string, t: DisplayTemplate) {
		const { repo, outbox } = this.deps
		const d = await findAdmin(repo, actor, hardwareId)
		assertFits(snapshotMessages(d, t), this.deps.maxMessageBytes)
		await repo.upsertTemplate(d.id, t)
		const { display, template } = await repo.setActive(d.id, t.id)
		await publishAll(outbox, d.id, snapshotMessages(display, template))
		return toDetail(this.deps, display)
	}
}
