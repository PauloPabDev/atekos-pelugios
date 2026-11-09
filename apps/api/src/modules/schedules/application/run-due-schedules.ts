import { nextRun, type ScheduleResult } from '@atekos/shared'
import type { Logger } from 'pino'
import { AppError } from '../../../shared/errors'
import type { SetState } from '../../devices/application/set-state'
import type { ToggleState } from '../../devices/application/toggle-state'
import type { SendCommand } from '../../displays/application/send-command'
import type { DueSchedule, ScheduleRepository } from '../domain/ports'

// Pasado este margen (API caída, despliegue largo) no se corre: encender la luz de las 19:00 a las 3:00 sorprende más
// que no hacerlo. Queda como «missed» y el programa sigue con su próxima.
export const MISSED_AFTER_MS = 10 * 60_000

type Deps = {
	repo: ScheduleRepository
	setState: Pick<SetState, 'execute'>
	toggle: Pick<ToggleState, 'execute'>
	sendCommand: Pick<SendCommand, 'execute'>
	logger: Pick<Logger, 'error'>
}

export class RunDueSchedules {
	constructor(private readonly deps: Deps) {}

	/** Corre los vencidos a `now`; devuelve cuántos reclamó. */
	async execute(now = new Date()) {
		const due = await this.deps.repo.claimDue(now, 50, (s) => nextRun(s.when, now))
		for (const s of due) await this.deps.repo.setResult(s.id, await this.run(s, now))
		return due.length
	}

	private async run(s: DueSchedule, now: Date): Promise<ScheduleResult> {
		if (now.getTime() - s.dueAt.getTime() > MISSED_AFTER_MS) return 'missed'
		// Actúa como su dueño: si perdió el dispositivo o el permiso, el caso de uso lo rechaza igual que por HTTP
		const actor = { kind: 'user', userId: s.ownerId } as const
		const a = s.action
		try {
			if (a.type === 'device.toggle') await this.deps.toggle.execute(actor, s.deviceId!, 'schedule')
			else if (a.type === 'device.on' || a.type === 'device.off')
				await this.deps.setState.execute(actor, s.deviceId!, a.type === 'device.on', 'schedule')
			else await this.deps.sendCommand.execute(actor, s.hardwareId!, a)
			return 'ok'
		} catch (err) {
			if (err instanceof AppError && err.code === 'device_offline') return 'offline'
			this.deps.logger.error({ err, scheduleId: s.id }, 'programa fallido')
			return 'error'
		}
	}
}
