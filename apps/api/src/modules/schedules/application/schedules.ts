import {
	nextRun,
	type CreateScheduleInput,
	type PatchScheduleInput,
	type Schedule,
	type ScheduleAction,
} from '@atekos/shared'
import { NotFound, Unprocessable } from '../../../shared/errors'
import type { DeviceRepository } from '../../devices/domain/ports'
import { findAdmin } from '../../displays/application/access'
import type { DisplayRepository } from '../../displays/domain/ports'
import type { ScheduleRecord, ScheduleRepository, Target } from '../domain/ports'

export const MAX_SCHEDULES_PER_TARGET = 20

type UserActor = { kind: 'user'; userId: string }
// Pantalla por hardwareId (md-…), como en sus rutas
export type TargetRef = { kind: 'device'; id: string } | { kind: 'display'; id: string }
type Deps = { repo: ScheduleRepository; devices: DeviceRepository; displays: DisplayRepository; now?: () => Date }

export const toSchedule = (r: ScheduleRecord): Schedule => ({
	id: r.id,
	target: r.deviceId ? { kind: 'device', id: r.deviceId } : { kind: 'display', id: r.hardwareId! },
	name: r.name,
	when: r.when,
	action: r.action,
	enabled: r.enabled,
	nextRunAt: r.nextRunAt?.toISOString() ?? null,
	lastRunAt: r.lastRunAt?.toISOString() ?? null,
	lastResult: r.lastResult,
	createdAt: r.createdAt.toISOString(),
})

// Los programas son del dueño: de un dispositivo público ajeno tampoco se ven (404, no 403)
async function resolve(deps: Deps, actor: UserActor, ref: TargetRef): Promise<Target> {
	if (ref.kind === 'display') return { displayId: (await findAdmin(deps.displays, actor, ref.id)).id }
	const d = await deps.devices.findById(ref.id)
	if (!d || d.ownerId !== actor.userId) throw NotFound('Dispositivo')
	return { deviceId: d.id }
}

function checkAction(target: Target, action: ScheduleAction) {
	const kind = 'deviceId' in target ? 'device.' : 'display.'
	if (!action.type.startsWith(kind)) throw Unprocessable('invalid_action', 'Esa acción no vale para este destino')
}

// Próxima ejecución desde ahora; activo y sin próxima = una vez con la fecha ya pasada
function computeNext(deps: Deps, s: Pick<ScheduleRecord, 'when' | 'enabled'>) {
	if (!s.enabled) return null
	const next = nextRun(s.when, deps.now?.() ?? new Date())
	if (!next) throw Unprocessable('schedule_in_past', 'Esa fecha y hora ya pasaron')
	return next
}

async function owned(repo: ScheduleRepository, actor: UserActor, id: string) {
	const s = await repo.findById(id)
	if (!s || s.ownerId !== actor.userId) throw NotFound('Programa')
	return s
}

export class ListSchedules {
	constructor(private readonly deps: Deps) {}
	async execute(actor: UserActor, ref?: TargetRef) {
		const rows = ref
			? await this.deps.repo.listByTarget(await resolve(this.deps, actor, ref))
			: await this.deps.repo.listByOwner(actor.userId)
		return rows.map(toSchedule)
	}
}

export class CreateSchedule {
	constructor(private readonly deps: Deps) {}
	async execute(actor: UserActor, ref: TargetRef, input: CreateScheduleInput) {
		const target = await resolve(this.deps, actor, ref)
		checkAction(target, input.action)
		if ((await this.deps.repo.countByTarget(target)) >= MAX_SCHEDULES_PER_TARGET)
			throw Unprocessable('too_many_schedules', `Máximo ${MAX_SCHEDULES_PER_TARGET} programas por dispositivo`)
		const nextRunAt = computeNext(this.deps, input)
		return toSchedule(await this.deps.repo.create({ ...target, ...input, ownerId: actor.userId, nextRunAt }))
	}
}

export class PatchSchedule {
	constructor(private readonly deps: Deps) {}
	async execute(actor: UserActor, id: string, patch: PatchScheduleInput) {
		const s = await owned(this.deps.repo, actor, id)
		const merged = { ...s, ...patch }
		checkAction(s.deviceId ? { deviceId: s.deviceId } : { displayId: s.displayId! }, merged.action)
		const changes = { ...patch, nextRunAt: computeNext(this.deps, merged) }
		return toSchedule(await this.deps.repo.update(id, changes))
	}
}

export class DeleteSchedule {
	constructor(private readonly deps: Pick<Deps, 'repo'>) {}
	async execute(actor: UserActor, id: string) {
		await owned(this.deps.repo, actor, id)
		await this.deps.repo.delete(id)
	}
}
