import { useId } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { DisplayValues, templateVariables } from '@atekos/shared'
import * as api from '../../api'
import { DisplayPreview } from '../../components/DisplayPreview'
import { Problems } from '../../components/Problems'
import { Status } from '../../components/Status'
import { EmptyState, Switch } from '../../components/ui'
import { goalData, showcaseData, showcaseTemplate } from '../../examples'
import { useDraft } from '../../hooks/useDraft'
import { EXPLAIN, fmt, KIND, kindOf, parseField, toField, validate } from './common'
import { useDisplay } from './DisplayLayout'

type Field = string | boolean
type Scalar = DisplayValues[string]

const CARD_HEAD = 'border-b border-line px-4 py-3 sm:px-5'
const SUBHEAD = 'border-b border-line bg-canvas px-4 py-2 sm:px-5'

export function DisplayData() {
	const { display } = useDisplay()
	const { deviceId: id, template, values } = display
	const qc = useQueryClient()
	// El borrador guarda solo lo que tocaste: lo que llega en vivo en las demás variables se sigue viendo
	const [edits, setEdits, draft] = useDraft<Record<string, Field>>(`/displays/${id}/datos`, {})
	const used = templateVariables(template)
	const others = Object.keys(values).filter((k) => !used.includes(k))

	const changed = Object.keys(edits).filter((k) => edits[k] !== toField(values[k]))
	const parsed = changed.map((k) => [k, parseField(kindOf(values[k]), edits[k]!)] as const)
	const patch = Object.fromEntries(parsed.flatMap(([k, r]) => ('value' in r ? [[k, r.value]] : [])))
	const invalid = parsed.some(([, r]) => 'error' in r)

	const save = useMutation({
		mutationFn: (v: DisplayValues) => api.patchDisplayData(id, v),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ['display', id] })
			draft.reset()
		},
	})
	const edit = (k: string, v: Field) => {
		const next = { ...edits, [k]: v }
		if (v === toField(values[k])) delete next[k] // vuelve a lo guardado: deja de ser un cambio
		setEdits(next)
	}
	const rows = (keys: string[]) =>
		keys.map((k) => <VarRow key={k} name={k} saved={values[k]} value={edits[k]} onChange={(v) => edit(k, v)} />)

	return (
		<div className="lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-8">
			<details open className="mb-6 lg:sticky lg:top-28 lg:order-last lg:mb-0">
				<summary>Vista previa</summary>
				<div className="mx-auto mt-2 w-fit max-w-full rounded-xl bg-zinc-900 p-2 [&_svg]:h-auto [&_svg]:max-h-[30svh] [&_svg]:w-auto [&_svg]:max-w-full lg:[&_svg]:max-h-[calc(100svh-16rem)]">
					<DisplayPreview template={template} values={{ ...values, ...patch }} />
				</div>
				<p className="mt-1.5 text-center text-xs text-fg-muted">Con tus cambios sin enviar.</p>
			</details>

			<div className="space-y-6">
				<form
					className="card"
					aria-labelledby="datos-title"
					onSubmit={(e) => {
						e.preventDefault()
						if (changed.length && !invalid) save.mutate(patch)
					}}
				>
					<div className={CARD_HEAD}>
						<h2 id="datos-title">Datos</h2>
						<p className="mt-1 text-sm text-fg-muted">
							Los valores que muestra «{template.id}». Al enviarlos, la pantalla se actualiza al momento (o al
							conectarse).
						</p>
					</div>
					{used.length > 0 ? (
						<>
							<h3 id="vars" className={SUBHEAD}>
								Variables que usa la plantilla activa
							</h3>
							<ul aria-labelledby="vars" className="divide-y divide-line">
								{rows(used)}
							</ul>
						</>
					) : (
						<div className="p-4 sm:p-5">
							<EmptyState
								icon="screen"
								title="Esta plantilla no usa variables"
								action={
									<Link
										to={`/displays/${id}/plantillas/${encodeURIComponent(template.id)}`}
										className="btn btn-secondary"
									>
										Editar plantilla
									</Link>
								}
							>
								Nómbralas en la plantilla con bind o format para editarlas aquí.
							</EmptyState>
						</div>
					)}
					{others.length > 0 && (
						<>
							<div className={`${SUBHEAD} border-t`}>
								<h3 id="otras">Otras variables</h3>
								<p className="text-xs text-fg-muted">No las usa la plantilla activa; quizá otras.</p>
							</div>
							<ul aria-labelledby="otras" className="divide-y divide-line">
								{rows(others)}
							</ul>
						</>
					)}
					{save.error && (
						<div className="border-t border-line p-4 sm:px-5">
							<Problems lines={api.errorLines(save.error, EXPLAIN)} />
						</div>
					)}
					{/* En el móvil, sticky sobre las pestañas de la app (48px + márgenes + área segura) */}
					<div className="sticky bottom-[calc(3.625rem+env(safe-area-inset-bottom))] flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-line bg-surface px-4 py-3 sm:px-5 lg:bottom-0">
						<span className="mr-auto text-sm text-fg-muted">
							<Status m={save} text="Enviado a la pantalla." />
							{changed.length > 0 && `${changed.length} ${changed.length === 1 ? 'cambio' : 'cambios'}`}
						</span>
						{draft.dirty && (
							<button type="button" className="btn btn-ghost" onClick={draft.reset}>
								Descartar
							</button>
						)}
						<button
							className="btn btn-primary"
							disabled={!changed.length || invalid || save.isPending}
							aria-busy={save.isPending}
						>
							Enviar a la pantalla
						</button>
					</div>
				</form>

				<JsonEditor id={id} templateId={template.id} values={values} />
			</div>
		</div>
	)
}

