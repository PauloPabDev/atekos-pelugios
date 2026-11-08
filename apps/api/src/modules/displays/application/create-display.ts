import type { DisplayTemplate } from '@atekos/shared'
import { Conflict, Forbidden } from '../../../shared/errors'
import { canCreate, type Actor } from '../../devices/domain/policy'
import { toDisplay, type DisplayDeps } from './access'

// Plantilla inicial (DISENO §2): el dispositivo dibuja algo desde el primer hello.
export const initialTemplate = (name: string): DisplayTemplate => ({
	id: 'inicio',
	version: 1,
	background: '#090D18',
	elements: [
		{ type: 'text', x: 10, y: 14, size: 2, color: '#FFFFFF', value: name },
		{ type: 'text', x: 10, y: 60, size: 1, color: '#B2B9D2', bind: 'mensaje' },
	],
	actions: [],
})

export class CreateDisplay {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo'>) {}

	// La REST solo llega con sesión; el MCP, con un token OAuth con displays:write (canCreate).
	// `deviceId` ya viene normalizado por DisplayHardwareId; el unique global da el 409.
	async execute(actor: Actor, input: { deviceId: string; name: string }) {
		if (actor.kind === 'anonymous' || !canCreate(actor, 'displays:write')) throw Forbidden()
		const d = await this.deps.repo.create(
			{ ownerId: actor.userId, hardwareId: input.deviceId, name: input.name },
			initialTemplate(input.name),
		)
		if (!d) throw Conflict('Ya existe una pantalla con ese id')
		return toDisplay(d, false) // sin token todavía, ningún dispositivo ha podido conectarse
	}
}
