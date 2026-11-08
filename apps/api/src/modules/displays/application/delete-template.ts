import type { Actor } from '../../devices/domain/policy'
import { findAdmin, type DisplayDeps } from './access'

export class DeleteTemplate {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo'>) {}

	// La activa no se borra (409): el dispositivo se quedaría sin nada que dibujar.
	async execute(actor: Actor, hardwareId: string, templateId: string) {
		const d = await findAdmin(this.deps.repo, actor, hardwareId)
		await this.deps.repo.deleteTemplate(d.id, templateId)
	}
}
