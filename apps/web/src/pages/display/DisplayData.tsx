import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DisplayValues, templateVariables } from '@atekos/shared'
import * as api from '../../api'
import { Problems } from '../../components/Problems'
import { Status } from '../../components/Status'
import { goalData, showcaseData, showcaseTemplate } from '../../examples'
import { EXPLAIN, fmt, validate } from './common'
import { useDisplay } from './DisplayLayout'

// Tarjeta con cabecera y pie
const CARD_HEAD = 'border-b border-line px-4 py-3 sm:px-5'
const CARD_FOOT =
	'flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-line bg-canvas px-4 py-3 sm:px-5'

export function DisplayData() {
	const { display } = useDisplay()
	const { deviceId: id, template, values } = display
	const qc = useQueryClient()
	const vars = templateVariables(template)
	// Textarea controlado: el polling no pisa el borrador
	const [text, setText] = useState(() => fmt(values))
	const draft = validate(DisplayValues, text)
	const save = useMutation({
		mutationFn: ({ v, merge }: { v: DisplayValues; merge: boolean }) =>
			merge ? api.patchDisplayData(id, v) : api.putDisplayData(id, v),
		onSuccess: (r) => {
			setText(fmt(r.values))
			return qc.invalidateQueries({ queryKey: ['display', id] })
		},
	})
	const send = (merge: boolean) => {
		if (draft.data) save.mutate({ v: draft.data, merge })
	}

	return (
		<section>
			<div className="card">
				<div className={`${CARD_HEAD} flex items-center justify-between gap-3`}>
					<h2>Datos</h2>
					<button
						type="button"
						className="btn btn-ghost -my-1.5 -mr-2"
						onClick={() => setText(fmt(template.id === showcaseTemplate.id ? showcaseData : goalData))}
					>
						Cargar datos de ejemplo
					</button>
				</div>
				<div className="space-y-3 p-4 sm:p-5">
					{vars.length > 0 && (
						<div className="flex flex-col gap-1.5">
							<h3 id="vars" className="text-sm font-medium">
								Variables que usa la plantilla activa ({template.id} v{template.version})
							</h3>
							<ul aria-labelledby="vars" className="flex flex-wrap gap-2">
								{vars.map((k) => {
									const set = Object.hasOwn(values, k)
									return (
										<li key={k} className={`badge max-w-full ${set ? '' : 'badge-warning'}`}>
											<span className="truncate">
												{k}: {set ? JSON.stringify(values[k]) : 'sin valor'}
											</span>
										</li>
									)
								})}
							</ul>
						</div>
					)}
					<div className="flex flex-col gap-1.5">
						<label className="field">
							Valores (JSON)
							<textarea
								value={text}
								onChange={(e) => setText(e.target.value)}
								rows={8}
								spellCheck={false}
								aria-invalid={!draft.data}
								aria-describedby="data-hint"
							/>
						</label>
						<small id="data-hint">
							Reemplazar sustituye todos los valores; Combinar solo cambia las claves que envíes (null guarda null).
						</small>
					</div>
					<Problems lines={draft.errors} />
					<Problems lines={api.errorLines(save.error, EXPLAIN)} />
				</div>
				<div className={CARD_FOOT}>
					<Status m={save} text="Guardado." />
					<button
						type="button"
						className="btn btn-secondary"
						onClick={() => send(false)}
						disabled={!draft.data || save.isPending}
					>
						Reemplazar
					</button>
					<button
						type="button"
						className="btn btn-secondary"
						onClick={() => send(true)}
						disabled={!draft.data || save.isPending}
					>
						Combinar
					</button>
				</div>
			</div>
		</section>
	)
}
