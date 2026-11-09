import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import * as api from '../../api'
import { Icon } from '../../components/Icon'
import { Loading } from '../../components/ui'
import { useNow } from '../../hooks/useNow'
import { actionLabel, nextRunLabel, targetBase, type ScheduleTarget } from '../../schedules'
import { byNext, LoadError } from './ScheduleList'

// Tarjeta «Próximos» para En vivo: las siguientes ejecuciones y el camino a la pestaña Programas
export function NextSchedules({ target, max = 3 }: { target: ScheduleTarget; max?: number }) {
	const titleId = useId()
	const now = useNow()
	const base = targetBase(target)
	const list = useQuery({ queryKey: ['schedules', target.kind, target.id], queryFn: () => api.listSchedules(target) })
	const next = (list.data ?? []).filter((s) => s.enabled && s.nextRunAt).sort(byNext)

	return (
		<section aria-labelledby={titleId} className="card p-4">
			<div className="flex items-center justify-between gap-3">
				<h2 id={titleId}>Próximos</h2>
				{!!list.data?.length && (
					<Link to={base} className="link inline-flex min-h-11 items-center gap-0.5 text-sm sm:min-h-0">
						Ver programas
						<Icon name="chevron" size={14} />
					</Link>
				)}
			</div>
			{list.isPending ? (
				<Loading />
			) : list.error ? (
				<div className="mt-3">
					<LoadError retry={() => list.refetch()} busy={list.isFetching} />
				</div>
			) : next.length === 0 ? (
				<div className="mt-2 flex flex-wrap items-center justify-between gap-3">
					<p className="text-sm text-fg-muted">
						{list.data.length ? 'Todos los programas están pausados.' : 'Nada programado.'}
					</p>
					<Link to={`${base}/nuevo`} className="btn btn-secondary">
						<Icon name="clock" size={16} />
						Programar
					</Link>
				</div>
			) : (
				<ul className="mt-2 divide-y divide-line">
					{next.slice(0, max).map((s) => (
						<li key={s.id}>
							<Link
								to={`${base}/${s.id}`}
								className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-fg"
							>
								<span className="min-w-0 truncate">
									<span className="font-medium text-fg">
										{nextRunLabel(s.nextRunAt!, s.when.timezone, new Date(now)).replace(/^./, (c) => c.toUpperCase())}
									</span>
									{s.name && <span className="text-fg-muted"> · {s.name}</span>}
								</span>
								<span className="badge">{actionLabel(s.action)}</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	)
}
