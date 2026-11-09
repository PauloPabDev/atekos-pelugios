import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { DeviceEvent, TelemetryReading } from '@atekos/shared'
import * as api from '../../api'
import { enc, showValue } from '../../components/KeyValueEditor'
import { PowerTile } from '../../components/PowerTile'
import { Sparkline } from '../../components/Sparkline'
import { EmptyState, Loading } from '../../components/ui'
import { useNow } from '../../hooks/useNow'
import { ago, dayLabel, DEVICE_ICON, fullDate } from '../../labels'
import { SCOPE_TEXT } from '../../scopes'
import { EventRow, eventText, whoText } from './DeviceActivity'
import { Segmented, stateLabel, useDevice } from './DeviceLayout'

const RECENT = 8
const SHOWN_DATA = 8
// Tope de la API: devuelve las más recientes del rango
const READINGS_LIMIT = 1000
const RANGES = [
	['24h', '24 h'],
	['7d', '7 d'],
] as const
type Range = (typeof RANGES)[number][0]
const RANGE: Record<Range, { ms: number; text: string }> = {
	'24h': { ms: 86_400_000, text: 'las últimas 24 h' },
	'7d': { ms: 7 * 86_400_000, text: 'los últimos 7 días' },
}

const time = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' })
const num = new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format

// «desde las 19:00», «desde ayer a las 23:30» o «desde el jueves 5 de noviembre»
export function sinceText(ts: string, now = new Date()) {
	const d = new Date(ts)
	const day = dayLabel(d, now)
	if (day === 'Hoy') return `desde las ${time.format(d)}`
	if (day === 'Ayer') return `desde ayer a las ${time.format(d)}`
	return `desde el ${day}`
}

// Una serie por métrica, en el orden en que aparecen; una lectura puede no traerlas todas
export function metricSeries(readings: readonly TelemetryReading[]) {
	const series = new Map<string, [number, number][]>()
	for (const r of readings)
		for (const [k, v] of Object.entries(r.values)) {
			const points = series.get(k) ?? []
			if (!points.length) series.set(k, points)
			points.push([Date.parse(r.ts), v])
		}
	return [...series].map(([key, points]) => {
		const ys = points.map(([, y]) => y)
		return { key, points, last: ys.at(-1)!, min: Math.min(...ys), max: Math.max(...ys) }
	})
}

