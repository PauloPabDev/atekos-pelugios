import { useState } from 'react'
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { Outlet, useLocation, useOutletContext, useParams } from 'react-router'
import type { Device } from '@atekos/shared'
import * as api from '../../api'
import { EntityHeader } from '../../components/EntityHeader'
import { SectionTabs } from '../../components/SectionTabs'
import { Loading, Switch } from '../../components/ui'
import { hasDraft } from '../../hooks/useDraft'
import { putDevice, useDeviceSocket, type SocketStatus } from '../../hooks/useDeviceSocket'
import { useTitle } from '../../hooks/useTitle'
import { DEVICE_ICON } from '../../labels'

// De dónde salió el toque: el error se pinta junto a ese control
export type ToggleFrom = 'header' | 'tile'

export type DeviceContext = {
	device: Device
	live: SocketStatus
	// «En vivo», «Conectando…», «Reconectando…» o «Sin conexión en vivo»
	liveText: string
	// Un solo toggle (optimista) para la cabecera y la tarjeta de En vivo: comparten pendiente y error
	toggle: UseMutationResult<Device, Error, ToggleFrom, Device | undefined>
	// En vivo avisa de si su tarjeta grande se ve: entonces la cabecera no pinta su interruptor
	setTileShown: (shown: boolean) => void
}
// Lo que el layout comparte con cada pestaña: el dispositivo (ya cargado, al día por WS) y el estado del WS
export const useDevice = () => useOutletContext<DeviceContext>()

// Los sensores no se encienden: se activan
export const stateLabel = (d: Pick<Device, 'type' | 'state'>) =>
	d.type === 'sensor' ? (d.state ? 'Activo' : 'Inactivo') : d.state ? 'Encendido' : 'Apagado'

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
	// La primera conexión «conecta»; las siguientes «reconectan»
	const [wasLive, setWasLive] = useState(false)
	if (live === 'live' && !wasLive) setWasLive(true)
	const [tileShown, setTileShown] = useState(false)
	// La variable (ToggleFrom) solo dice dónde pintar el error
	const toggle = useMutation<Device, Error, ToggleFrom, Device | undefined>({
		mutationFn: () => api.toggleDevice(id),
		// Optimista: cambia al momento; si falla, vuelve al estado de antes
		onMutate: async () => {
			await qc.cancelQueries({ queryKey: ['device', id] })
			const prev = qc.getQueryData<Device>(['device', id])
			if (prev) putDevice(qc, { ...prev, state: !prev.state })
			return prev
		},
		onError: (_e, _from, prev) => {
			const cur = qc.getQueryData<Device>(['device', id])
			if (prev && cur) putDevice(qc, { ...cur, state: prev.state })
		},
		onSuccess: (d) => putDevice(qc, d),
	})
	const tab = useLocation().pathname.split('/')[3] ?? ''
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
	const liveText = live === 'connecting' && wasLive ? 'Reconectando…' : LIVE[live]

	return (
		<>
			<EntityHeader
				back="/"
				backLabel="Volver a mis dispositivos"
				icon={DEVICE_ICON[d.type] ?? 'cube'}
				tone={d.state ? 'success' : 'neutral'}
				title={d.name}
				status={
					<>
						{stateLabel(d)} · {liveText}
						{/* Lo único de Ajustes que sigue en la cabecera: es información de privacidad */}
						{d.visibility === 'public' && <span className="badge badge-brand ml-2">Público</span>}
					</>
				}
				control={
					// Mientras se ve la tarjeta grande de En vivo, ella es el interruptor: nunca dos controles con ese nombre
					!tileShown && (
						<Switch checked={d.state} label={d.name} busy={toggle.isPending} onChange={() => toggle.mutate('header')} />
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
			{toggle.error && toggle.variables === 'header' && (
				<p role="alert" className="alert alert-error mt-3">
					{toggle.error.message}
				</p>
			)}
			{/* key: al pasar a otro dispositivo, las pestañas se montan de cero (sin borradores del anterior) */}
			<div key={d.id} className="mt-6">
				<Outlet context={{ device: d, live, liveText, toggle, setTileShown } satisfies DeviceContext} />
			</div>
		</>
	)
}

// Selector exclusivo con radios nativos (las flechas funcionan solas), con aspecto de botones pegados.
// shortcut: vive aquí porque solo lo usan las pestañas del dispositivo; si lo pide otra página, a components/Segmented.tsx
export function Segmented<T extends string>({
	label,
	name,
	value,
	options,
	onChange,
}: {
	label: string
	name: string
	value: T
	options: readonly (readonly [T, string])[]
	onChange: (v: T) => void
}) {
	return (
		<div
			role="radiogroup"
			aria-label={label}
			className="flex max-w-full overflow-x-auto rounded-lg bg-subtle p-0.5 [scrollbar-width:none]"
		>
			{options.map(([v, text]) => (
				<label
					key={v}
					className="inline-flex h-10 shrink-0 cursor-pointer items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors select-none hover:text-fg has-checked:bg-surface has-checked:text-fg has-checked:shadow-xs has-focus-visible:outline-2 has-focus-visible:outline-brand sm:h-8"
				>
					<input
						type="radio"
						className="sr-only"
						name={name}
						value={v}
						checked={value === v}
						onChange={() => onChange(v)}
					/>
					{text}
				</label>
			))}
		</div>
	)
}
