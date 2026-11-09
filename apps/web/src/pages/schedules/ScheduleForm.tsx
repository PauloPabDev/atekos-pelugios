import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from 'react-router'
import {
	nextRun,
	type CreateScheduleInput,
	type Schedule,
	type ScheduleAction,
	type ScheduleWhen,
} from '@atekos/shared'
import * as api from '../../api'
import { Icon } from '../../components/Icon'
import { Problems } from '../../components/Problems'
import { Switch } from '../../components/ui'
import { useDraft } from '../../hooks/useDraft'
import { useNow } from '../../hooks/useNow'
import { ago } from '../../labels'
import {
	actionLabel,
	atTime,
	browserZone,
	clashes,
	defaultDate,
	describeSchedule,
	EVERY_DAY,
	nextRunLabel,
	RESULT,
	targetBase,
	wall,
	zoneCity,
	type ScheduleTarget,
} from '../../schedules'
import { DayPicker } from './DayPicker'
import { Segmented } from './Segmented'

// Lo que se edita: días y fecha conviven para no perder uno al cambiar «Se repite | Una vez»; el brillo, igual
export type Draft = {
	repeat: 'weekly' | 'once'
	days: number[]
	date: string
	time: string
	timezone: string
	action: ScheduleAction['type']
	percent: number
	name: string
	enabled: boolean
}
// Estado de navegación hacia el formulario: un preset (sugerencia, duplicar, «crear también el apagado») y el foco
export type FormNav = { preset?: Partial<Draft>; focus?: 'time' }
// Y de vuelta a la lista: qué se acaba de guardar o borrar
export type ListNav = { saved?: Schedule; deleted?: boolean }

export const fromSchedule = (s: {
	when: ScheduleWhen
	action: ScheduleAction
	name?: string
	enabled?: boolean
}): Partial<Draft> => ({
	repeat: s.when.repeat,
	...(s.when.repeat === 'weekly' ? { days: s.when.days } : { date: s.when.date }),
	time: s.when.time,
	timezone: s.when.timezone,
	action: s.action.type,
	...(s.action.type === 'display.brightness' && { percent: s.action.percent }),
	name: s.name ?? '',
	enabled: s.enabled ?? true,
})

const ACTIONS = {
	device: [
		['device.on', 'Encender'],
		['device.off', 'Apagar'],
		['device.toggle', 'Alternar'],
	],
	display: [
		['display.brightness', 'Brillo'],
		['display.refresh', 'Refrescar'],
	],
} as const

const REPEAT = [
	['weekly', 'Se repite'],
	['once', 'Una vez'],
] as const

function defaults(kind: ScheduleTarget['kind'], now: Date): Draft {
	const timezone = browserZone()
	return {
		repeat: 'weekly',
		days: EVERY_DAY,
		date: defaultDate('19:00', timezone, now),
		time: '19:00',
		timezone,
		action: kind === 'device' ? 'device.on' : 'display.brightness',
		percent: 10,
		name: '',
		enabled: true,
	}
}

