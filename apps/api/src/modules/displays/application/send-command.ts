import type { DisplayCommand } from '@atekos/shared'
import { Conflict } from '../../../shared/errors'
import type { Actor } from '../../devices/domain/policy'
import { findAdmin, type DisplayDeps } from './access'

export class SendCommand {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo' | 'presence' | 'outbox' | 'eventLog'>) {}

	// Solo display.* (la ruta ya rechazó el resto con 422).
	async execute(actor: Exclude<Actor, { kind: 'anonymous' }>, hardwareId: string, command: DisplayCommand) {
		const d = await findAdmin(this.deps.repo, actor, hardwareId)
		if (!(await this.deps.presence.isOnline(d.id))) throw Conflict('La pantalla no está conectada', 'device_offline')
		// Se audita antes de enviar: ningún comando llega al dispositivo sin quedar registrado.
		await this.deps.eventLog.appendCommand({
			displayId: d.id,
			ownerId: d.ownerId,
			command,
			actor: { kind: actor.kind, id: actor.kind === 'user' ? actor.userId : actor.tokenId },
		})
		await this.deps.outbox.publish(d.id, command)
	}
}
