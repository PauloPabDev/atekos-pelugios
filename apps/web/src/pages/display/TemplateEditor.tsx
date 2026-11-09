import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { currentFrame, displaySize, DisplayTemplate, encodeImage } from '@atekos/shared'
import type { DisplayDetail } from '@atekos/shared'
import * as api from '../../api'
import { DisplayPreview } from '../../components/DisplayPreview'
import { Problems } from '../../components/Problems'
import { Status } from '../../components/Status'
import { EmptyState, Loading } from '../../components/ui'
import { goalTemplate, showcaseTemplate, statusTemplate } from '../../examples'
import { EXPLAIN, fmt, validate } from './common'
import { useDisplay } from './DisplayLayout'

const BLANK: DisplayTemplate = { id: 'nueva', version: 1, elements: [], actions: [] }

// plantillas/:templateId edita la guardada; plantillas/nueva parte de una vacía
export function TemplateEditor() {
	const { display: d } = useDisplay()
	const { templateId } = useParams()
	const templates = useQuery({
		queryKey: ['display-templates', d.deviceId],
		queryFn: () => api.listDisplayTemplates(d.deviceId),
		enabled: !!templateId,
	})

	if (!templateId) return <Editor d={d} initial={BLANK} />
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
	return <Editor key={t.id} d={d} initial={t} />
}

function Editor({ d, initial }: { d: DisplayDetail; initial: DisplayTemplate }) {
	const id = d.deviceId
	const qc = useQueryClient()
	const save = useMutation({
		mutationFn: ({ t, active }: { t: DisplayTemplate; active: boolean }) =>
			active ? api.putActiveTemplate(id, t) : api.putDisplayTemplate(id, t),
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: ['display', id] }),
				qc.invalidateQueries({ queryKey: ['display-templates', id] }),
			]),
	})
	// Textarea controlado: el polling no pisa el borrador
	const [text, setText] = useState(() => fmt(initial))
	const [showActions, setShowActions] = useState(false)
	const [playing, setPlaying] = useState(false)
	// Memo: el timer de la animación re-renderiza cada 50 ms y una plantilla puede pesar 1 MB
	const draft = useMemo(() => validate(DisplayTemplate, text), [text])
	const shown = draft.data ?? d.template
	const frame = useFrame(playing ? shown.animation : undefined)

	const saveDraft = (active: boolean) => {
		if (draft.data) save.mutate({ t: draft.data, active })
	}
	const bump = () => {
		if (draft.data) setText(fmt({ ...JSON.parse(text), version: draft.data.version + 1 }))
	}

	return (
		<section>
			<h2 className="mb-3">Plantilla</h2>
			<div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-8">
				{/* En el móvil la columna se disuelve: la vista previa queda fija durante todo el editor */}
				<div className="max-lg:contents lg:sticky lg:top-8 lg:space-y-2">
					<div className="sticky top-14 z-20 -mx-4 border-b border-line bg-canvas px-4 py-2 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
						{/* Ancho y alto auto: manda el tamaño ×2 del SVG, recortado por los máximos sin deformarse;
						    en el móvil, más de 24svh deja el JSON en pocas líneas entre la cabecera y el pie */}
						<div className="mx-auto w-fit max-w-full rounded-xl bg-zinc-900 p-2 [&_svg]:h-auto [&_svg]:max-h-[24svh] [&_svg]:w-auto [&_svg]:max-w-full lg:[&_svg]:max-h-[calc(100svh-22rem)]">
							<DisplayPreview template={shown} values={d.values} showActions={showActions} frame={frame} />
						</div>
						{!draft.data && (
							<p className="mt-1.5 text-center text-xs text-warning-fg">
								El borrador tiene errores: se muestra la plantilla activa.
							</p>
						)}
					</div>
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
				<div className="mt-3 space-y-4 lg:mt-0">
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
								aria-invalid={!draft.data}
								aria-describedby="template-hint"
							/>
						</label>
						<small id="template-hint">
							La pantalla cachea por id y versión: para guardar cambios en un id que ya existe, sube la versión.
						</small>
					</div>
					<Problems lines={draft.errors} />
					{/* En el móvil el editor va sin las pestañas de la app (App.tsx): guardar queda abajo del todo, sobre el
					    área segura; el error de guardado va dentro, junto a los botones */}
					<div className="sticky bottom-0 z-20 -mx-4 space-y-2 border-t border-line bg-canvas px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
						<Problems lines={api.errorLines(save.error, EXPLAIN)} />
						<div className="flex flex-wrap items-center gap-2">
							<button type="button" className="btn btn-ghost" onClick={bump} disabled={!draft.data}>
								version +1
							</button>
							<div className="mr-auto">
								<Status m={save} text="Guardado." />
							</div>
							<div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
								<button
									type="button"
									className="btn btn-secondary"
									onClick={() => saveDraft(false)}
									disabled={!draft.data || save.isPending}
								>
									Guardar sin activar
								</button>
								<button
									type="button"
									className="btn btn-primary"
									onClick={() => saveDraft(true)}
									disabled={!draft.data || save.isPending}
								>
									Guardar y activar
								</button>
							</div>
						</div>
					</div>
				</div>
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
