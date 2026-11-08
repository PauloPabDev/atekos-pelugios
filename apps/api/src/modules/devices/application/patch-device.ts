import type { PatchDeviceInput } from '@atekos/shared'
import { NotFound, Forbidden } from '../../../shared/errors'
import { canRead, canWrite, type Actor } from '../domain/policy'
import type { DeviceRepository } from '../domain/ports'
import type { OnDeviceChanged } from './on-device-changed'

export class PatchDevice {
	constructor(private readonly deps: { repo: DeviceRepository; onChanged: OnDeviceChanged }) {}

	// Solo sesión: cambiar la visibilidad es administración (§7.3). Para un usuario, canWrite = ser el dueño.
	async execute(actor: Extract<Actor, { kind: 'user' }>, deviceId: string, patch: PatchDeviceInput) {
		const before = await this.deps.repo.findById(deviceId)
		if (!before || !canRead(actor, before)) throw NotFound('Dispositivo')
		if (!canWrite(actor, before, 'devices:write')) throw Forbidden()
		const after = await this.deps.repo.update(deviceId, patch)
		// También la visibilidad: el WS vuelve a comprobar canRead con el `after` publicado.
		await this.deps.onChanged({ type: 'device.updated', before, after, actor, source: 'http' })
		return after
	}
}
