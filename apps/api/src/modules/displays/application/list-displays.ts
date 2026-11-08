import { Unauthorized } from '../../../shared/errors'
import type { Actor } from '../../devices/domain/policy'
import { canAdminDisplay } from '../domain/policy'
import { toDisplay, type DisplayDeps } from './access'

export class ListDisplays {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo' | 'presence'>) {}

	// Sesión o token con displays:write; un token ligado solo ve la suya. El del dispositivo no administra: 401.
	async execute(actor: Exclude<Actor, { kind: 'anonymous' }>) {
		if (actor.kind === 'token' && !actor.scopes.includes('displays:write'))
			throw Unauthorized('Requiere displays:write')
		const mine = (await this.deps.repo.listByOwner(actor.userId)).filter((d) => canAdminDisplay(actor, d))
		return Promise.all(mine.map(async (d) => toDisplay(d, await this.deps.presence.isOnline(d.id))))
	}
}
