import { NotFound } from '../../../shared/errors'
import type { Actor } from '../domain/policy'
import type { GetDevice } from './get-device'

export class GetDataKey {
	constructor(private readonly deps: { get: GetDevice }) {}

	async execute(actor: Actor, id: string, key: string) {
		const { data } = await this.deps.get.execute(actor, id)
		// hasOwn: `constructor` o `__proto__` no son claves del dispositivo.
		if (!Object.hasOwn(data, key)) throw NotFound('Clave')
		return data[key]
	}
}
