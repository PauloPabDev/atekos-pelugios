import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useParams } from 'react-router'
import * as api from '../../api'
import { Icon } from '../../components/Icon'
import { EmptyState, Loading } from '../../components/ui'
import {
	browserZone,
	describeSchedule,
	nextRunLabel,
	SUGGESTIONS,
	targetBase,
	type ScheduleTarget,
} from '../../schedules'
import { fromSchedule, ScheduleForm, type FormNav, type ListNav } from './ScheduleForm'
import { LoadError, ScheduleList } from './ScheduleList'

// La pestaña Programas de un dispositivo o una pantalla: según la URL, la lista, «nuevo» o la edición de uno
export function SchedulesTab({
	target,
	name,
	deviceType,
}: {
	target: ScheduleTarget
	name: string
	deviceType?: string
}) {
	const { scheduleId } = useParams()
	const location = useLocation()
	const isNew = location.pathname.endsWith('/programas/nuevo')
	const onList = !scheduleId && !isNew
	const base = targetBase(target)
	const list = useQuery({ queryKey: ['schedules', target.kind, target.id], queryFn: () => api.listSchedules(target) })
	const heading = useRef<HTMLHeadingElement>(null)
	// Al llegar desde otra pestaña o al volver del formulario, el foco va al título (no en la carga inicial)
	useEffect(() => {
		if (onList && location.key !== 'default') heading.current?.focus({ preventScroll: true })
	}, [onList, location.key])

	if (!onList) {
		if (list.isPending) return <Loading />
		if (list.error) return <LoadError retry={() => list.refetch()} busy={list.isFetching} />
		const editing = list.data.find((s) => s.id === scheduleId)
		if (scheduleId && !editing)
			return (
				<EmptyState
					icon="clock"
					title="Este programa no existe"
					action={
						<Link to={base} className="btn btn-secondary">
							Ver programas
						</Link>
					}
				>
					Quizá ya se borró.
				</EmptyState>
			)
		return (
			<ScheduleForm
				key={scheduleId ?? 'nuevo'}
				target={target}
				deviceType={deviceType}
				siblings={list.data}
				editing={editing}
			/>
		)
	}

	const nav = location.state as ListNav | null
	const saved = nav?.saved
	const newLink = (
		<Link to={`${base}/nuevo`} className="btn btn-primary">
			<Icon name="plus" size={16} />
			Nuevo programa
		</Link>
	)

	return (
		<section className="space-y-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 ref={heading} tabIndex={-1} className="outline-none">
						Programas
					</h2>
					<p className="mt-0.5 text-sm text-fg-muted">Se ejecutan en el servidor aunque no tengas la web abierta.</p>
				</div>
				{!!list.data?.length && newLink}
			</div>

			{(saved || nav?.deleted) && (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
					<p role="status" className="inline-flex items-center gap-1.5 font-medium text-success-fg">
						<Icon name="check" size={16} />
						{saved
							? `Programa guardado. ${saved.nextRunAt ? `Próxima vez: ${nextRunLabel(saved.nextRunAt, saved.when.timezone)}.` : 'Está pausado.'}`
							: 'Programa borrado.'}
					</p>
					{/* Rangos sin modelo nuevo: «de 19:00 a 23:00» son dos programas */}
					{saved?.action.type === 'device.on' && (
						<Link
							to={`${base}/nuevo`}
							state={
								{
									preset: { ...fromSchedule(saved), action: 'device.off', name: '', enabled: true },
									focus: 'time',
								} satisfies FormNav
							}
							className="link inline-flex min-h-11 items-center sm:min-h-0"
						>
							Crear también el apagado
						</Link>
					)}
				</div>
			)}

			{list.isPending ? (
				<Loading />
			) : list.error ? (
				<LoadError retry={() => list.refetch()} busy={list.isFetching} />
			) : list.data.length === 0 ? (
				<EmptyState icon="clock" title="Sin programas todavía" action={newLink}>
					<p>
						{target.kind === 'device'
							? `Haz que «${name}» se encienda o se apague sola a la hora que quieras.`
							: `Haz que «${name}» cambie de brillo o se refresque sola a la hora que quieras.`}
					</p>
					{/* Una sugerencia abre el formulario relleno; nunca guarda sin confirmar */}
					<ul aria-label="Sugerencias" className="mt-4 space-y-2 text-left">
						{SUGGESTIONS[target.kind].map((sg) => {
							const when = { repeat: 'weekly', days: sg.days, time: sg.time, timezone: browserZone() } as const
							return (
								<li key={sg.title}>
									<Link
										to={`${base}/nuevo`}
										state={{ preset: fromSchedule({ when, action: sg.action }) } satisfies FormNav}
										className="flex min-h-11 items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 shadow-xs transition-colors hover:bg-subtle"
									>
										<span className="min-w-0 flex-1">
											<span className="block font-medium text-fg">{sg.title}</span>
											<span className="block text-xs text-fg-muted">
												{describeSchedule({ when, action: sg.action }, deviceType)}
											</span>
										</span>
										<Icon name="chevron" size={16} />
									</Link>
								</li>
							)
						})}
					</ul>
				</EmptyState>
			) : (
				<ScheduleList schedules={list.data} base={base} deviceType={deviceType} />
			)}
		</section>
	)
}
