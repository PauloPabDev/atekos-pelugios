import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import * as api from '../../api'
import { Icon } from '../../components/Icon'
import { Problems } from '../../components/Problems'
import { useDisplay } from './DisplayLayout'

export function DisplaySettings() {
	const { display } = useDisplay()
	const { deviceId: id, name } = display
	const qc = useQueryClient()
	const navigate = useNavigate()
	const [confirming, setConfirming] = useState(false)
	const del = useMutation({
		mutationFn: () => api.deleteDisplay(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['displays'] })
			navigate('/displays')
		},
	})

	return (
		<div className="space-y-8">
			<p className="text-sm text-fg-muted">
				Id de hardware <span className="mono">{id}</span>
			</p>
			<section>
				<div className="card border-red-200 p-4 sm:p-5">
					<h2>Borrar</h2>
					{confirming ? (
						<>
							<p className="mt-1 text-sm text-fg-muted">
								¿Borrar «{name}»? Sus tokens dejan de funcionar al momento y la pantalla se desconecta. No se puede
								deshacer.
							</p>
							<div className="mt-4 flex flex-wrap gap-2">
								<button type="button" className="btn btn-danger" onClick={() => del.mutate()} disabled={del.isPending}>
									Sí, borrar
								</button>
								<button type="button" className="btn btn-secondary" autoFocus onClick={() => setConfirming(false)}>
									Cancelar
								</button>
							</div>
							<div className="mt-3">
								<Problems lines={api.errorLines(del.error)} />
							</div>
						</>
					) : (
						<>
							<p className="mt-1 text-sm text-fg-muted">
								Quita la pantalla de tu cuenta con sus plantillas y datos. Sus tokens dejan de funcionar.
							</p>
							<button type="button" className="btn btn-danger-outline mt-4" onClick={() => setConfirming(true)}>
								<Icon name="trash" size={16} />
								Borrar pantalla
							</button>
						</>
					)}
				</div>
			</section>
		</div>
	)
}
