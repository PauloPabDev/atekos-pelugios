import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import * as api from '../api'
import { EmptyState, IconTile, Loading } from '../components/ui'
import { useDeviceSocket } from '../hooks/useDeviceSocket'
import { useNow } from '../hooks/useNow'
import { ago, DEVICE_ICON, fullDate } from '../labels'

// Sin login: si es privado la API responde 404 (§6), igual que si no existe
export function PublicDevice() {
	const { id = '' } = useParams()
	const device = useQuery({ queryKey: ['device', id], queryFn: () => api.getDevice(id) })
	const live = useDeviceSocket(device.data ? [id] : [])
	const now = useNow(30_000)

	if (device.isPending) return <Loading />
	if (device.error instanceof api.HttpError && device.error.status === 404)
		return (
			<div className="mx-auto max-w-md">
				<EmptyState icon="eye" title="No disponible">
					Este dispositivo no existe o es privado.
				</EmptyState>
			</div>
		)
	if (device.error)
		return (
			<p role="alert" className="alert alert-error mx-auto max-w-md">
				{device.error.message}
			</p>
		)
	const d = device.data

	return (
		<div className="card mx-auto flex max-w-md flex-col items-center p-6 text-center sm:p-8">
			<IconTile name={DEVICE_ICON[d.type] ?? 'cube'} tone={d.state ? 'success' : 'neutral'} />
			<h1 className="mt-4 max-w-full break-words">{d.name}</h1>
			{d.description && <p className="mt-1 max-w-full text-sm break-words text-fg-muted">{d.description}</p>}
			<p className="mt-6 flex items-center gap-2.5 text-2xl font-semibold text-fg">
				<span className={`dot size-2.5 ${d.state ? 'dot-on' : ''}`} />
				{d.state ? 'Encendido' : 'Apagado'}
			</p>
			<div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-fg-muted">
				{live === 'live' && (
					<span className="badge badge-success">
						<span className="dot dot-live" />
						En vivo
					</span>
				)}
				<span>
					Actualizado{' '}
					<time dateTime={d.updatedAt} title={fullDate(d.updatedAt)}>
						{ago(d.updatedAt, now)}
					</time>
				</span>
			</div>
		</div>
	)
}
