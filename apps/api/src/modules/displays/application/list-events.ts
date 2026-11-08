import type { Actor } from '../../devices/domain/policy'
import { findAdmin, type DisplayDeps } from './access'

export class ListEvents {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo' | 'eventLog'>) {}

	async execute(actor: Actor, hardwareId: string, limit: number) {
		const d = await findAdmin(this.deps.repo, actor, hardwareId)
		return this.deps.eventLog.listTouches(d.id, limit)
	}
}
