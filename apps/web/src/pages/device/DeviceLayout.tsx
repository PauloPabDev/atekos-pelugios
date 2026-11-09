import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Outlet, useLocation, useMatch, useOutletContext, useParams } from 'react-router'
import type { Device } from '@atekos/shared'
import * as api from '../../api'
import { EntityHeader } from '../../components/EntityHeader'
import { SectionTabs } from '../../components/SectionTabs'
import { Loading, Switch } from '../../components/ui'
import { hasDraft } from '../../hooks/useDraft'
import { putDevice, useDeviceSocket, type SocketStatus } from '../../hooks/useDeviceSocket'
import { useTitle } from '../../hooks/useTitle'
import { DEVICE_ICON } from '../../labels'

export type DeviceContext = { device: Device; live: SocketStatus }
// Lo que el layout comparte con cada pestaña: el dispositivo (ya cargado, al día por WS) y el estado del WS
export const useDevice = () => useOutletContext<DeviceContext>()

const LIVE: Record<SocketStatus, string> = {
	live: 'En vivo',
	connecting: 'Conectando…',
	offline: 'Sin conexión en vivo',
}

const TABS = [
	['', 'En vivo'],
	['datos', 'Datos'],
	['programas', 'Programas'],
	['actividad', 'Actividad'],
	['ajustes', 'Ajustes'],
] as const

export function DeviceLayout() {
	const { id = '' } = useParams()
	const qc = useQueryClient()
	const device = useQuery({ queryKey: ['device', id], queryFn: () => api.getDevice(id) })
	// En el layout: el WS sigue abierto al cambiar de pestaña
	const live = useDeviceSocket(device.data ? [id] : [])
	const toggle = useMutation({ mutationFn: () => api.toggleDevice(id), onSuccess: (d) => putDevice(qc, d) })
	const tab = useLocation().pathname.split('/')[3] ?? ''
	// En vivo ya tiene el interruptor: en la cabecera solo cuando no se ve (un solo control con ese nombre)
	const onLive = !!useMatch('/devices/:id')
	useTitle(TABS.find(([to]) => to === tab)?.[1], device.data?.name)

	if (device.isPending) return <Loading />
	if (device.error)
		return (
			<>
				<EntityHeader back="/" backLabel="Volver a mis dispositivos" icon="cube" title="Dispositivo" sticky={false} />
				<p role="alert" className="alert alert-error mt-4">
					{device.error.message}
				</p>
			</>
		)
	const d = device.data
	const base = `/devices/${id}`

	return (
		<>
			<EntityHeader
				back="/"
				backLabel="Volver a mis dispositivos"
				icon={DEVICE_ICON[d.type] ?? 'cube'}
				tone={d.state ? 'success' : 'neutral'}
				title={d.name}
				status={`${d.state ? 'Encendido' : 'Apagado'} · ${LIVE[live]}`}
				control={
					!onLive && (
						<Switch checked={d.state} label={d.name} busy={toggle.isPending} onChange={() => toggle.mutate()} />
					)
				}
			>
				<SectionTabs
					label={`Secciones de «${d.name}»`}
					tabs={TABS.map(([to, label]) =>
						to ? { to: `${base}/${to}`, label, dirty: hasDraft(`${base}/${to}`) } : { to: base, label, end: true },
					)}
				/>
			</EntityHeader>
			{toggle.error && !onLive && (
				<p role="alert" className="alert alert-error mt-3">
					{toggle.error.message}
				</p>
			)}
			{/* key: al pasar a otro dispositivo, las pestañas se montan de cero (sin borradores del anterior) */}
			<div key={d.id} className="mt-6">
				<Outlet context={{ device: d, live } satisfies DeviceContext} />
			</div>
		</>
	)
}
