import { type DisplayServerMessage, type DisplayValues } from '@atekos/shared'
import type { Actor } from '../../devices/domain/policy'
import { activeTemplate, findAdmin, type DisplayDeps } from './access'
import { assertFits } from './messages'

export class PutData {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo' | 'outbox' | 'maxMessageBytes'>) {}

	// Reemplaza todos los valores y publica el snapshot.
	async execute(actor: Actor, hardwareId: string, values: DisplayValues) {
		const { repo, outbox } = this.deps
		const d = await findAdmin(repo, actor, hardwareId)
		const { version } = await activeTemplate(repo, d)
		const message: DisplayServerMessage = {
			type: 'data.update',
			templateVersion: version,
			strategy: 'snapshot',
			values,
		}
		assertFits([message], this.deps.maxMessageBytes)
		const after = await repo.replaceValues(d.id, values)
		await outbox.publish(d.id, message)
		return { values: after.values }
	}
}
