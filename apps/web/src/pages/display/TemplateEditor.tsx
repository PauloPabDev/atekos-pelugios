import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { currentFrame, displaySize, DisplayTemplate, encodeImage } from '@atekos/shared'
import type { DisplayDetail } from '@atekos/shared'
import * as api from '../../api'
import { DisplayPreview } from '../../components/DisplayPreview'
import { Icon } from '../../components/Icon'
import { Problems } from '../../components/Problems'
import { Status } from '../../components/Status'
import { EmptyState, Loading } from '../../components/ui'
import { goalTemplate, showcaseTemplate, statusTemplate } from '../../examples'
import { useDraft } from '../../hooks/useDraft'
import { EXPLAIN, fmt, nextVersion, validate } from './common'
import { useDisplay } from './DisplayLayout'

// Una vacía con un id libre: así «Guardar» no pisa por descuido una plantilla que ya existe
function blank(taken: { id: string }[]): DisplayTemplate {
	let n = taken.length + 1
	while (taken.some((t) => t.id === `plantilla-${n}`)) n++
	return { id: `plantilla-${n}`, version: 1, elements: [], actions: [] }
}

// plantillas/:templateId edita la guardada; plantillas/nueva parte de una vacía
export function TemplateEditor() {
	const { display: d } = useDisplay()
	const { templateId } = useParams()
	const templates = useQuery({
		queryKey: ['display-templates', d.deviceId],
		queryFn: () => api.listDisplayTemplates(d.deviceId),
		enabled: !!templateId,
	})

	if (!templateId) return <Editor d={d} initial={blank(d.templates)} />
	if (templates.isPending) return <Loading />
	if (templates.error) return <Problems lines={api.errorLines(templates.error)} />
	const t = templates.data.find((t) => t.id === templateId)
	if (!t)
		return (
			<EmptyState
				icon="screen"
				title="Esta plantilla no existe"
				action={
					<Link to={`/displays/${d.deviceId}/plantillas`} className="btn btn-secondary">
						Ver las plantillas
					</Link>
				}
			/>
		)
	return <Editor key={t.id} d={d} initial={t} saved={t.id} />
}

