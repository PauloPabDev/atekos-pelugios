import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { Schedule } from '@atekos/shared'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { EmptyState, Loading, PageHeader } from '../components/ui'
import { useNow } from '../hooks/useNow'
import { useTitle } from '../hooks/useTitle'
import { actionLabel, agenda, DAYS, targetBase, type ScheduleTarget } from '../schedules'
import { LoadError, ScheduleList } from './schedules/ScheduleList'

// Vista global (§6.7): qué va a pasar hoy, mañana y esta semana, y todos los programas por destino.
// Se crean y editan en el contexto de su dispositivo o pantalla.
export function Schedules() {
	useTitle('Programas')
	const now = new Date(useNow(60_000))
	const all = useQuery({ queryKey: ['schedules'], queryFn: api.listAllSchedules })
	// Las mismas claves que / y /displays: si ya se cargaron, los nombres salen de la caché
	const devices = useQuery({ queryKey: ['devices'], queryFn: api.listDevices })
	const displays = useQuery({ queryKey: ['displays'], queryFn: api.listDisplays })

	const target = (t: ScheduleTarget) => {
		const device = t.kind === 'device' ? devices.data?.find((d) => d.id === t.id) : undefined
		const display = t.kind === 'display' ? displays.data?.find((d) => d.deviceId === t.id) : undefined
		return {
			name: device?.name ?? display?.name ?? (t.kind === 'device' ? 'Dispositivo' : t.id),
			type: device?.type,
			base: targetBase(t),
		}
	}

	const groups = new Map<string, Schedule[]>()
	for (const s of all.data ?? []) {
		const key = `${s.target.kind}:${s.target.id}`
		groups.set(key, [...(groups.get(key) ?? []), s])
	}
	const byTarget = [...groups.values()]
		.map((list) => ({ list, ...target(list[0]!.target) }))
		.sort((a, b) => a.name.localeCompare(b.name, 'es'))

	return (
		<>
			<PageHeader title="Programas" description="Se ejecutan en el servidor aunque no tengas la web abierta." />
			{all.isPending ? (
				<Loading />
			) : all.error ? (
				<LoadError retry={() => all.refetch()} busy={all.isFetching} />
			) : all.data.length === 0 ? (
				<EmptyState icon="clock" title="No tienes programas">
					Créalos desde la pestaña Programas de cualquier dispositivo o pantalla.
				</EmptyState>
			) : (
				<div className="space-y-10">
					<section className="space-y-4">
						<h2>Agenda</h2>
						{agenda(all.data, now).map(({ label, items }) => {
							const runs =
								items.length === 0 ? (
									<p className="text-sm text-fg-muted">Nada programado para hoy.</p>
								) : (
									<ul className="card divide-y divide-line overflow-hidden">
										{items.map(({ at, schedule: s }) => {
											const t = target(s.target)
											return (
												<li key={`${s.id}-${at.getTime()}`}>
													<Link
														to={`${t.base}/${s.id}`}
														className="flex min-h-11 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-canvas"
													>
														<span className="w-14 shrink-0 tabular-nums">
															{label === 'Esta semana' && (
																<span className="block text-xs text-fg-muted">
																	{DAYS[(at.getDay() + 6) % 7]!.slice(0, 3)}
																</span>
															)}
															<span className="font-semibold text-fg">{s.when.time}</span>
														</span>
														<span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-3">
															<span className="block truncate text-sm font-medium text-fg sm:w-40 sm:shrink-0">
																{actionLabel(s.action, t.type)}
															</span>
															<span className="block truncate text-sm text-fg-muted">
																{t.name}
																{s.name && ` · ${s.name}`}
															</span>
														</span>
														<span className="text-fg-subtle">
															<Icon name="chevron" size={16} />
														</span>
													</Link>
												</li>
											)
										})}
									</ul>
								)
							if (label !== 'Hoy' && items.length === 0) return null
							// Plegada: un programa diario sale aquí cinco veces
							return label === 'Esta semana' ? (
								<details key={label}>
									<summary>
										{label} ({items.length})
									</summary>
									<div className="mt-2">{runs}</div>
								</details>
							) : (
								<div key={label} className="space-y-2">
									<h3>{label}</h3>
									{runs}
								</div>
							)
						})}
					</section>

					<section className="space-y-6">
						<h2>Todos los programas</h2>
						{byTarget.map((g) => (
							<div key={g.base} className="space-y-2">
								<h3>
									<Link to={g.base} className="hover:underline">
										{g.name}
									</Link>
								</h3>
								<ScheduleList schedules={g.list} base={g.base} deviceType={g.type} />
							</div>
						))}
					</section>
				</div>
			)}
		</>
	)
}
