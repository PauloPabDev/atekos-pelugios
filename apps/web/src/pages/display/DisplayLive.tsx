import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { DisplayCommand } from '@atekos/shared'
import * as api from '../../api'
import { Problems } from '../../components/Problems'
import { Status } from '../../components/Status'
import { IconTile } from '../../components/ui'
import { EXPLAIN } from './common'
import { useDisplay } from './DisplayLayout'

export function DisplayLive() {
	const { display } = useDisplay()
	const id = display.deviceId
	const [percent, setPercent] = useState(25)
	const send = useMutation({ mutationFn: (c: DisplayCommand) => api.sendDisplayCommand(id, c) })

	return (
		<section>
			<h2>Comandos</h2>
			<div className="mt-3 grid gap-4 sm:grid-cols-2">
				<div className="card flex flex-col p-4 sm:p-5">
					<div className="flex items-center gap-3">
						<IconTile name="refresh" />
						<h3>Refrescar</h3>
					</div>
					<p className="mt-3 mb-4 text-sm text-fg-muted">Fuerza un redibujado completo de la pantalla.</p>
					<button
						type="button"
						className="btn btn-secondary mt-auto self-start"
						onClick={() => send.mutate({ type: 'display.refresh' })}
						disabled={send.isPending}
					>
						Refrescar pantalla
					</button>
				</div>
				<div className="card flex flex-col p-4 sm:p-5">
					<div className="flex items-center gap-3">
						<IconTile name="sun" />
						<h3>Brillo</h3>
					</div>
					<div className="mt-3 mb-4 flex items-end gap-3">
						<label className="field flex-1">
							Brillo (0 a 50)
							<input
								type="range"
								min={0}
								max={50}
								value={percent}
								onChange={(e) => setPercent(Number(e.target.value))}
							/>
						</label>
						{/* Centrado con el slider, que mide 44px en el móvil y 36px desde sm */}
						<output className="mono mb-2.5 w-9 text-center sm:mb-1.5">{percent}</output>
					</div>
					<button
						type="button"
						className="btn btn-secondary mt-auto self-start"
						onClick={() => send.mutate({ type: 'display.brightness', percent })}
						disabled={send.isPending}
					>
						Enviar
					</button>
				</div>
			</div>
			{/* Un solo envío para los dos comandos: el aviso y el error van debajo de ambos (sin ellos, alto 0) */}
			<div className="mt-3 flex flex-col items-start gap-2">
				<Status m={send} text="Enviado." />
				<Problems lines={api.errorLines(send.error, EXPLAIN)} />
			</div>
		</section>
	)
}