export function DeviceLive() {
	const { device: d, live, liveText, toggle, setTileShown } = useDevice()
	const id = d.id
	const sensor = d.type === 'sensor'
	const now = useNow()
	const recent = useQuery({
		queryKey: ['events', id, RECENT, d.updatedAt],
		queryFn: () => api.listEvents(id, RECENT),
		placeholderData: keepPreviousData,
	})
	const tokens = useQuery({ queryKey: ['tokens'], queryFn: api.listTokens, staleTime: 60_000 })

	// Mientras la tarjeta se ve, ella es el interruptor y la cabecera no pinta el suyo (un solo control con ese nombre).
	// Margen superior: lo que tapa la cabecera sticky no cuenta como visto.
	const tile = useRef<HTMLElement>(null)
	useLayoutEffect(() => {
		if (sensor || !tile.current) return
		setTileShown(true)
		// Sin IntersectionObserver (jsdom) se da por vista
		if (typeof IntersectionObserver === 'undefined') return () => setTileShown(false)
		const io = new IntersectionObserver(([e]) => setTileShown(!!e?.isIntersecting), {
			rootMargin: '-160px 0px 0px 0px',
		})
		io.observe(tile.current)
		return () => {
			io.disconnect()
			setTileShown(false)
		}
	}, [sensor, setTileShown])

	// Lo más reciente que había al abrir: lo posterior llegó en vivo y entra con destello
	const [seen, setSeen] = useState<string>()
	if (recent.data && seen === undefined) setSeen(recent.data[0]?.ts ?? '')
	const said = useAnnounce(recent.data, d.name, toggle.submittedAt, tokens.data)

	// Claves de data que acaban de cambiar: su fila se vuelve a montar (key nueva) y destella
	const prevData = useRef(d.data)
	const [flashed, setFlashed] = useState<string[]>([])
	useEffect(() => {
		const p = prevData.current
		prevData.current = d.data
		if (p === d.data) return
		setFlashed(Object.keys(d.data).filter((k) => enc(Object.hasOwn(p, k) ? p[k] : undefined) !== enc(d.data[k])))
	}, [d.data])

	const lastState = recent.data?.find((e) => e.type === 'state.changed')
	// Solo si cuenta el estado de ahora (no durante el cambio optimista)
	const detail =
		lastState?.after?.state === d.state
			? `${sinceText(lastState.ts, new Date(now))} · ${whoText(lastState, tokens.data)}`
			: undefined
	const data = Object.entries(d.data)

	return (
		<div className="space-y-8">
			<div className="space-y-3">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<span className={`badge ${live === 'live' ? 'badge-success' : live === 'offline' ? 'badge-warning' : ''}`}>
						<span
							aria-hidden="true"
							className={`dot ${live === 'live' ? 'dot-live' : live === 'connecting' ? 'animate-pulse' : ''}`}
						/>
						{liveText}
					</span>
					{live === 'offline' && (
						<>
							<button
								type="button"
								className="btn btn-ghost"
								// shortcut: el hook reintenta al volver la red; un «online» sintético lo dispara. Si useDeviceSocket
								// expone reconnect(), usarlo
								onClick={() => window.dispatchEvent(new Event('online'))}
							>
								Reconectar
							</button>
							<span className="text-sm text-fg-muted">El interruptor sigue funcionando.</span>
						</>
					)}
				</div>
				<div className="flex flex-col gap-4 lg:flex-row lg:items-start">
					<div className="min-w-0 lg:flex-[3]">
						<PowerTile
							ref={tile}
							name={d.name}
							on={d.state}
							label={stateLabel(d)}
							icon={DEVICE_ICON[d.type] ?? 'cube'}
							detail={detail}
							busy={toggle.isPending}
							// Un sensor no se enciende: su «Activo» va en el interruptor de la cabecera
							onToggle={sensor ? undefined : () => toggle.mutate('tile')}
						/>
						{toggle.error && toggle.variables === 'tile' && (
							<p role="alert" className="alert alert-error mt-3">
								{toggle.error.message}
							</p>
						)}
					</div>
					{/* Próximos programas: hueco para la tarjeta del agente de programas, que integra el orquestador.
					    Vacío no ocupa sitio (empty:hidden) y la tarjeta de encendido toma todo el ancho. */}
					<div className="min-w-0 empty:hidden lg:flex-[2]" />
				</div>
			</div>

			{sensor && <Readings id={id} sensor now={now} />}

			<section>
				<div className="mb-2 flex items-center justify-between gap-3">
					<h2>Últimos cambios</h2>
					<Link to={`/devices/${id}/actividad`} className="btn btn-ghost -mr-3 sm:-mr-2">
						Ver actividad
					</Link>
				</div>
				{recent.isPending && <Loading />}
				{recent.error && (
					<div role="alert" className="alert alert-error flex flex-wrap items-center justify-between gap-2">
						No se pudo cargar la actividad.
						<button type="button" className="btn btn-secondary" onClick={() => recent.refetch()}>
							Reintentar
						</button>
					</div>
				)}
				{recent.data?.length === 0 && (
					<p className="card px-4 py-6 text-center text-sm text-fg-muted">Sin cambios todavía.</p>
				)}
				{!!recent.data?.length && (
					<ul className="card divide-y divide-line">
						{recent.data.map((ev) => (
							<EventRow
								key={`${ev.ts}-${ev.type}`}
								ev={ev}
								tokens={tokens.data}
								now={now}
								fresh={seen !== undefined && ev.ts > seen}
							/>
						))}
					</ul>
				)}
				{/* Lo que llega en vivo, resumido y con freno: una sola región por página */}
				<p role="status" aria-live="polite" className="sr-only">
					{said}
				</p>
			</section>

			<div className="flex flex-col gap-8 lg:flex-row lg:items-start">
				<section className="min-w-0 lg:flex-1">
					<div className="mb-2 flex items-center justify-between gap-3">
						<h2>Datos actuales</h2>
						<Link to={`/devices/${id}/datos`} className="btn btn-ghost -mr-3 sm:-mr-2">
							Editar
						</Link>
					</div>
					{data.length === 0 ? (
						<p className="card px-4 py-6 text-center text-sm text-fg-muted">Sin datos todavía.</p>
					) : (
						<dl className="card divide-y divide-line">
							{data.slice(0, SHOWN_DATA).map(([k, v]) => (
								<div
									key={flashed.includes(k) ? `${k}@${d.updatedAt}` : k}
									className={`flex items-baseline justify-between gap-4 px-4 py-2.5 sm:px-5 ${
										flashed.includes(k) ? 'motion-safe:animate-flash' : ''
									}`}
								>
									<dt className="min-w-0 truncate font-mono text-sm text-fg-muted">{k}</dt>
									<dd className="min-w-0 truncate text-right text-sm text-fg">{showValue(v)}</dd>
								</div>
							))}
						</dl>
					)}
					{data.length > SHOWN_DATA && (
						<Link to={`/devices/${id}/datos`} className="link mt-2 inline-block text-sm">
							Ver todos ({data.length})
						</Link>
					)}
				</section>
				{!sensor && <Readings id={id} sensor={false} now={now} />}
			</div>
		</div>
	)
}

