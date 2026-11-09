import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { Schedule } from '@atekos/shared'
import * as api from '../../api'
import { Icon } from '../../components/Icon'
import { Switch } from '../../components/ui'
import { useNow } from '../../hooks/useNow'
import { ago, fullDate } from '../../labels'
import {
	actionLabel,
	clashes,
	DAY_LETTERS,
	describeSchedule,
	nextRunLabel,
	onceDay,
	RESULT,
	daysPhrase,
	atTime,
} from '../../schedules'

export const EXPLAIN: Record<string, string> = {
	schedule_in_past: 'Esa fecha ya pasó: cámbiala para volver a activarlo.',
}

// Los próximos primero; los pausados (sin próxima) al final, por hora
const order = (s: Schedule) => (s.enabled && s.nextRunAt ? Date.parse(s.nextRunAt) : Infinity)
export const byNext = (a: Schedule, b: Schedule) => order(a) - order(b) || a.when.time.localeCompare(b.when.time)

// Pausar o reanudar al momento en todas las listas cacheadas (la del destino y la global); si falla, se deshace
export function useToggleSchedule() {
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (s: Schedule) => api.patchSchedule(s.id, { enabled: !s.enabled }),
		onMutate: async (s) => {
			await qc.cancelQueries({ queryKey: ['schedules'] })
			const prev = qc.getQueriesData<Schedule[]>({ queryKey: ['schedules'] })
			qc.setQueriesData<Schedule[]>({ queryKey: ['schedules'] }, (list) =>
				list?.map((x) => (x.id === s.id ? { ...x, enabled: !s.enabled } : x)),
			)
			return prev
		},
		onError: (_e, _s, prev) => prev?.forEach(([key, data]) => qc.setQueryData(key, data)),
		onSettled: () => qc.invalidateQueries({ queryKey: ['schedules'] }),
	})
}

// Lista tipo alarmas: hora grande, días, acción, próxima y última ejecución; la fila abre la edición
export function ScheduleList({
	schedules,
	base,
	deviceType,
}: {
	schedules: readonly Schedule[]
	base: string
	deviceType?: string
}) {
	const now = useNow()
	const toggle = useToggleSchedule()

	return (
		<ul className="card divide-y divide-line overflow-hidden">
			{[...schedules].sort(byNext).map((s) => {
				const phrase = describeSchedule(s, deviceType, new Date(now))
				const clash = clashes(s, schedules)[0]
				const failed = s.lastResult && s.lastResult !== 'ok'
				const doneOnce = s.when.repeat === 'once' && !s.enabled && s.lastRunAt
				return (
					<li key={s.id} className="relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-canvas">
						<div className="min-w-0 flex-1">
							<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
								{/* El after cubre la fila: toda ella abre la edición; el switch queda por encima */}
								<Link
									to={`${base}/${s.id}`}
									aria-label={s.name ? `${s.name}: ${phrase}` : phrase}
									className={`text-xl font-semibold tabular-nums after:absolute after:inset-0 ${s.enabled ? 'text-fg' : 'text-fg-subtle'}`}
								>
									{s.when.time}
								</Link>
								<span className={`badge ${s.enabled ? '' : 'text-fg-subtle'}`}>
									{actionLabel(s.action, deviceType)}
								</span>
								{s.name && <span className="min-w-0 truncate text-sm font-medium text-fg-muted">{s.name}</span>}
							</div>
							<p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
								{s.when.repeat === 'weekly' ? (
									<DayLetters days={s.when.days} muted={!s.enabled} />
								) : (
									<span aria-hidden="true" className="text-fg-subtle">
										<Icon name="calendar" size={16} />
									</span>
								)}
								<span>
									{s.when.repeat === 'weekly'
										? daysPhrase(s.when.days)
										: `${onceDay(s.when.date, s.when.timezone, new Date(now))}, una vez`}
								</span>
							</p>
							<p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-fg-muted">
								<span>
									{s.enabled && s.nextRunAt
										? `Próxima: ${nextRunLabel(s.nextRunAt, s.when.timezone, new Date(now))}`
										: doneOnce
											? 'Ya se ejecutó'
											: 'Pausado'}
								</span>
								{s.lastRunAt && s.lastResult && (
									<>
										<span aria-hidden="true">·</span>
										<time dateTime={s.lastRunAt} title={fullDate(s.lastRunAt)}>
											Última: {ago(s.lastRunAt, now)}
										</time>
										<span aria-hidden="true">·</span>
										<span className={`inline-flex items-center gap-1 ${failed ? 'text-danger-fg' : 'text-success-fg'}`}>
											<Icon name={failed ? 'x' : 'check'} size={14} />
											{RESULT[s.lastResult]}
										</span>
									</>
								)}
							</p>
							{clash && (
								<span className="badge badge-warning mt-1.5">
									Choca con «{actionLabel(clash.action, deviceType)} {atTime(clash.when.time)}»
								</span>
							)}
							{toggle.error && toggle.variables?.id === s.id && (
								<p role="alert" className="alert alert-error relative z-10 mt-2">
									{api.errorLines(toggle.error, EXPLAIN)[0]}
								</p>
							)}
						</div>
						<div className="relative z-10 flex">
							<Switch
								checked={s.enabled}
								label={`Activo: ${phrase}`}
								busy={toggle.isPending && toggle.variables?.id === s.id}
								onChange={() => toggle.mutate(s)}
							/>
						</div>
					</li>
				)
			})}
		</ul>
	)
}

// Junto al bloque que falló, nunca a página completa
export function LoadError({ retry, busy }: { retry: () => void; busy: boolean }) {
	return (
		<div role="alert" className="alert alert-error flex flex-wrap items-center justify-between gap-2">
			No se pudieron cargar los programas.
			<button type="button" className="btn btn-secondary" onClick={retry} disabled={busy}>
				Reintentar
			</button>
		</div>
	)
}

// L M X J V S D con los activos marcados; decorativo: la frase de al lado es el texto accesible
function DayLetters({ days, muted }: { days: readonly number[]; muted: boolean }) {
	return (
		<span aria-hidden="true" className="flex gap-0.5">
			{DAY_LETTERS.map((l, i) => (
				<span
					key={l + i}
					className={`grid size-5 place-items-center rounded text-[11px] ${
						days.includes(i + 1)
							? `bg-subtle font-semibold ${muted ? 'text-fg-subtle' : 'text-fg'}`
							: 'text-fg-subtle/50'
					}`}
				>
					{l}
				</span>
			))}
		</span>
	)
}
