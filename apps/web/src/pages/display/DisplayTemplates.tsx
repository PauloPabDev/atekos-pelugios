import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import * as api from '../../api'
import { Icon } from '../../components/Icon'
import { Problems } from '../../components/Problems'
import { EXPLAIN } from './common'
import { useDisplay } from './DisplayLayout'

export function DisplayTemplates() {
	const { display: d } = useDisplay()
	const id = d.deviceId
	const qc = useQueryClient()
	const navigate = useNavigate()
	const pick = useRef<HTMLSelectElement>(null)
	const activate = useMutation({
		mutationFn: (templateId: string) => api.patchDisplay(id, { activeTemplateId: templateId }),
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: ['display', id] }),
				qc.invalidateQueries({ queryKey: ['display-templates', id] }),
			]),
	})
	const edit = () => {
		if (pick.current?.value) navigate(`/displays/${id}/plantillas/${encodeURIComponent(pick.current.value)}`)
	}

	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between gap-3">
				<h2>Plantillas</h2>
				<Link to={`/displays/${id}/plantillas/nueva`} className="btn btn-secondary">
					<Icon name="plus" size={16} />
					Nueva plantilla
				</Link>
			</div>
			<div className="flex flex-wrap items-end gap-2">
				<label className="field min-w-0 flex-1 basis-48">
					Plantillas guardadas
					<select ref={pick} key={d.activeTemplateId} defaultValue={d.activeTemplateId}>
						{d.templates.map((t) => (
							<option key={t.id} value={t.id}>
								{`${t.id} v${t.version}${t.id === d.activeTemplateId ? ' (activa)' : ''}`}
							</option>
						))}
					</select>
				</label>
				<div className="flex gap-2">
					<button
						type="button"
						className="btn btn-secondary"
						onClick={() => activate.mutate(pick.current?.value ?? '')}
						disabled={activate.isPending}
					>
						Activar
					</button>
					<button type="button" className="btn btn-secondary" onClick={edit}>
						Abrir en el editor
					</button>
				</div>
			</div>
			<Problems lines={api.errorLines(activate.error, EXPLAIN)} />
		</section>
	)
}
