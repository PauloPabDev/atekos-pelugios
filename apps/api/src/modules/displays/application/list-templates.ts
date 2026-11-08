import type { Actor } from '../../devices/domain/policy'
import { findAdmin, type DisplayDeps } from './access'

export class ListTemplates {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo'>) {}

	async execute(actor: Actor, hardwareId: string) {
		const d = await findAdmin(this.deps.repo, actor, hardwareId)
		return this.deps.repo.listTemplates(d.id)
	}
}
