import { useQuery } from '@tanstack/react-query'
import type { DisplayEvent } from '@atekos/shared'
import * as api from '../../api'
import { Problems } from '../../components/Problems'
import { Loading } from '../../components/ui'
import { useDisplay } from './DisplayLayout'

const origin = (ev: DisplayEvent) =>
	ev.source === 'button'
		? `botón ${ev.button ?? '?'} ${ev.press === 'long' ? 'larga' : 'corta'}`
		: ev.source === 'touch'
			? 'toque'
			: '—'

// Resultado de ui.result en español; un estado nuevo de la API se ve tal cual
const STATUS: Record<string, [label: string, badge: string]> = {
	ok: ['Aceptado', 'badge-success'],
	rejected: ['Rechazado', 'badge-warning'],
	error: ['Error', 'badge-danger'],
}

export function DisplayActivity() {
	const { display } = useDisplay()
	const id = display.deviceId
	const events = useQuery({
		queryKey: ['display-events', id],
		queryFn: () => api.listDisplayEvents(id),
		refetchInterval: 3000,
	})

	return (
		<section>
			<h2>Eventos</h2>
			<div className="mt-3 space-y-3">
				{events.isPending && <Loading />}
				<Problems lines={api.errorLines(events.error)} />
				{events.data?.length === 0 && (
					<p className="card px-4 py-6 text-center text-sm text-fg-muted">
						Todavía no hay eventos: aparecen al tocar la pantalla o pulsar sus botones.
					</p>
				)}
				{!!events.data?.length && (
					<div className="card overflow-x-auto">
						{/* La API ya los devuelve del más reciente al más antiguo */}
						<table>
							<thead>
								<tr>
									<th scope="col">Hora</th>
									<th scope="col">Acción</th>
									<th scope="col">Evento</th>
									<th scope="col">Origen</th>
									<th scope="col">Estado</th>
									<th scope="col">Toast</th>
									<th scope="col">x,y</th>
								</tr>
							</thead>
							<tbody>
								{events.data.map((ev, i) => (
									<tr key={`${ev.eventId}-${i}`}>
										<td className="whitespace-nowrap text-fg-muted">
											<time dateTime={ev.ts}>{new Date(ev.ts).toLocaleString()}</time>
										</td>
										<td className="font-mono text-xs whitespace-nowrap">{ev.actionId}</td>
										<td>{ev.name ?? '—'}</td>
										<td className="whitespace-nowrap">{origin(ev)}</td>
										<td>
											<span className={`badge ${STATUS[ev.status]?.[1] ?? ''}`}>
												{STATUS[ev.status]?.[0] ?? ev.status}
											</span>
										</td>
										<td>{ev.toast ?? '—'}</td>
										<td className="font-mono text-xs whitespace-nowrap">
											{ev.x},{ev.y}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</section>
	)
}