// saved: el id de la plantilla guardada que se edita; sin él, es una nueva
function Editor({ d, initial, saved }: { d: DisplayDetail; initial: DisplayTemplate; saved?: string }) {
	const id = d.deviceId
	const base = `/displays/${id}/plantillas`
	const qc = useQueryClient()
	const navigate = useNavigate()
	const title = useRef<HTMLHeadingElement>(null)
	// Recién creada: el editor de la nueva ruta lo dice y se lleva el foco (el botón pulsado ya no existe)
	const created = (useLocation().state as { saved?: number } | null)?.saved
	useEffect(() => {
		if (created) title.current?.focus()
	}, [created])

	// Memo: el timer de la animación re-renderiza cada 50 ms y una plantilla puede pesar 1 MB
	const initialText = useMemo(() => fmt(initial), [initial])
	// Textarea controlado y en borrador: ni el polling ni cambiar de pestaña lo pisan
	const [text, setText, draft] = useDraft(`${base}/${saved ?? 'nueva'}`, initialText)
	const parsed = useMemo(() => validate(DisplayTemplate, text), [text])
	const [panel, setPanel] = useState<'code' | 'preview'>('code')
	const [discarding, setDiscarding] = useState(false)
	const [showActions, setShowActions] = useState(false)
	const [playing, setPlaying] = useState(false)
	const shown = parsed.data ?? initial
	const frame = useFrame(playing ? shown.animation : undefined)

	// La versión se sube sola: la siguiente a la guardada con ese id, salvo que el borrador ya traiga una mayor
	const stored = d.templates.find((t) => t.id === parsed.data?.id)?.version
	const next = parsed.data && nextVersion(parsed.data.version, stored)
	const save = useMutation({
		mutationFn: ({ t, active }: { t: DisplayTemplate; active: boolean }) =>
			active ? api.putActiveTemplate(id, t) : api.putDisplayTemplate(id, t),
		onSuccess: async (_, { t }) => {
			await Promise.all([
				qc.invalidateQueries({ queryKey: ['display', id] }),
				qc.invalidateQueries({ queryKey: ['display-templates', id] }),
			])
			draft.reset()
			// Nueva, o renombrada en el JSON: su editor es otra ruta
			if (t.id !== saved)
				navigate(`${base}/${encodeURIComponent(t.id)}`, { replace: true, state: { saved: t.version } })
		},
		// Un 409 es una carrera con otra pestaña: al recargar las versiones, el siguiente intento ya acierta
		onError: () => qc.invalidateQueries({ queryKey: ['display', id] }),
	})
	const saveDraft = (active: boolean) => {
		if (parsed.data && next) save.mutate({ t: { ...parsed.data, version: next }, active })
	}
	const errors = parsed.errors.length

	return (
		<section>
			<div className="mb-3 flex items-center gap-2">
				<Link to={base} aria-label="Volver a las plantillas" className="btn btn-icon btn-ghost -ml-3 sm:-ml-2">
					<Icon name="back" size={20} />
				</Link>
				<div className="min-w-0 flex-1">
					<h2 ref={title} tabIndex={-1} className="truncate">
						{saved ? `Editar «${saved}»` : 'Nueva plantilla'}
					</h2>
					<p className="truncate text-sm text-fg-muted">
						{next === undefined
							? 'Corrige los errores para poder guardar.'
							: stored === undefined
								? `Se guardará como v${next}.`
								: parsed.data?.id !== saved
									? `Ya existe «${parsed.data?.id}» v${stored}: se guardará encima como v${next}.`
									: `v${stored} → se guardará como v${next}`}
						{draft.dirty && ' · Sin guardar'}
					</p>
				</div>
			</div>

			{/* Móvil: un panel a pantalla completa cada vez; desde lg, los dos a la vez */}
			<div className="sticky top-14 z-20 -mx-4 mb-3 bg-canvas px-4 py-2 sm:-mx-6 sm:px-6 lg:hidden">
				<div
					role="radiogroup"
					aria-label="Panel"
					className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-subtle p-1"
				>
					{(
						[
							['code', errors ? `Código (${errors} ${errors === 1 ? 'error' : 'errores'})` : 'Código'],
							['preview', 'Vista previa'],
						] as const
					).map(([p, label]) => (
						<label
							key={p}
							className="grid h-11 cursor-pointer place-items-center rounded-md text-sm font-medium text-fg-muted has-checked:bg-surface has-checked:text-fg has-checked:shadow-xs has-focus-visible:outline-2 has-focus-visible:outline-brand sm:h-9"
						>
							<input type="radio" name="panel" className="sr-only" checked={panel === p} onChange={() => setPanel(p)} />
							{label}
						</label>
					))}
				</div>
			</div>

			<div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-8">
				<div className={`space-y-2 lg:sticky lg:top-8 ${panel === 'code' ? 'max-lg:hidden' : ''}`}>
					{/* Ancho y alto auto: manda el tamaño ×2 del SVG, recortado por los máximos sin deformarse */}
					<div className="mx-auto w-fit max-w-full rounded-xl bg-zinc-900 p-2 [&_svg]:h-auto [&_svg]:max-h-[calc(100svh-17rem)] [&_svg]:w-auto [&_svg]:max-w-full lg:[&_svg]:max-h-[calc(100svh-22rem)]">
						<DisplayPreview template={shown} values={d.values} showActions={showActions} frame={frame} />
					</div>
					{!parsed.data && (
						<p className="text-center text-xs text-warning-fg">
							El borrador tiene errores: se muestra la versión guardada.
						</p>
					)}
					<div className="flex flex-wrap gap-x-5">
						<label className="check">
							<input type="checkbox" checked={showActions} onChange={(e) => setShowActions(e.target.checked)} />
							Mostrar zonas táctiles
						</label>
						{shown.animation && (
							<label className="check">
								<input type="checkbox" checked={playing} onChange={(e) => setPlaying(e.target.checked)} />
								Reproducir animación
							</label>
						)}
					</div>
				</div>
				<div className={`space-y-4 ${panel === 'preview' ? 'max-lg:hidden' : ''}`}>
					<div className="divide-y divide-line rounded-lg border border-line bg-surface px-3">
						<details>
							<summary>Ejemplos</summary>
							<div className="-mx-2 flex flex-wrap pb-2">
								<button type="button" className="btn btn-ghost" onClick={() => setText(fmt(goalTemplate))}>
									Cargar ejemplo
								</button>
								<button type="button" className="btn btn-ghost" onClick={() => setText(fmt(statusTemplate))}>
									Cargar ejemplo de estado
								</button>
								<button type="button" className="btn btn-ghost" onClick={() => setText(fmt(showcaseTemplate))}>
									Cargar ejemplo avanzado
								</button>
							</div>
						</details>
						<ImportImage text={text} setText={setText} />
					</div>
					<div className="flex flex-col gap-1.5">
						<label className="field">
							Plantilla (JSON)
							<textarea
								value={text}
								onChange={(e) => setText(e.target.value)}
								rows={18}
								spellCheck={false}
								className="max-lg:h-[calc(100svh-15rem)] lg:min-h-[60svh]"
								aria-invalid={!parsed.data}
								aria-describedby="template-hint"
							/>
						</label>
						<small id="template-hint">
							La versión se sube sola al guardar: la pantalla guarda en caché cada id y versión.
						</small>
					</div>
					<Problems lines={parsed.errors} />
				</div>
			</div>

			{/* En el móvil el editor va sin las pestañas de la app (App.tsx): guardar queda abajo del todo, sobre el
			    área segura; el error de guardado va dentro, junto a los botones */}
			<div className="sticky bottom-0 z-20 -mx-4 mt-4 space-y-2 border-t border-line bg-canvas px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:pl-[22rem]">
				<Problems lines={api.errorLines(save.error, EXPLAIN)} />
				{discarding ? (
					<div className="flex flex-wrap items-center gap-2">
						<p className="mr-auto text-sm text-fg">¿Descartar los cambios de «{saved ?? 'la plantilla nueva'}»?</p>
						<button
							type="button"
							className="btn btn-danger"
							onClick={() => {
								draft.reset()
								setDiscarding(false)
								title.current?.focus()
							}}
						>
							Descartar
						</button>
						<button type="button" className="btn btn-secondary" autoFocus onClick={() => setDiscarding(false)}>
							Seguir editando
						</button>
					</div>
				) : (
					<div className="flex flex-wrap items-center gap-2">
						{draft.dirty && (
							<button type="button" className="btn btn-ghost -ml-3" onClick={() => setDiscarding(true)}>
								Descartar
							</button>
						)}
						<div className="mr-auto">
							<Status
								m={save.isIdle && created ? { isSuccess: true, submittedAt: 0 } : save}
								text={`Guardada como v${save.variables?.t.version ?? created}.`}
							/>
						</div>
						<div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
							<button
								type="button"
								className="btn btn-secondary"
								onClick={() => saveDraft(false)}
								disabled={!next || save.isPending}
							>
								Guardar
							</button>
							<button
								type="button"
								className="btn btn-primary"
								onClick={() => saveDraft(true)}
								disabled={!next || save.isPending}
							>
								Guardar y activar
							</button>
						</div>
					</div>
				)}
			</div>
		</section>
	)
}

