import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import {
	checkParams,
	currentFrame,
	DISPLAY_MAX_TEMPLATE_BYTES,
	displaySize,
	DisplayTemplate,
	DisplayValues,
	encodeImage,
	truthy,
	withDefaults,
} from '@atekos/shared'
import type { DisplayCommand, DisplayDetail as Detail, DisplayEvent } from '@atekos/shared'
import * as api from '../api'
import { DisplayPreview } from '../components/DisplayPreview'
import { Icon } from '../components/Icon'
import { Problems } from '../components/Problems'
import { Status } from '../components/Status'
import { IconTile, Loading, PageHeader } from '../components/ui'
import { goalData, goalTemplate, showcaseTemplate, statusTemplate } from '../examples'
import { Online } from './Displays'

const fmt = (v: unknown) => JSON.stringify(v, null, 2)
// Las anclas de la subnav no quedan bajo la cabecera fija de 56px del móvil
const SECTION = 'scroll-mt-20 lg:scroll-mt-8'
// Tarjeta con cabecera y pie (Parámetros, Datos)
const CARD_HEAD = 'border-b border-line px-4 py-3 sm:px-5'
const CARD_FOOT =
	'flex flex-wrap items-center justify-end gap-2 rounded-b-lg border-t border-line bg-canvas px-4 py-3 sm:px-5'

// Errores de /displays (DISENO §3) que el usuario puede entender y corregir desde aquí
const EXPLAIN: Record<string, string> = {
	version_not_incremented: 'Ya hay una plantilla con ese id y una versión igual o mayor: súbela con «version +1».',
	message_too_large: `La plantilla o los datos superan el tope de la API (DISPLAY_MAX_TEMPLATE_BYTES, ${DISPLAY_MAX_TEMPLATE_BYTES / 1_048_576} MB por defecto): reduce o comprime las imágenes, o quita elementos.`,
	invalid_template: 'La API rechazó la plantilla:',
	invalid_data: 'La API rechazó los datos:',
	device_offline: 'La pantalla no está conectada: el comando no se envió.',
	command_not_allowed: 'Ese comando no está permitido.',
}

type Issue = { path: readonly PropertyKey[]; message: string }

// Texto de un editor → valor validado con el esquema, o las líneas de error (JSON roto o issues de zod)
function validate<T>(schema: { safeParse(v: unknown): { data?: T; error?: { issues: Issue[] } } }, text: string) {
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch (e) {
		return { errors: [`No es JSON válido: ${(e as Error).message}`] }
	}
	const r = schema.safeParse(value)
	return r.error ? { errors: api.issueLines(r.error.issues) } : { data: r.data, errors: [] }
}

export function DisplayDetail() {
	const { deviceId = '' } = useParams()
	const display = useQuery({
		queryKey: ['display', deviceId],
		queryFn: () => api.getDisplay(deviceId),
		refetchInterval: 3000,
	})

	// Con datos ya cargados, un fallo del polling no desmonta el panel (perdería los borradores)
	if (display.data) return <Panel key={deviceId} id={deviceId} d={display.data} pollError={display.error} />
	if (display.isPending) return <Loading />
	return (
		<>
			<BackLink />
			<Problems
				lines={
					display.error instanceof api.HttpError && display.error.status === 404
						? ['Esta pantalla no existe.']
						: api.errorLines(display.error)
				}
			/>
		</>
	)
}

function BackLink() {
	return (
		<Link
			to="/displays"
			className="-ml-1 mb-2 inline-flex h-11 items-center gap-1 rounded-md px-1 text-sm font-medium text-fg-muted hover:text-fg sm:h-8"
		>
			<Icon name="back" size={16} />
			Mis pantallas
		</Link>
	)
}

