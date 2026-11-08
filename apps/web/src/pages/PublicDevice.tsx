import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import * as api from '../api'
import { useDeviceSocket } from '../hooks/useDeviceSocket'

// Sin login: si es privado la API responde 404 (§6), igual que si no existe
export function PublicDevice() {
	const { id = '' } = useParams()
	const device = useQuery({ queryKey: ['device', id], queryFn: () => api.getDevice(id) })
	useDeviceSocket(device.data ? [id] : [])
	const d = device.data

	return (
		<main className="page narrow">
			{device.isPending && <p>Cargando…</p>}
			{device.error ? (
				<p role="alert" className="error">
					{device.error instanceof api.HttpError && device.error.status === 404
						? 'Este dispositivo no existe o es privado.'
						: device.error.message}
				</p>
			) : (
				d && (
					<>
						<h1>{d.name}</h1>
						{d.description && <p>{d.description}</p>}
						<p className="card">
							<span className={`state ${d.state ? 'on' : 'off'}`}>{d.state ? 'Encendido' : 'Apagado'}</span>
						</p>
						<p className="muted">
							{d.type} · actualizado <time dateTime={d.updatedAt}>{new Date(d.updatedAt).toLocaleString()}</time>
						</p>
					</>
				)
			)}
		</main>
	)
}
