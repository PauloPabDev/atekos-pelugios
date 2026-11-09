import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import type { ApiToken, Device, DeviceEvent } from '@atekos/shared'
import * as api from '../../api'
import { EmptyState, Loading } from '../../components/ui'
import { enc, showValue } from '../../components/KeyValueEditor'
import { useNow } from '../../hooks/useNow'
import { ACTOR, ago, DEVICE_TYPE, EVENT, fullDate, groupByDay, label, SOURCE } from '../../labels'
import { Segmented, useDevice } from './DeviceLayout'

const LIMIT = 200

// «brillo 40 → 80», «modo añadido», «color quitado»: como mucho `max` y «+N más»
export function dataChanges(before: Record<string, unknown>, after: Record<string, unknown>, max = 2) {
	const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
	const parts = keys.flatMap((k) => {
		const [had, has] = [Object.hasOwn(before, k), Object.hasOwn(after, k)]
		if (!had) return [`${k} añadido`]
		if (!has) return [`${k} quitado`]
		if (enc(before[k]) === enc(after[k])) return []
		return [`${k} ${showValue(before[k], 20)} → ${showValue(after[k], 20)}`]
	})
	return parts.length > max ? [...parts.slice(0, max), `+${parts.length - max} más`] : parts
}

function settingsChanges(b: Device, a: Device) {
	const parts: string[] = []
	if (b.name !== a.name) parts.push(`nombre «${b.name}» → «${a.name}»`)
	if (b.type !== a.type) parts.push(`tipo ${label(DEVICE_TYPE, b.type)} → ${label(DEVICE_TYPE, a.type)}`)
	if (b.description !== a.description) parts.push('descripción cambiada')
	if (b.status !== a.status) parts.push(a.status === 'active' ? 'activado' : 'desactivado')
	const vis = b.visibility !== a.visibility && (a.visibility === 'public' ? 'ahora es público' : 'ahora es privado')
	if (vis && !parts.length) return vis[0]!.toUpperCase() + vis.slice(1)
	if (vis) parts.push(vis)
	return parts.length ? `Ajustes: ${parts.join(', ')}` : 'Ajustes guardados sin cambios'
}

// Qué pasó, en lenguaje llano y sin jerga
export function eventText(ev: Pick<DeviceEvent, 'type' | 'before' | 'after'>) {
	const { before: b, after: a } = ev
	const sensor = (a ?? b)?.type === 'sensor'
	if (ev.type === 'state.changed' && a) {
		if (b && b.state === a.state)
			return sensor ? `Sigue ${a.state ? 'activo' : 'inactivo'}` : `Sigue ${a.state ? 'encendido' : 'apagado'}`
		return sensor ? (a.state ? 'Se activó' : 'Se desactivó') : a.state ? 'Se encendió' : 'Se apagó'
	}
	if (ev.type === 'data.changed' && a) {
		const parts = dataChanges(b?.data ?? {}, a.data)
		return parts.length ? `Datos: ${parts.join(', ')}` : 'Datos guardados sin cambios'
	}
	if (ev.type === 'device.updated' && a && b) return settingsChanges(b, a)
	return label(EVENT, ev.type)
}

// Quién: un programa, tú, un token (por su nombre si sigue en la lista) o alguien anónimo
export function whoText(ev: Pick<DeviceEvent, 'actor' | 'source'>, tokens?: readonly ApiToken[]) {
	if (ev.source === 'schedule') return label(SOURCE, 'schedule')
	if (ev.actor.kind === 'token') {
		// Los permisos de las apps conectadas (OAuth) también actúan como token y no salen en /tokens: «Token» a secas
		const t = tokens?.find((x) => x.id === ev.actor.id)
		return t ? `Token «${t.name}»` : 'Token'
	}
	return label(ACTOR, ev.actor.kind)
}

type Kind = 'todo' | 'estado' | 'datos' | 'ajustes'
type Origin = 'todos' | 'tu' | 'tokens' | 'programas'
const KINDS: readonly (readonly [Kind, string])[] = [
	['todo', 'Todo'],
	['estado', 'Estado'],
	['datos', 'Datos'],
	['ajustes', 'Ajustes'],
]
const ORIGINS: readonly (readonly [Origin, string])[] = [
	['todos', 'Todos'],
	['tu', 'Tú'],
	['tokens', 'Tokens'],
	['programas', 'Programas'],
]
const KIND_TYPES: Record<Kind, readonly string[] | null> = {
	todo: null,
	estado: ['state.changed'],
	datos: ['data.changed'],
	ajustes: ['device.updated', 'device.created'],
}
const fromOrigin = (ev: DeviceEvent, o: Origin) =>
	o === 'todos' ||
	(o === 'programas' && ev.source === 'schedule') ||
	(o === 'tokens' && ev.actor.kind === 'token') ||
	(o === 'tu' && ev.actor.kind === 'user' && ev.source !== 'schedule')

const pick = <T extends string>(list: readonly (readonly [T, string])[], raw: string | null) =>
	list.find(([v]) => v === raw)?.[0] ?? list[0]![0]

const time = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' })

