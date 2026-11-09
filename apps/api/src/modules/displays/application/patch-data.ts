import { checkParams, type DisplayServerMessage, type DisplayValues } from '@atekos/shared'
import { Unprocessable } from '../../../shared/errors'
import type { Actor } from '../../devices/domain/policy'
import { activeTemplate, findAdmin, type DisplayDeps } from './access'
import { assertFits, snapshotMessages } from './messages'

export class PatchData {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo' | 'outbox' | 'maxMessageBytes'>) {}

	// Merge (un null guarda null) y publica un patch solo con las claves recibidas.
	async execute(actor: Actor, hardwareId: string, patch: DisplayValues) {
		const { repo, outbox } = this.deps
		const d = await findAdmin(repo, actor, hardwareId)
		const t = await activeTemplate(repo, d)
		// Solo las claves que declara la plantilla activa: los valores se comparten entre plantillas.
		const issues = checkParams(t.params, patch)
		if (issues.length) throw Unprocessable('invalid_data', 'Datos inválidos', issues)
		const message: DisplayServerMessage = {
			type: 'data.update',
			templateVersion: t.version,
			strategy: 'patch',
			values: patch,
		}
		// También el snapshot resultante: es lo que el dispositivo recibirá en el próximo hello.
		// shortcut: se mide con los valores leídos antes del merge; dos PATCH concurrentes podrían pasarse por poco.
		// Si llega a importar, hacer el merge en una transacción con SELECT … FOR UPDATE.
		assertFits([message, ...snapshotMessages({ values: { ...d.values, ...patch } }, t)], this.deps.maxMessageBytes)
		const after = await repo.mergeValues(d.id, patch) // 422 si el resultado pasa de 64 claves
		await outbox.publish(d.id, message)
		return { values: after.values }
	}
}