function Panel({ id, d, pollError }: { id: string; d: Detail; pollError: Error | null }) {
	const qc = useQueryClient()
	const templates = useQuery({ queryKey: ['display-templates', id], queryFn: () => api.listDisplayTemplates(id) })
	const refresh = () =>
		Promise.all([
			qc.invalidateQueries({ queryKey: ['display', id] }),
			qc.invalidateQueries({ queryKey: ['display-templates', id] }),
		])
	const activate = useMutation({
		mutationFn: (templateId: string) => api.patchDisplay(id, { activeTemplateId: templateId }),
		onSuccess: refresh,
	})
	const save = useMutation({
		mutationFn: ({ t, active }: { t: DisplayTemplate; active: boolean }) =>
			active ? api.putActiveTemplate(id, t) : api.putDisplayTemplate(id, t),
		onSuccess: refresh,
	})
	// Textarea controlado: el polling no pisa el borrador
	const [text, setText] = useState(() => fmt(d.template))
	const [showActions, setShowActions] = useState(false)
	const [playing, setPlaying] = useState(false)
	const pick = useRef<HTMLSelectElement>(null)
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
	const edit = () => {
		const t = templates.data?.find((t) => t.id === pick.current?.value)
		if (t) setText(fmt(t))
	}

	return (
		<>
			<PageHeader
				back={<BackLink />}
				title={<span className="wrap-anywhere">{d.name}</span>}
				description={
					<div className="mt-2 flex flex-wrap items-center gap-2">
						<Online online={d.online} />
						<span className="mono">{d.deviceId}</span>
						<span className="wrap-anywhere">
							plantilla activa {d.template.id} v{d.template.version}
						</span>
					</div>
				}
			/>
			<nav aria-label="Secciones" className="subnav">
				<a href="#plantilla">Plantilla</a>
				{Object.keys(d.template.params ?? {}).length > 0 && <a href="#parametros">Parámetros</a>}
				<a href="#datos">Datos</a>
				<a href="#comandos">Comandos</a>
				<a href="#eventos">Eventos</a>
				<a href="#borrar">Borrar</a>
			</nav>

			<div className="mt-6 space-y-10">
				<Problems lines={api.errorLines(pollError)} />
				<section id="plantilla" className={SECTION}>
					<h2 className="mb-3">Plantilla</h2>
					<div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-8">
						{/* En el móvil la columna se disuelve: la vista previa queda fija durante todo el editor */}
						<div className="max-lg:contents lg:sticky lg:top-8 lg:space-y-2">
							<div className="sticky top-14 z-20 -mx-4 border-b border-line bg-canvas px-4 py-2 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
								{/* Ancho y alto auto: manda el tamaño ×2 del SVG, recortado por los máximos sin deformarse;
								    en el móvil, más de 24svh deja el JSON en pocas líneas entre la cabecera, el pie y las pestañas */}
								<div className="mx-auto w-fit max-w-full rounded-xl bg-zinc-900 p-2 [&_svg]:h-auto [&_svg]:max-h-[24svh] [&_svg]:w-auto [&_svg]:max-w-full lg:[&_svg]:max-h-[calc(100svh-14rem)]">
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
							<div className="space-y-2">
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
										<button type="button" className="btn btn-secondary" onClick={edit} disabled={!templates.data}>
											Abrir en el editor
										</button>
									</div>
								</div>
								<Problems lines={[...api.errorLines(activate.error, EXPLAIN), ...api.errorLines(templates.error)]} />
							</div>
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
							{/* Con pestañas abajo, guardar queda siempre a mano justo encima de ellas (miden 3.5rem + 1px de borde);
							    el error de guardado va dentro, junto a los botones */}
							<div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-20 -mx-4 space-y-2 border-t border-line bg-canvas px-4 py-2 sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
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

				<ParamsForm key={`${d.template.id}@${d.template.version}`} id={id} template={d.template} values={d.values} />
				<DataEditor id={id} values={d.values} />
				<Commands id={id} />
				<Events id={id} />
				<DeleteDisplay id={id} name={d.name} />
			</div>
		</>
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

// Formulario de los params de la plantilla activa: envía un PATCH /data solo con las claves cambiadas
function ParamsForm({ id, template, values }: { id: string; template: DisplayTemplate; values: DisplayValues }) {
	const qc = useQueryClient()
	const [changed, setChanged] = useState<DisplayValues>({})
	const send = useMutation({
		mutationFn: (v: DisplayValues) => api.patchDisplayData(id, v),
		onSuccess: () => {
			setChanged({})
			return qc.invalidateQueries({ queryKey: ['display', id] })
		},
	})
	const params = Object.entries(template.params ?? {})
	if (!params.length) return null

	const current = withDefaults(template, values)
	const value = (k: string) => (Object.hasOwn(changed, k) ? changed[k] : current[k])
	const set = (k: string, v: DisplayValues[string]) => setChanged({ ...changed, [k]: v })
	const issues = checkParams(template.params, changed).map((i) => i.message)
	const dirty = Object.keys(changed).length > 0

	return (
		<section id="parametros" className={SECTION}>
			<form
				className="card"
				onSubmit={(e) => {
					e.preventDefault()
					if (dirty && !issues.length) send.mutate(changed)
				}}
			>
				<div className={CARD_HEAD}>
					<h2>Parámetros</h2>
					<p className="mt-1 text-sm text-fg-muted">
						Los declara la plantilla activa ({template.id} v{template.version}) en <code>params</code>. Sin valor
						guardado, se muestra su valor por defecto.
					</p>
				</div>
				<div className="space-y-4 p-4 sm:p-5">
					<div className="grid gap-4 sm:grid-cols-2">
						{params.map(([k, p]) => {
							const name = p.description ? `${k}: ${p.description}` : k
							if (p.type === 'boolean')
								return (
									<label key={k} className="check self-end">
										<input type="checkbox" checked={truthy(value(k))} onChange={(e) => set(k, e.target.checked)} />
										{name}
									</label>
								)
							return (
								<label key={k} className="field">
									{name}
									{p.type === 'number' ? (
										<input
											type="number"
											step="any"
											min={p.min}
											max={p.max}
											value={String(value(k) ?? '')}
											onChange={(e) => set(k, e.target.value === '' ? null : Number(e.target.value))}
										/>
									) : (
										<input
											type="text"
											maxLength={140}
											value={String(value(k) ?? '')}
											onChange={(e) => set(k, e.target.value)}
										/>
									)}
								</label>
							)
						})}
					</div>
					<Problems lines={issues} />
					<Problems lines={api.errorLines(send.error, EXPLAIN)} />
				</div>
				<div className={CARD_FOOT}>
					<Status m={send} text="Enviado." />
					<button type="submit" className="btn btn-primary" disabled={!dirty || issues.length > 0 || send.isPending}>
						Enviar parámetros
					</button>
				</div>
			</form>
		</section>
	)
}

const origin = (ev: DisplayEvent) =>
	ev.source === 'button'
		? `botón ${ev.button ?? '?'} ${ev.press === 'long' ? 'larga' : 'corta'}`
		: ev.source === 'touch'
			? 'toque'
			: '—'

// Resultado de ui.result en español; un estado nuevo de la API se ve tal cual
const STATUS: Record<string, [label: string, badge: string]> = {
	ok: ['Aceptado', 'badge-success'],
	rejected: ['Rechazado', 'badge-warning'],
	error: ['Error', 'badge-danger'],
}

function DataEditor({ id, values }: { id: string; values: DisplayValues }) {
	const qc = useQueryClient()
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
		<section id="datos" className={SECTION}>
			<div className="card">
				<div className={`${CARD_HEAD} flex items-center justify-between gap-3`}>
					<h2>Datos</h2>
					<button type="button" className="btn btn-ghost -my-1.5 -mr-2" onClick={() => setText(fmt(goalData))}>
						Cargar datos de ejemplo
					</button>
				</div>
				<div className="space-y-3 p-4 sm:p-5">
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

function Commands({ id }: { id: string }) {
	const [percent, setPercent] = useState(25)
	const send = useMutation({ mutationFn: (c: DisplayCommand) => api.sendDisplayCommand(id, c) })

	return (
		<section id="comandos" className={SECTION}>
			<h2>Comandos</h2>
			<div className="mt-3 grid gap-4 sm:grid-cols-2">
				<div className="card flex flex-col p-4 sm:p-5">
					<div className="flex items-center gap-3">
						<IconTile name="refresh" />
						<h3>Refrescar</h3>
					</div>
					<p className="mt-3 mb-4 text-sm text-fg-muted">Fuerza un redibujado completo de la pantalla.</p>
					<button
						type="button"
						className="btn btn-secondary mt-auto self-start"
						onClick={() => send.mutate({ type: 'display.refresh' })}
						disabled={send.isPending}
					>
						Refrescar pantalla
					</button>
				</div>
				<div className="card flex flex-col p-4 sm:p-5">
					<div className="flex items-center gap-3">
						<IconTile name="sun" />
						<h3>Brillo</h3>
					</div>
					<div className="mt-3 mb-4 flex items-end gap-3">
						<label className="field flex-1">
							Brillo (0 a 50)
							<input
								type="range"
								min={0}
								max={50}
								value={percent}
								onChange={(e) => setPercent(Number(e.target.value))}
							/>
						</label>
						{/* Centrado con el slider, que mide 44px en el móvil y 36px desde sm */}
						<output className="mono mb-2.5 w-9 text-center sm:mb-1.5">{percent}</output>
					</div>
					<button
						type="button"
						className="btn btn-secondary mt-auto self-start"
						onClick={() => send.mutate({ type: 'display.brightness', percent })}
						disabled={send.isPending}
					>
						Enviar
					</button>
				</div>
			</div>
			{/* Un solo envío para los dos comandos: el aviso y el error van debajo de ambos (sin ellos, alto 0) */}
			<div className="mt-3 flex flex-col items-start gap-2">
				<Status m={send} text="Enviado." />
				<Problems lines={api.errorLines(send.error, EXPLAIN)} />
			</div>
		</section>
	)
}

function Events({ id }: { id: string }) {
	const events = useQuery({
		queryKey: ['display-events', id],
		queryFn: () => api.listDisplayEvents(id),
		refetchInterval: 3000,
	})

	return (
		<section id="eventos" className={SECTION}>
			<h2>Eventos</h2>
			<div className="mt-3 space-y-3">
				{events.isPending && <Loading />}
				<Problems lines={api.errorLines(events.error)} />
				{events.data?.length === 0 && (
					<p className="card px-4 py-6 text-center text-sm text-fg-muted">
						Todavía no hay eventos: aparecen al tocar la pantalla o pulsar sus botones.
					</p>
				)}
				{!!events.data?.length && (
					<div className="card overflow-x-auto">
						{/* La API ya los devuelve del más reciente al más antiguo */}
						<table>
							<thead>
								<tr>
									<th scope="col">Hora</th>
									<th scope="col">Acción</th>
									<th scope="col">Evento</th>
									<th scope="col">Origen</th>
									<th scope="col">Estado</th>
									<th scope="col">Toast</th>
									<th scope="col">x,y</th>
								</tr>
							</thead>
							<tbody>
								{events.data.map((ev, i) => (
									<tr key={`${ev.eventId}-${i}`}>
										<td className="whitespace-nowrap text-fg-muted">
											<time dateTime={ev.ts}>{new Date(ev.ts).toLocaleString()}</time>
										</td>
										<td className="font-mono text-xs whitespace-nowrap">{ev.actionId}</td>
										<td>{ev.name ?? '—'}</td>
										<td className="whitespace-nowrap">{origin(ev)}</td>
										<td>
											<span className={`badge ${STATUS[ev.status]?.[1] ?? ''}`}>
												{STATUS[ev.status]?.[0] ?? ev.status}
											</span>
										</td>
										<td>{ev.toast ?? '—'}</td>
										<td className="font-mono text-xs whitespace-nowrap">
											{ev.x},{ev.y}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</section>
	)
}

function DeleteDisplay({ id, name }: { id: string; name: string }) {
	const qc = useQueryClient()
	const navigate = useNavigate()
	const [confirming, setConfirming] = useState(false)
	const del = useMutation({
		mutationFn: () => api.deleteDisplay(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['displays'] })
			navigate('/displays')
		},
	})

	return (
		<section id="borrar" className={SECTION}>
			<div className="card border-red-200 p-4 sm:p-5">
				<h2>Borrar</h2>
				{confirming ? (
					<>
						<p className="mt-1 text-sm text-fg-muted">
							¿Borrar «{name}»? Sus tokens dejan de funcionar al momento y la pantalla se desconecta. No se puede
							deshacer.
						</p>
						<div className="mt-4 flex flex-wrap gap-2">
							<button type="button" className="btn btn-danger" onClick={() => del.mutate()} disabled={del.isPending}>
								Sí, borrar
							</button>
							<button type="button" className="btn btn-secondary" autoFocus onClick={() => setConfirming(false)}>
								Cancelar
							</button>
						</div>
						<div className="mt-3">
							<Problems lines={api.errorLines(del.error)} />
						</div>
					</>
				) : (
					<>
						<p className="mt-1 text-sm text-fg-muted">
							Quita la pantalla de tu cuenta con sus plantillas y datos. Sus tokens dejan de funcionar.
						</p>
						<button type="button" className="btn btn-danger-outline mt-4" onClick={() => setConfirming(true)}>
							<Icon name="trash" size={16} />
							Borrar pantalla
						</button>
					</>
				)}
			</div>
		</section>
	)
}
