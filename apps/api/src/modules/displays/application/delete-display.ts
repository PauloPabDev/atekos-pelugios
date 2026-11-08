import type { RedisClientType as Redis } from 'redis'
import type { Actor } from '../../devices/domain/policy'
import { findAdmin, type DisplayDeps } from './access'

export class DeleteDisplay {
	constructor(private readonly deps: Pick<DisplayDeps, 'repo' | 'outbox'> & { redis: Redis }) {}

	// Solo sesión (DISENO §3).
	async execute(actor: Extract<Actor, { kind: 'user' }>, hardwareId: string) {
		const d = await findAdmin(this.deps.repo, actor, hardwareId)
		const hashes = await this.deps.repo.delete(d.id)
		// Los tokens ligados cayeron en cascada, pero seguirían valiendo hasta 60 s desde `tok:{hash}`.
		if (hashes.length) await this.deps.redis.del(hashes.map((h) => `tok:${h}`))
		await this.deps.outbox.publish(d.id, { type: 'close' }) // cada instancia cierra sus sockets de esta pantalla
	}
}