// Una sola pantalla para crear y editar: frase viva arriba, después qué, cuándo y a qué hora
export function ScheduleForm({
	target,
	deviceType,
	siblings,
	editing,
}: {
	target: ScheduleTarget
	deviceType?: string
	siblings: readonly Schedule[]
	editing?: Schedule
}) {
	const base = targetBase(target)
	const navigate = useNavigate()
	const location = useLocation()
	const qc = useQueryClient()
	const now = new Date(useNow())
	const initial: Draft = { ...defaults(target.kind, now), ...(editing && fromSchedule(editing)) }
	// Bajo la URL de la pestaña Programas: así la pestaña lleva el punto «sin guardar»
	const [form, setForm, draft] = useDraft(`${base}/${editing?.id ?? 'nuevo'}`, initial)
	const heading = useRef<HTMLHeadingElement>(null)
	const timeRef = useRef<HTMLInputElement>(null)
	const [confirming, setConfirming] = useState(false)
	const [zones, setZones] = useState(false)
	const [after, setAfter] = useState<ListNav | null>(null)
	const ids = useId()

	useLayoutEffect(() => {
		const nav = location.state as FormNav | null
		// El preset gana a un borrador viejo de «nuevo» y se guarda como borrador; se quita del historial para que
		// al recargar no pise lo que ya hayas cambiado
		if (nav?.preset) {
			setForm({ ...initial, ...nav.preset })
			navigate(location.pathname, { replace: true, state: null })
		}
		if (nav?.focus === 'time') timeRef.current?.focus()
		else if (location.key !== 'default') heading.current?.focus({ preventScroll: true })
	}, [])

	// Se navega en un efecto, después del render del reset: si no, el formulario se desmonta antes de que useDraft
	// borre el borrador de sessionStorage
	useEffect(() => {
		if (!after) return
		navigate(base, { state: after })
		// Después de navegar: quitarlo antes dejaría esta ruta sin su programa (y sin este efecto) por un momento
		if (after.deleted)
			qc.setQueriesData<Schedule[]>({ queryKey: ['schedules'] }, (l) => l?.filter((x) => x.id !== editing?.id))
	}, [after])

	const when: ScheduleWhen =
		form.repeat === 'weekly'
			? { repeat: 'weekly', days: form.days, time: form.time, timezone: form.timezone }
			: { repeat: 'once', date: form.date, time: form.time, timezone: form.timezone }
	const action: ScheduleAction =
		form.action === 'display.brightness' ? { type: form.action, percent: form.percent } : { type: form.action }
	const complete = !!form.time && (form.repeat === 'weekly' ? form.days.length > 0 : !!form.date)
	const next = complete ? nextRun(when, now) : null
	const phrase = describeSchedule({ when, action }, deviceType, now)
	const clash = clashes({ id: editing?.id, enabled: form.enabled, when, action }, siblings)[0]

	// La frase se anuncia sola, pero sin hablar a cada tecla
	const [spoken, setSpoken] = useState(phrase)
	useEffect(() => {
		const t = setTimeout(() => setSpoken(phrase), 600)
		return () => clearTimeout(t)
	}, [phrase])

	const save = useMutation({
		mutationFn: (body: CreateScheduleInput) =>
			editing ? api.patchSchedule(editing.id, body) : api.createSchedule(target, body),
		// Se refresca aquí, antes de volver: la lista llega ya con el programa nuevo
		onSuccess: async (saved) => {
			await qc.invalidateQueries({ queryKey: ['schedules'] })
			draft.reset()
			setAfter({ saved })
		},
	})
	const remove = useMutation({
		mutationFn: () => api.deleteSchedule(editing!.id),
		onSuccess: () => {
			draft.reset()
			setAfter({ deleted: true })
		},
	})

	const code = save.error instanceof api.HttpError ? save.error.body.error : undefined
	const errors = {
		action: code === 'invalid_action' ? 'Esa acción no vale para este destino.' : undefined,
		days: form.repeat === 'weekly' && form.days.length === 0 ? 'Elige al menos un día.' : undefined,
		date: form.repeat === 'once' && !form.date ? 'Pon una fecha.' : undefined,
		time: !form.time ? 'Pon una hora.' : undefined,
		when:
			(complete && form.enabled && !next) || code === 'schedule_in_past' ? 'Esa fecha y hora ya pasaron.' : undefined,
	}
	const others =
		code === 'invalid_action' || code === 'schedule_in_past'
			? []
			: api.errorLines(save.error, {
					too_many_schedules: `Has llegado al máximo de programas para ${target.kind === 'device' ? 'este dispositivo' : 'esta pantalla'}: borra alguno para crear otro.`,
				})

	const update = (patch: Partial<Draft>) => {
		setForm({ ...form, ...patch })
		if (save.error) save.reset()
	}
	const setRepeat = (repeat: Draft['repeat']) => {
		// Al pasar a «Una vez», una fecha ya pasada se cambia por hoy o mañana
		const keep =
			form.date &&
			form.time &&
			nextRun({ repeat: 'once', date: form.date, time: form.time, timezone: form.timezone }, now)
		update(repeat === 'once' && !keep ? { repeat, date: defaultDate(form.time, form.timezone, now) } : { repeat })
	}
	const submit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		if (errors.days || errors.date || errors.time || errors.when) {
			e.currentTarget.querySelector<HTMLElement>('[aria-invalid="true"], fieldset[aria-describedby] input')?.focus()
			return
		}
		save.mutate({ name: form.name.trim(), when, action, enabled: form.enabled })
	}
	const duplicate = () =>
		navigate(`${base}/nuevo`, {
			state: { preset: { ...form, name: form.name ? `${form.name} (copia)` : '' } } satisfies FormNav,
		})

	const err = (key: keyof typeof errors) => `${ids}-${key}`
	const invalid = (key: keyof typeof errors) =>
		errors[key] ? { 'aria-invalid': true, 'aria-describedby': err(key) } : {}
	const message = (k: keyof typeof errors) =>
		errors[k] && (
			<p id={err(k)} className="mt-1 text-sm text-danger-fg">
				{errors[k]}
			</p>
		)
	const timeInvalid = errors.time ? invalid('time') : invalid('when')

	return (
		<form noValidate onSubmit={submit} className="space-y-4">
			<div className="flex items-center gap-2">
				<Link to={base} aria-label="Volver a los programas" className="btn btn-icon btn-ghost -ml-3 sm:-ml-2">
					<Icon name="back" size={20} />
				</Link>
				<h2 ref={heading} tabIndex={-1} className="outline-none">
					{editing ? 'Editar programa' : 'Nuevo programa'}
				</h2>
			</div>

			<div className="card">
				<div className="border-b border-line p-4">
					<p className="text-lg font-semibold text-balance">{phrase}</p>
					<p className="mt-0.5 text-sm text-fg-muted">
						{next
							? `Próxima vez: ${nextRunLabel(next, form.timezone, now)}`
							: form.enabled
								? 'Sin próxima vez.'
								: 'Pausado: no se ejecutará hasta que lo actives.'}
					</p>
					{editing?.lastRunAt && editing.lastResult && (
						<p className="text-sm text-fg-muted">
							Última ejecución: {ago(editing.lastRunAt, now.getTime())} · {RESULT[editing.lastResult]}
						</p>
					)}
					<p className="sr-only" aria-live="polite">
						{spoken}
					</p>
				</div>

				<div className="space-y-5 p-4">
					<div>
						<Segmented
							legend="Qué hacer"
							value={form.action}
							options={ACTIONS[target.kind]}
							onChange={(a) => update({ action: a })}
						>
							{message('action')}
						</Segmented>
						{form.action === 'device.toggle' && <small>Si ya está encendido a esa hora, lo apaga.</small>}
						{form.action === 'display.brightness' && (
							<div className="mt-2">
								<div className="flex items-center gap-3">
									<label htmlFor={`${ids}-pct`} className="text-sm font-medium">
										Brillo
									</label>
									<input
										id={`${ids}-pct`}
										type="range"
										min={0}
										max={50}
										step={1}
										value={form.percent}
										aria-describedby={`${ids}-pct-hint`}
										className="max-w-xs flex-1"
										onChange={(e) => update({ percent: Number(e.target.value) })}
									/>
									<output htmlFor={`${ids}-pct`} className="w-12 text-right text-sm tabular-nums">
										{form.percent} %
									</output>
								</div>
								<small id={`${ids}-pct-hint`}>La pantalla admite como máximo 50 %.</small>
							</div>
						)}
					</div>

					<Segmented legend="Cuándo" value={form.repeat} options={REPEAT} onChange={setRepeat} />
					{form.repeat === 'weekly' ? (
						<DayPicker days={form.days} onChange={(days) => update({ days })} error={errors.days} />
					) : (
						<div>
							<label className="field max-w-48">
								Fecha
								<input
									type="date"
									min={wall(now, form.timezone).date}
									value={form.date}
									onChange={(e) => update({ date: e.target.value })}
									{...invalid('date')}
								/>
							</label>
							{message('date')}
						</div>
					)}

					<div>
						<label className="field">
							Hora
							<input
								ref={timeRef}
								type="time"
								required
								value={form.time}
								className="h-14 max-w-40 text-2xl font-semibold tabular-nums sm:h-12 sm:text-xl"
								onChange={(e) => update({ time: e.target.value })}
								{...timeInvalid}
							/>
						</label>
						{message('time')}
						{!errors.time && message('when')}
						<p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-fg-subtle">
							Hora de {zoneCity(form.timezone)} ({form.timezone}) ·
							<button
								type="button"
								className="link inline-flex min-h-11 items-center px-1 sm:min-h-0"
								aria-expanded={zones}
								onClick={() => setZones(!zones)}
							>
								Cambiar
							</button>
						</p>
						{zones && (
							<label className="field mt-2 max-w-sm">
								Zona horaria
								<select value={form.timezone} onChange={(e) => update({ timezone: e.target.value })}>
									{zoneList(form.timezone).map((z) => (
										<option key={z} value={z}>
											{z}
										</option>
									))}
								</select>
							</label>
						)}
					</div>

					<label className="field">
						Nombre (opcional)
						<input
							maxLength={80}
							placeholder={phrase}
							value={form.name}
							onChange={(e) => update({ name: e.target.value })}
						/>
					</label>

					<div className="flex items-center justify-between gap-3">
						<span className="text-sm font-medium">Activo</span>
						<Switch checked={form.enabled} label="Activo" onChange={() => update({ enabled: !form.enabled })} />
					</div>

					{clash && (
						<p className="alert alert-warning">
							Choca con «{clash.name || `${actionLabel(clash.action, deviceType)} ${atTime(clash.when.time)}`}»: a la
							misma hora hace lo contrario.
						</p>
					)}
					<Problems lines={others} />
				</div>

				{editing && (
					<div className="flex flex-wrap items-center gap-2 border-t border-line p-4">
						{confirming ? (
							<>
								<p className="w-full text-sm">¿Borrar «{editing.name || phrase}»? No se puede deshacer.</p>
								<button
									type="button"
									className="btn btn-danger"
									disabled={remove.isPending}
									onClick={() => remove.mutate()}
								>
									Borrar
								</button>
								<button type="button" className="btn btn-secondary" autoFocus onClick={() => setConfirming(false)}>
									Cancelar
								</button>
								<div className="w-full">
									<Problems lines={api.errorLines(remove.error)} />
								</div>
							</>
						) : (
							<>
								<button type="button" className="btn btn-secondary" onClick={duplicate}>
									<Icon name="copy" size={16} />
									Duplicar
								</button>
								<button type="button" className="btn btn-ghost text-danger-fg" onClick={() => setConfirming(true)}>
									<Icon name="trash" size={16} />
									Borrar…
								</button>
							</>
						)}
					</div>
				)}

				{/* En el móvil, pegado sobre las pestañas de la app (unos 3,5 rem más el área segura) */}
				<div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 flex items-center justify-end gap-2 rounded-b-lg border-t border-line bg-surface p-4 lg:bottom-0">
					<Link to={base} className="btn btn-secondary">
						Cancelar
					</Link>
					<button type="submit" className="btn btn-primary" aria-busy={save.isPending} disabled={save.isPending}>
						Guardar programa
					</button>
				</div>
			</div>
		</form>
	)
}

// La lista del navegador puede no traer la zona actual (p. ej. «UTC»): se añade para que el select la muestre
function zoneList(current: string) {
	const all = Intl.supportedValuesOf('timeZone')
	return all.includes(current) ? all : [current, ...all]
}
