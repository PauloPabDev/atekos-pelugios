import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as api from '../../api'
import { Loading } from '../../components/ui'
import { ACTOR, ago, EVENT, fullDate, label, SOURCE } from '../../labels'
import { useDevice } from './DeviceLayout'

const onOff = (s: boolean) => (s ? 'encendido' : 'apagado')

export function DeviceActivity() {
	const { device } = useDevice()
	const id = device.id
	// La clave incluye updatedAt: cada cambio (propio o por WS) recarga el historial solo
	const events = useQuery({
		queryKey: ['events', id, device.updatedAt],
		queryFn: () => api.listEvents(id),
		placeholderData: keepPreviousData,
	})

	return (
		<section>
			<h2>Historial</h2>
			{events.isPending && <Loading />}
			{events.error && (
				<p role="alert" className="alert alert-error mt-3">
					{events.error.message}
				</p>
			)}
			{events.data?.length === 0 && <p className="mt-1 text-sm text-fg-muted">Sin eventos todavía.</p>}
			{!!events.data?.length && (
				<ol className="mt-4 ml-1.5 border-l border-line">
					{events.data.map((ev, i) => (
						<li key={`${ev.ts}-${i}`} className="relative pb-5 pl-5 last:pb-0">
							<span className={`dot absolute top-1.5 -left-[4.5px] ${ev.after?.state ? 'dot-on' : ''}`} />
							<div className="flex items-baseline gap-3">
								<p className="min-w-0 flex-1 text-sm text-fg">
									<span className="font-medium">{label(EVENT, ev.type)}</span>
									{ev.before && ev.after && ev.before.state !== ev.after.state && (
										<span className="text-fg-muted">
											{' '}
											· {onOff(ev.before.state)} → {onOff(ev.after.state)}
										</span>
									)}
								</p>
								<time dateTime={ev.ts} title={fullDate(ev.ts)} className="shrink-0 text-xs text-fg-subtle">
									{ago(ev.ts)}
								</time>
							</div>
							<p className="text-sm text-fg-muted">
								{label(ACTOR, ev.actor.kind)} · {label(SOURCE, ev.source)}
							</p>
						</li>
					))}
				</ol>
			)}
		</section>
	)
}
