import { useQuery } from '@tanstack/react-query'
import type { DisplayEvent } from '@atekos/shared'
import * as api from '../../api'
import { Problems } from '../../components/Problems'
import { EmptyState, Loading } from '../../components/ui'
import { fullDate, groupByDay } from '../../labels'
import { useArrived } from './common'
import { useDisplay } from './DisplayLayout'

// Origen legible; vacío si el firmware no lo dice (o el evento es anterior a la 1.1)
export const origin = (ev: DisplayEvent) =>
	ev.source === 'button'
		? `Botón ${ev.button ?? '?'} (${ev.press === 'long' ? 'larga' : 'corta'})`
		: ev.source === 'touch'
			? 'Toque'
			: ''

// Resultado de ui.result en español; un estado nuevo de la API se ve tal cual
const STATUS: Record<string, [label: string, badge: string]> = {
	ok: ['Aceptado', 'badge-success'],
	rejected: ['Rechazado', 'badge-warning'],
	error: ['Error', 'badge-danger'],
}

const time = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' })

// Los toques que comparten En vivo y Actividad (misma clave de caché); el polling de 3 s es su tiempo real
export function useTouches(id: string) {
	const events = useQuery({
		queryKey: ['display-events', id],
		queryFn: () => api.listDisplayEvents(id),
		refetchInterval: 3000,
	})
	const arrived = useArrived(events.data?.[0]?.ts, !!events.data)
	return { events, arrived }
}

// Una fila: delante lo que se entiende (hora, origen, aviso y resultado); debajo, en pequeño, lo técnico
export function TouchRow({ ev, fresh }: { ev: DisplayEvent; fresh: boolean }) {
	const what = [origin(ev), ev.toast && `«${ev.toast}»`].filter(Boolean).join(' · ') || `Acción ${ev.actionId}`
	const [status, badge] = STATUS[ev.status] ?? [ev.status, '']
	const tech = [ev.name, `acción ${ev.actionId}`, `${ev.templateId} v${ev.templateVersion}`, `x ${ev.x}, y ${ev.y}`]
	return (
		<li className={`flex gap-3 px-4 py-3 sm:px-5 ${fresh ? 'motion-safe:animate-flash' : ''}`}>
			<time dateTime={ev.ts} title={fullDate(ev.ts)} className="shrink-0 text-sm text-fg-muted tabular-nums">
				{time.format(new Date(ev.ts))}
			</time>
			<div className="min-w-0 flex-1">
				<div className="flex items-start justify-between gap-3">
					<p className="min-w-0 text-sm font-medium break-words text-fg">{what}</p>
					<span className={`badge shrink-0 ${badge}`}>{status}</span>
				</div>
				<p className="mt-0.5 text-xs break-words text-fg-subtle">{tech.filter(Boolean).join(' · ')}</p>
			</div>
		</li>
	)
}

export function DisplayActivity() {
	const { display } = useDisplay()
	const { events, arrived } = useTouches(display.deviceId)

	return (
		<section>
			<h2>Actividad</h2>
			<p className="mt-1 text-sm text-fg-muted">Los últimos toques y botones de la pantalla.</p>
			<div className="mt-4 space-y-5">
				{events.isPending && <Loading />}
				{events.error && <Problems lines={['No se pudo cargar la actividad.', ...api.errorLines(events.error)]} />}
				{events.data?.length === 0 && (
					<EmptyState icon="screen" title="Sin actividad todavía">
						Aparece al tocar la pantalla o pulsar sus botones.
					</EmptyState>
				)}
				{/* La API ya los da del más reciente al más antiguo */}
				{groupByDay(events.data ?? [], (ev) => ev.ts).map((g) => (
					<div key={g.day}>
						<h3 className="mb-2 text-sm font-medium text-fg-muted">{g.label}</h3>
						<ol className="card divide-y divide-line">
							{g.items.map((ev) => (
								<TouchRow key={`${ev.ts}-${ev.eventId}`} ev={ev} fresh={arrived(ev.ts)} />
							))}
						</ol>
					</div>
				))}
			</div>
		</section>
	)
}