// Fotograma de la animación según el tiempo desde que empezó a reproducirse; sin animación, el 0
function useFrame(animation: DisplayTemplate['animation']) {
	const [frame, setFrame] = useState(0)
	useEffect(() => {
		if (!animation) return
		const start = performance.now()
		const timer = setInterval(() => setFrame(currentFrame(animation, performance.now() - start)), 50)
		return () => {
			clearInterval(timer)
			setFrame(0)
		}
	}, [animation])
	return animation ? frame : 0
}

// Archivo de imagen → canvas al tamaño elegido → RGB565 (la codificación más corta) → elemento image al final del borrador
function ImportImage({ text, setText }: { text: string; setText: (t: string) => void }) {
	const [size, setSize] = useState({ w: '', h: '' })
	const [error, setError] = useState<string | null>(null)
	const file = useRef<HTMLInputElement>(null)

	async function importFile(f: File) {
		setError(null)
		let t: { rotation?: number; elements?: unknown[] }
		try {
			t = JSON.parse(text)
			if (typeof t !== 'object' || t === null || Array.isArray(t)) throw new Error()
		} catch {
			return setError('El borrador no es una plantilla JSON válida: corrígelo antes de importar la imagen.')
		}
		const canvas = displaySize(t.rotation)
		// vacío = el lienzo entero según la rotación del borrador
		const dim = (v: string, max: number) => Math.min(Math.max(Math.round(Number(v)) || max, 1), max)
		const w = dim(size.w, canvas.width)
		const h = dim(size.h, canvas.height)
		try {
			const bitmap = await createImageBitmap(f)
			const c = document.createElement('canvas')
			c.width = w
			c.height = h
			const ctx = c.getContext('2d')
			if (!ctx) throw new Error('sin canvas 2d')
			ctx.drawImage(bitmap, 0, 0, w, h)
			const image = encodeImage(ctx.getImageData(0, 0, w, h).data, w, h)
			setText(fmt({ ...t, elements: [...(t.elements ?? []), { type: 'image', x: 0, y: 0, w, h, ...image }] }))
		} catch (e) {
			setError(`No se pudo leer la imagen: ${(e as Error).message}`)
		} finally {
			if (file.current) file.current.value = '' // permite volver a importar el mismo archivo
		}
	}

	return (
		<details>
			<summary>Importar imagen</summary>
			<div className="space-y-3 pb-3">
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-[7rem_7rem_minmax(0,1fr)]">
					<label className="field">
						Ancho (px)
						<input
							type="number"
							min={1}
							max={320}
							value={size.w}
							placeholder="lienzo"
							onChange={(e) => setSize({ ...size, w: e.target.value })}
						/>
					</label>
					<label className="field">
						Alto (px)
						<input
							type="number"
							min={1}
							max={320}
							value={size.h}
							placeholder="lienzo"
							onChange={(e) => setSize({ ...size, h: e.target.value })}
						/>
					</label>
					<label className="field col-span-2 sm:col-span-1">
						Archivo
						<input
							ref={file}
							type="file"
							accept="image/*"
							aria-describedby="import-hint"
							onChange={(e) => {
								const f = e.target.files?.[0]
								if (f) void importFile(f)
							}}
						/>
					</label>
				</div>
				<small id="import-hint" className="block">
					Se escala al tamaño elegido (vacío = el lienzo entero), se pasa a RGB565 con la compresión más corta y se
					añade como elemento image en x 0, y 0. Muévelo editando el JSON.
				</small>
				<Problems lines={error ? [error] : []} />
			</div>
		</details>
	)
}