// Una fila de evento: qué pasó, quién y cuándo. `fresh`: llegó en vivo (destello al montarse)
export function EventRow({
	ev,
	tokens,
	now,
	fresh,
	clock = false,
}: {
	ev: DeviceEvent
	tokens?: readonly ApiToken[]
	now: number
	fresh: boolean
	// Con la hora del día delante (Actividad, agrupada por días)
	clock?: boolean
}) {
	return (
		<li className={`flex items-start gap-3 px-4 py-3 sm:px-5 ${fresh ? 'motion-safe:animate-flash' : ''}`}>
			{clock && (
				<span className="w-11 shrink-0 pt-px text-sm text-fg-subtle tabular-nums">{time.format(new Date(ev.ts))}</span>
			)}
			<span className={`dot mt-1.5 ${ev.after?.state ? 'dot-on' : ''}`} aria-hidden="true" />
			<div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-4">
				<p className="min-w-0 text-sm break-words text-fg sm:flex-1">{eventText(ev)}</p>
				<p className="text-sm text-fg-muted sm:w-44 sm:shrink-0 sm:truncate">{whoText(ev, tokens)}</p>
			</div>
			<time dateTime={ev.ts} title={fullDate(ev.ts)} className="shrink-0 pt-px text-xs text-fg-subtle">
				{ago(ev.ts, now)}
			</time>
		</li>
	)
}

export function DeviceActivity() {
	const { device } = useDevice()
	const id = device.id
	const now = useNow()
	const [params, setParams] = useSearchParams()
	const kind = pick(KINDS, params.get('tipo'))
	const origin = pick(ORIGINS, params.get('origen'))
	// Los filtros van en la URL: se pueden enlazar y sobreviven a «atrás»
	const setFilter = (k: 'tipo' | 'origen', v: string, def: string) =>
		setParams(
			(p) => {
				if (v === def) p.delete(k)
				else p.set(k, v)
				return p
			},
			{ replace: true },
		)
	// La clave incluye updatedAt: cada cambio (propio o por WS) recarga el historial solo
	const events = useQuery({
		queryKey: ['events', id, LIMIT, device.updatedAt],
		queryFn: () => api.listEvents(id, LIMIT),
		placeholderData: keepPreviousData,
	})
	const tokens = useQuery({ queryKey: ['tokens'], queryFn: api.listTokens, staleTime: 60_000 })
	// Lo más reciente que había al abrir: lo posterior llegó en vivo y entra con destello
	const [seen, setSeen] = useState<string>()
	if (events.data && seen === undefined) setSeen(events.data[0]?.ts ?? '')

	const types = KIND_TYPES[kind]
	const shown = (events.data ?? []).filter((ev) => (!types || types.includes(ev.type)) && fromOrigin(ev, origin))
	const filtered = kind !== 'todo' || origin !== 'todos'

	return (
		<section className="space-y-4">
			<h2>Actividad</h2>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Segmented
					label="Tipo"
					name="tipo"
					value={kind}
					options={KINDS}
					onChange={(v) => setFilter('tipo', v, 'todo')}
				/>
				<label className="flex items-center gap-2 text-sm font-medium text-fg max-sm:w-full">
					Origen
					<select
						className="max-sm:flex-1 sm:w-40"
						value={origin}
						onChange={(e) => setFilter('origen', e.target.value, 'todos')}
					>
						{ORIGINS.map(([v, text]) => (
							<option key={v} value={v}>
								{text}
							</option>
						))}
					</select>
				</label>
			</div>

			{events.isPending && <Loading />}
			{events.error && (
				<div role="alert" className="alert alert-error flex flex-wrap items-center justify-between gap-2">
					No se pudo cargar la actividad.
					<button type="button" className="btn btn-secondary" onClick={() => events.refetch()}>
						Reintentar
					</button>
				</div>
			)}
			{events.data?.length === 0 && (
				<EmptyState icon="clock" title="Sin actividad todavía">
					Aquí verás cada vez que alguien o algo lo encienda, lo apague o cambie sus datos.
				</EmptyState>
			)}
			{!!events.data?.length && !shown.length && (
				<EmptyState
					icon="search"
					title="Nada con estos filtros"
					action={
						<button type="button" className="btn btn-secondary" onClick={() => setParams({}, { replace: true })}>
							Quitar filtros
						</button>
					}
				/>
			)}
			{groupByDay(shown, (ev) => ev.ts, new Date(now)).map((g) => (
				<div key={g.day}>
					<h3 className="mb-2">{g.label}</h3>
					<ul className="card divide-y divide-line">
						{g.items.map((ev) => (
							<EventRow
								key={`${ev.ts}-${ev.type}`}
								ev={ev}
								tokens={tokens.data}
								now={now}
								fresh={seen !== undefined && ev.ts > seen}
								clock
							/>
						))}
					</ul>
				</div>
			))}
			{!!events.data?.length && (
				<p className="text-sm text-fg-subtle">
					{/* shortcut: sin cursor en la API no hay «Cargar más»; llega con ?before= (fase 2) */}
					{events.data.length >= LIMIT && `Últimos ${LIMIT} eventos${filtered ? ', antes de filtrar' : ''}. `}
					El historial se guarda 180 días.
				</p>
			)}
		</section>
	)
}
