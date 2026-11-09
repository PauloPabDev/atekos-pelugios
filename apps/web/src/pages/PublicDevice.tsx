import { useEffect, useReducer } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { useDeviceSocket } from '../hooks/useDeviceSocket'
import { ago, DEVICE_ICON, fullDate } from '../labels'
import '../styles/devices.css'

// Sin login: si es privado la API responde 404 (§6), igual que si no existe
export function PublicDevice() {
	const { id = '' } = useParams()
	const device = useQuery({ queryKey: ['device', id], queryFn: () => api.getDevice(id) })
	const live = useDeviceSocket(device.data ? [id] : [])
	// Repinta cada 30 s para que «Actualizado hace …» no se quede congelado en una pantalla abierta
	const [, tick] = useReducer((n: number) => n + 1, 0)
	useEffect(() => {
		const t = setInterval(tick, 30_000)
		return () => clearInterval(t)
	}, [])

	if (device.isPending) return <p className="loading">Cargando…</p>
	if (device.error instanceof api.HttpError && device.error.status === 404)
		return (
			<div className="empty narrow public-device">
				<span className="tile pink">
					<Icon name="spark" size={32} />
				</span>
				<h1>No disponible</h1>
				<p className="muted">Este dispositivo no existe o es privado.</p>
			</div>
		)
	if (device.error)
		return (
			<p role="alert" className="error">
				{device.error.message}
			</p>
		)
	const d = device.data

	return (
		<div className="card narrow public-device">
			<span className={`tile ${d.state ? 'green' : 'off'}`}>
				<Icon name={DEVICE_ICON[d.type] ?? 'cube'} size={32} />
			</span>
			<h1>{d.name}</h1>
			{d.description && <p>{d.description}</p>}
			<div className="chips">
				<span className={`state big ${d.state ? 'on' : 'off'}`}>{d.state ? 'Encendido' : 'Apagado'}</span>
				{live && <span className="state on live">En vivo</span>}
			</div>
			<p className="muted">
				Actualizado{' '}
				<time dateTime={d.updatedAt} title={fullDate(d.updatedAt)}>
					{ago(d.updatedAt)}
				</time>
			</p>
		</div>
	)
}
