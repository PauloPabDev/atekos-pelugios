import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import type { DisplayDetail, DisplayTemplate } from '@atekos/shared'
import * as api from '../../api'
import { DisplayPreview } from '../../components/DisplayPreview'
import { Icon } from '../../components/Icon'
import { Problems } from '../../components/Problems'
import { Status } from '../../components/Status'
import { Loading } from '../../components/ui'
import { EXPLAIN } from './common'
import { useDisplay } from './DisplayLayout'

export function DisplayTemplates() {
	const { display: d } = useDisplay()
	const id = d.deviceId
	const qc = useQueryClient()
	const title = useRef<HTMLHeadingElement>(null)
	const templates = useQuery({
		queryKey: ['display-templates', id],
		queryFn: () => api.listDisplayTemplates(id),
	})
	const refresh = () =>
		Promise.all([
			qc.invalidateQueries({ queryKey: ['display', id] }),
			qc.invalidateQueries({ queryKey: ['display-templates', id] }),
		])
	const activate = useMutation({
		mutationFn: (templateId: string) => api.patchDisplay(id, { activeTemplateId: templateId }),
		onSuccess: refresh,
	})

	return (
		<section className="space-y-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1 basis-64">
					<h2 ref={title} tabIndex={-1}>
						Plantillas
					</h2>
					<p className="mt-1 text-sm text-fg-muted">
						La pantalla muestra la activa. Las demás sirven para cambiar con un toque (evento {'«screen.<id>»'}).
					</p>
				</div>
				<Link to={`/displays/${id}/plantillas/nueva`} className="btn btn-primary">
					<Icon name="plus" size={16} />
					Nueva plantilla
				</Link>
			</div>
			<div className="flex flex-col items-start gap-2">
				<Status m={activate} text="Plantilla activada." />
				<Problems lines={api.errorLines(activate.error, EXPLAIN)} />
			</div>
			{templates.isPending && <Loading />}
			{templates.error && (
				<Problems lines={['No se pudieron cargar las plantillas.', ...api.errorLines(templates.error)]} />
			)}
			{templates.data && (
				// Móvil: filas en una tarjeta; desde sm, rejilla de tarjetas con la miniatura grande
				<ul className="card divide-y divide-line sm:grid sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-3 sm:divide-y-0 sm:border-0 sm:bg-transparent sm:shadow-none">
					{templates.data.map((t) => (
						<TemplateItem
							key={t.id}
							d={d}
							t={t}
							activate={() => activate.mutate(t.id)}
							activating={activate.isPending}
							// Tras borrar, el foco vuelve al título: el botón pulsado ya no existe
							onDeleted={() => refresh().then(() => title.current?.focus())}
						/>
					))}
				</ul>
			)}
		</section>
	)
}

function TemplateItem({
	d,
	t,
	activate,
	activating,
	onDeleted,
}: {
	d: DisplayDetail
	t: DisplayTemplate
	activate: () => void
	activating: boolean
	onDeleted: () => void
}) {
	const [confirming, setConfirming] = useState(false)
	const del = useMutation({ mutationFn: () => api.deleteDisplayTemplate(d.deviceId, t.id), onSuccess: onDeleted })
	const active = t.id === d.activeTemplateId
	const name = <span className="sr-only">«{t.id}»</span>

	return (
		<li className="flex gap-3 p-3 sm:flex-col sm:rounded-lg sm:border sm:border-line sm:bg-surface">
			{/* content-visibility: las miniaturas fuera de la vista no se pintan (una plantilla puede pesar 1 MB) */}
			<div className="grid h-20 w-12 shrink-0 place-items-center overflow-hidden rounded-md bg-zinc-900 p-0.5 [content-visibility:auto] sm:h-44 sm:w-full sm:p-1.5 [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:max-w-full">
				<DisplayPreview template={t} values={d.values} mini />
			</div>
			<div className="min-w-0 flex-1 space-y-2">
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span className="truncate font-medium text-fg">{t.id}</span>
					<span className="text-sm text-fg-muted">v{t.version}</span>
					{active && (
						<span className="badge badge-success">
							<span className="dot dot-on" aria-hidden="true" />
							Activa
						</span>
					)}
				</p>
				{confirming ? (
					<div className="space-y-2">
						<p className="text-sm text-fg">¿Borrar la plantilla «{t.id}»? No se puede deshacer.</p>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								className="btn btn-danger"
								onClick={() => del.mutate()}
								disabled={del.isPending}
								aria-busy={del.isPending}
							>
								Sí, borrar
							</button>
							<button type="button" className="btn btn-secondary" autoFocus onClick={() => setConfirming(false)}>
								Cancelar
							</button>
						</div>
						<Problems lines={api.errorLines(del.error)} />
					</div>
				) : (
					<div className="-ml-1 flex flex-wrap gap-1">
						{!active && (
							<button type="button" className="btn btn-secondary ml-1" onClick={activate} disabled={activating}>
								Activar {name}
							</button>
						)}
						<Link to={`/displays/${d.deviceId}/plantillas/${encodeURIComponent(t.id)}`} className="btn btn-ghost">
							Editar {name}
						</Link>
						{/* La activa no se borra: la API da 409 y la pantalla se quedaría sin nada que dibujar */}
						{!active && (
							<button type="button" className="btn btn-ghost" onClick={() => setConfirming(true)}>
								Borrar… {name}
							</button>
						)}
					</div>
				)}
			</div>
		</li>
	)
}
