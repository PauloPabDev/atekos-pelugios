import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { DisplayCommand } from '@atekos/shared'
import * as api from '../../api'
import { DisplayPreview } from '../../components/DisplayPreview'
import { Problems } from '../../components/Problems'
import { Status } from '../../components/Status'
import { Online } from '../Displays'
import { NextSchedules } from '../schedules/NextSchedules'
import { EXPLAIN } from './common'
import { TouchRow, useTouches } from './DisplayActivity'
import { useDisplay } from './DisplayLayout'

// La pantalla no informa de su brillo: se recuerda el último que se envió desde esta pestaña
const sentKey = (id: string) => `brillo:${id}`
function readSent(id: string) {
	try {
		const v = sessionStorage.getItem(sentKey(id))
		return v === null ? undefined : Number(v)
	} catch {
		return undefined
	}
}
function writeSent(id: string, percent: number) {
	try {
		sessionStorage.setItem(sentKey(id), String(percent))
	} catch {
		// sin storage: solo se pierde el recuerdo
	}
}

export function DisplayLive() {
	const { display: d } = useDisplay()
	const id = d.deviceId
	const [sent, setSent] = useState(() => readSent(id))
	const [percent, setPercent] = useState(() => sent ?? 25)
	const send = useMutation({
		mutationFn: (c: DisplayCommand) => api.sendDisplayCommand(id, c),
		onSuccess: (_, c) => {
			if (c.type === 'display.brightness') {
				writeSent(id, c.percent)
				setSent(c.percent)
			}
		},
	})
	// Se envía al soltar el mando (ratón, dedo o tecla), no en cada paso del arrastre
	const sendBrightness = () => send.mutate({ type: 'display.brightness', percent })
	const { events, arrived } = useTouches(id)
	const offline = !d.online

	return (
		<div className="space-y-8">
			<div className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start lg:gap-8">
				<section aria-labelledby="ahora">
					<h2 id="ahora" className="mb-3 text-center lg:text-left">
						Así se ve ahora
					</h2>
					{/* Lo guardado (plantilla activa y sus valores), nunca un borrador */}
					<div className="mx-auto w-fit max-w-full rounded-xl bg-zinc-900 p-2 [&_svg]:h-auto [&_svg]:max-h-[40svh] [&_svg]:w-auto [&_svg]:max-w-full lg:[&_svg]:max-h-[calc(100svh-18rem)]">
						<DisplayPreview template={d.template} values={d.values} />
					</div>
				</section>

				<div className="space-y-6">
					<section aria-labelledby="control" className="card">
						<div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
							<h2 id="control">Control</h2>
							<Online online={d.online} />
						</div>
						<div className="space-y-5 p-4 sm:p-5">
							{offline && (
								<p id="offline-hint" className="alert alert-info">
									La pantalla no está conectada: el brillo y el refresco no llegarían. Los datos y la plantilla sí se le
									envían al conectarse.
								</p>
							)}
							<div>
								<div className="flex items-baseline justify-between gap-3">
									<label htmlFor="brillo" className="text-sm font-medium text-fg">
										Brillo
									</label>
									<output htmlFor="brillo" className="text-sm font-medium tabular-nums">
										{percent} %
									</output>
								</div>
								<input
									id="brillo"
									type="range"
									min={0}
									max={50}
									value={percent}
									disabled={offline}
									aria-describedby={offline ? 'offline-hint brillo-hint' : 'brillo-hint'}
									className="mt-1 w-full"
									onChange={(e) => setPercent(Number(e.target.value))}
									onPointerUp={sendBrightness}
									onKeyUp={(e) => {
										if (e.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(e.key))
											sendBrightness()
									}}
								/>
								<small id="brillo-hint" className="mt-1 block">
									Se envía al soltar; como mucho, 50 %. La pantalla no informa de su brillo:{' '}
									{sent === undefined ? 'aún no has enviado ninguno desde aquí.' : `último enviado, ${sent} %.`}
								</small>
							</div>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
								<button
									type="button"
									className="btn btn-secondary"
									onClick={() => send.mutate({ type: 'display.refresh' })}
									disabled={offline || send.isPending}
									aria-describedby={offline ? 'offline-hint' : undefined}
								>
									Refrescar pantalla
								</button>
								<span className="text-sm text-fg-muted">Fuerza un redibujado completo.</span>
							</div>
							{/* Un solo envío para los dos comandos: el aviso y el error, debajo de ambos */}
							<div className="flex flex-col items-start gap-2">
								<Status
									m={send}
									text={send.variables?.type === 'display.refresh' ? 'Refresco enviado.' : 'Brillo enviado.'}
								/>
								<Problems lines={api.errorLines(send.error, EXPLAIN)} />
							</div>
						</div>
					</section>

					<NextSchedules target={{ kind: 'display', id: d.deviceId }} />
				</div>
			</div>

			<section aria-labelledby="toques">
				<div className="mb-2 flex items-center justify-between gap-3">
					<h2 id="toques">Últimos toques</h2>
					<Link to={`/displays/${id}/actividad`} className="btn btn-ghost -mr-3">
						Ver actividad
					</Link>
				</div>
				{events.error && <Problems lines={['No se pudo cargar la actividad.', ...api.errorLines(events.error)]} />}
				{events.data?.length === 0 && (
					<p className="card px-4 py-6 text-center text-sm text-fg-muted">
						Sin toques todavía: aparecen al tocar la pantalla o pulsar sus botones.
					</p>
				)}
				{!!events.data?.length && (
					<ol className="card divide-y divide-line">
						{events.data.slice(0, 5).map((ev) => (
							<TouchRow key={`${ev.ts}-${ev.eventId}`} ev={ev} fresh={arrived(ev.ts)} />
						))}
					</ol>
				)}
			</section>
		</div>
	)
}