// Anuncio para el lector de pantalla: solo cambios de estado (los datos de un ESP llegan cada pocos segundos: se ven,
// no se dicen), sin eco de tu propio toque (el interruptor ya lo dice) y como mucho uno cada 5 s
function useAnnounce(
	events: DeviceEvent[] | undefined,
	name: string,
	toggledAt: number,
	tokens: Parameters<typeof whoText>[1],
) {
	const [said, setSaid] = useState('')
	const top = useRef<string>(undefined)
	const last = useRef(0)
	useEffect(() => {
		if (!events) return
		const prev = top.current
		top.current = events[0]?.ts ?? prev ?? ''
		if (prev === undefined) return
		const fresh = events.filter((e) => e.ts > prev && e.type === 'state.changed')
		const t = Date.now()
		if (!fresh.length || t - toggledAt < 3000 || t - last.current < 5000) return
		last.current = t
		setSaid(
			fresh.length === 1
				? `«${name}»: ${eventText(fresh[0]!).toLowerCase()} · ${whoText(fresh[0]!, tokens)}`
				: `${fresh.length} cambios nuevos en «${name}»`,
		)
		// Solo cuando llegan eventos: el resto se lee del momento
	}, [events])
	return said
}

function Readings({ id, sensor, now }: { id: string; sensor: boolean; now: number }) {
	const [range, setRange] = useState<Range>('24h')
	const q = useQuery({
		queryKey: ['telemetry', id, range],
		queryFn: () =>
			api.getTelemetry(id, { from: new Date(Date.now() - RANGE[range].ms).toISOString(), limit: READINGS_LIMIT }),
		placeholderData: keepPreviousData,
		// Moderado (TanStack no lo hace con la pestaña oculta); en lo que no es un sensor y no ha enviado nada, ni eso
		refetchInterval: (query) => (sensor || query.state.data?.length ? 30_000 : false),
	})
	const readings = q.data ?? []
	// Fuera de los sensores, el bloque solo sale si hay lecturas
	if (!sensor && !readings.length) return null

	const series = metricSeries(readings)
	const last = readings.at(-1)
	const first = readings[0]
	// El tope devuelve las más recientes: si se llega a él, el rango no está entero y se dice cuánto cubre
	const covered =
		readings.length >= READINGS_LIMIT && first
			? `Solo caben las ${READINGS_LIMIT} lecturas más recientes: cubren las últimas ${Math.max(
					1,
					Math.round((now - Date.parse(first.ts)) / 3_600_000),
				)} h.`
			: `Lecturas de ${RANGE[range].text}.`

	return (
		<section className="min-w-0 space-y-3 lg:flex-1">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2>Lecturas</h2>
				<div className="flex flex-wrap items-center gap-3">
					{last && (
						<span className="text-sm text-fg-muted">
							Última lectura{' '}
							<time dateTime={last.ts} title={fullDate(last.ts)}>
								{ago(last.ts, now)}
							</time>
						</span>
					)}
					<Segmented label="Rango" name={`rango-${id}`} value={range} options={RANGES} onChange={setRange} />
				</div>
			</div>
			{q.isPending && <Loading />}
			{q.error && (
				<div role="alert" className="alert alert-error flex flex-wrap items-center justify-between gap-2">
					No se pudieron cargar las lecturas.
					<button type="button" className="btn btn-secondary" onClick={() => q.refetch()}>
						Reintentar
					</button>
				</div>
			)}
			{q.isSuccess && !readings.length && (
				<EmptyState
					icon="sensor"
					title="Este sensor aún no ha enviado lecturas"
					action={
						<Link to="/tokens" className="btn btn-secondary">
							Crear token
						</Link>
					}
				>
					<code className="mono my-2 block text-left break-all">
						POST /api/v1/devices/{id}/telemetry {'{"values":{"temp":21.5}}'}
					</code>
					Necesita un token con el permiso «{SCOPE_TEXT['telemetry:write']}».
				</EmptyState>
			)}
			{!!series.length && (
				<>
					<ul className={`grid gap-3 sm:grid-cols-2 ${sensor ? 'lg:grid-cols-3' : ''}`}>
						{series.map((s) => (
							<li key={s.key} className="card p-4">
								<p className="truncate font-mono text-sm text-fg-muted">{s.key}</p>
								<p className="mt-1 text-2xl font-semibold text-fg tabular-nums">{num(s.last)}</p>
								<Sparkline
									className="mt-2"
									points={s.points}
									label={`${s.key}: ${num(s.last)} ahora; mínimo ${num(s.min)} y máximo ${num(s.max)} en ${RANGE[range].text}`}
								/>
								<p className="mt-1 text-xs text-fg-subtle tabular-nums" aria-hidden="true">
									mín {num(s.min)} · máx {num(s.max)}
								</p>
							</li>
						))}
					</ul>
					<p className="text-sm text-fg-subtle">{covered}</p>
					<details className="card px-4 sm:px-5">
						<summary>Ver lecturas en tabla</summary>
						<div className="-mx-4 overflow-x-auto border-t border-line sm:-mx-5">
							<table>
								<caption className="sr-only">Las 20 lecturas más recientes</caption>
								<thead>
									<tr>
										<th scope="col">Hora</th>
										{series.map((s) => (
											<th key={s.key} scope="col" className="font-mono">
												{s.key}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{readings
										.slice(-20)
										.reverse()
										.map((r) => (
											<tr key={r.ts}>
												<td className="whitespace-nowrap text-fg-muted">{fullDate(r.ts)}</td>
												{series.map((s) => {
													const v = Object.hasOwn(r.values, s.key) ? r.values[s.key] : undefined
													return (
														<td key={s.key} className="tabular-nums">
															{v === undefined ? '—' : num(v)}
														</td>
													)
												})}
											</tr>
										))}
								</tbody>
							</table>
						</div>
					</details>
				</>
			)}
		</section>
	)
}
