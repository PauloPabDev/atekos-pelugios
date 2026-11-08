import type { Actor } from '../../devices/domain/policy'
import { findAdmin, toDetail, type DisplayDeps } from './access'

export class GetDisplay {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo' | 'presence'>) {}

	async execute(actor: Actor, hardwareId: string) {
		return toDetail(this.deps, await findAdmin(this.deps.repo, actor, hardwareId))
	}
}