// Una variable: nombre y tipo a la izquierda, su control a la derecha (debajo en el móvil)
function VarRow({
	name,
	saved,
	value = toField(saved),
	onChange,
}: {
	name: string
	saved: Scalar | undefined
	value?: Field
	onChange: (v: Field) => void
}) {
	const uid = useId()
	const kind = kindOf(saved)
	const r = parseField(kind, value)
	const dirty = value !== toField(saved)
	const hint =
		'error' in r ? r.error : `${saved === undefined ? 'Sin valor' : KIND[kind]}${dirty ? ' · Modificado' : ''}`

	return (
		// Borde índigo a la izquierda: fila modificada, sin mover el contenido
		<li
			className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5 ${dirty ? 'shadow-[inset_2px_0_0_var(--color-brand)]' : ''}`}
		>
			<div className="min-w-0 flex-1 basis-40">
				{kind === 'bool' ? (
					<span className="mono text-sm break-all text-fg">{name}</span>
				) : (
					<label htmlFor={uid} className="mono text-sm break-all text-fg">
						{name}
					</label>
				)}
				<p id={`${uid}-hint`} className={`text-xs ${'error' in r ? 'text-danger-fg' : 'text-fg-muted'}`}>
					{hint}
				</p>
			</div>
			{kind === 'bool' ? (
				<span className="flex items-center gap-2 text-sm text-fg-muted">
					<span aria-hidden="true">{value ? 'Sí' : 'No'}</span>
					<Switch checked={value === true} label={name} onChange={() => onChange(!value)} />
				</span>
			) : (
				<input
					id={uid}
					className="w-full sm:w-60"
					inputMode={kind === 'number' ? 'decimal' : undefined}
					maxLength={140}
					value={String(value)}
					onChange={(e) => onChange(e.target.value)}
					aria-invalid={'error' in r}
					aria-describedby={`${uid}-hint`}
				/>
			)}
		</li>
	)
}

// Modo avanzado: todos los valores como JSON, con Reemplazar (PUT) y Combinar (PATCH)
function JsonEditor({ id, templateId, values }: { id: string; templateId: string; values: DisplayValues }) {
	const qc = useQueryClient()
	const [text, setText, draft] = useDraft(`/displays/${id}/datos/json`, fmt(values))
	const parsed = validate(DisplayValues, text)
	const save = useMutation({
		mutationFn: ({ v, merge }: { v: DisplayValues; merge: boolean }) =>
			merge ? api.patchDisplayData(id, v) : api.putDisplayData(id, v),
		onSuccess: async () => {
			await qc.invalidateQueries({ queryKey: ['display', id] })
			draft.reset()
		},
	})
	const send = (merge: boolean) => {
		if (parsed.data) save.mutate({ v: parsed.data, merge })
	}

	return (
		<details className="card px-4 sm:px-5" open={draft.dirty}>
			<summary>Ver como JSON (avanzado)</summary>
			<div className="space-y-3 pb-4">
				<div className="flex flex-col gap-1.5">
					<label className="field">
						Valores (JSON)
						<textarea
							value={text}
							onChange={(e) => setText(e.target.value)}
							rows={8}
							spellCheck={false}
							aria-invalid={!parsed.data}
							aria-describedby="data-hint"
						/>
					</label>
					<small id="data-hint">
						Reemplazar sustituye todos los valores; Combinar solo cambia las claves que envíes (null guarda null).
					</small>
				</div>
				<Problems lines={parsed.errors} />
				<Problems lines={api.errorLines(save.error, EXPLAIN)} />
				<div className="flex flex-wrap items-center justify-end gap-2">
					<button
						type="button"
						className="btn btn-ghost mr-auto -ml-3"
						onClick={() => setText(fmt(templateId === showcaseTemplate.id ? showcaseData : goalData))}
					>
						Cargar datos de ejemplo
					</button>
					<Status m={save} text="Guardado." />
					<button
						type="button"
						className="btn btn-secondary"
						onClick={() => send(false)}
						disabled={!parsed.data || save.isPending}
					>
						Reemplazar
					</button>
					<button
						type="button"
						className="btn btn-secondary"
						onClick={() => send(true)}
						disabled={!parsed.data || save.isPending}
					>
						Combinar
					</button>
				</div>
			</div>
		</details>
	)
}
