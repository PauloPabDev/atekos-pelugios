import type { ScheduleAction, ScheduleResult, ScheduleWhen } from '@atekos/shared'

export type ScheduleRecord = {
	id: string
	ownerId: string
	deviceId: string | null
	displayId: string | null
	hardwareId: string | null // de la pantalla, para la API y para mandarle el comando
	name: string
	when: ScheduleWhen
	action: ScheduleAction
	enabled: boolean
	nextRunAt: Date | null
	lastRunAt: Date | null
	lastResult: ScheduleResult | null
	createdAt: Date
}

export type Target = { deviceId: string } | { displayId: string }
export type NewSchedule = Pick<ScheduleRecord, 'ownerId' | 'name' | 'when' | 'action' | 'enabled' | 'nextRunAt'> &
	Target
export type ScheduleChanges = Partial<Pick<ScheduleRecord, 'name' | 'when' | 'action' | 'enabled' | 'nextRunAt'>>

/** Un programa reclamado para ejecutarse: `dueAt` es la hora a la que tocaba. */
export type DueSchedule = ScheduleRecord & { dueAt: Date }

export interface ScheduleRepository {
	/** Por próxima ejecución (los pausados al final). */
	listByTarget(t: Target): Promise<ScheduleRecord[]>
	listByOwner(ownerId: string): Promise<ScheduleRecord[]>
	countByTarget(t: Target): Promise<number>
	findById(id: string): Promise<ScheduleRecord | null>
	create(s: NewSchedule): Promise<ScheduleRecord>
	update(id: string, changes: ScheduleChanges): Promise<ScheduleRecord>
	delete(id: string): Promise<void>
	/**
	 * Reclama los vencidos y los deja ya apuntando a su siguiente ejecución, en una transacción con SKIP LOCKED:
	 * con varias instancias cada programa lo corre una sola (como mucho una vez si el proceso cae a mitad).
	 */
	claimDue(now: Date, limit: number, next: (s: ScheduleRecord) => Date | null): Promise<DueSchedule[]>
	setResult(id: string, result: ScheduleResult): Promise<void>
}
