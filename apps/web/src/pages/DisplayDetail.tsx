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
import { Problems } from '../components/Problems'
import { goalData, goalTemplate, showcaseTemplate, statusTemplate } from '../examples'
import { Online } from './Displays'

const fmt = (v: unknown) => JSON.stringify(v, null, 2)

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
	if (display.isPending) return <p>Cargando…</p>
	return (
		<Problems
			lines={
				display.error instanceof api.HttpError && display.error.status === 404
					? ['Esta pantalla no existe.']
					: api.errorLines(display.error)
			}
		/>
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
			<p>
				<Link to="/displays">← Mis pantallas</Link>
			</p>
			<h1>{d.name}</h1>
			<Problems lines={api.errorLines(pollError)} />
			<div className="card row">
				<Online online={d.online} />
				<span className="grow muted">
					<code>{d.deviceId}</code> · plantilla activa {d.template.id} v{d.template.version}
				</span>
			</div>

			<section>
				<h2>Plantilla</h2>
				<div className="editor">
					<div>
						<DisplayPreview template={shown} values={d.values} showActions={showActions} frame={frame} />
						{!draft.data && <p className="muted">El borrador tiene errores: se muestra la plantilla activa.</p>}
						<label className="check">
							<input type="checkbox" checked={showActions} onChange={(e) => setShowActions(e.target.checked)} /> Mostrar
							zonas táctiles
						</label>
						{shown.animation && (
							<label className="check">
								<input type="checkbox" checked={playing} onChange={(e) => setPlaying(e.target.checked)} /> Reproducir
								animación
							</label>
						)}
					</div>
					<div className="stack">
						<div className="row">
							<label className="grow">
								Plantillas guardadas
								<select ref={pick} key={d.activeTemplateId} defaultValue={d.activeTemplateId}>
									{d.templates.map((t) => (
										<option key={t.id} value={t.id}>
											{`${t.id} v${t.version}${t.id === d.activeTemplateId ? ' (activa)' : ''}`}
										</option>
									))}
								</select>
							</label>
							<button
								type="button"
								onClick={() => activate.mutate(pick.current?.value ?? '')}
								disabled={activate.isPending}
							>
								Activar
							</button>
							<button type="button" onClick={edit} disabled={!templates.data}>
								Abrir en el editor
							</button>
						</div>
						<Problems lines={[...api.errorLines(activate.error, EXPLAIN), ...api.errorLines(templates.error)]} />
						<div className="row">
							<button type="button" onClick={() => setText(fmt(goalTemplate))}>
								Cargar ejemplo
							</button>
							<button type="button" onClick={() => setText(fmt(statusTemplate))}>
								Cargar ejemplo de estado
							</button>
							<button type="button" onClick={() => setText(fmt(showcaseTemplate))}>
								Cargar ejemplo avanzado
							</button>
						</div>
						<ImportImage text={text} setText={setText} />
						<label>
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
						<Problems lines={draft.errors} />
						<div className="row">
							<button type="button" onClick={bump} disabled={!draft.data}>
								version +1
							</button>
							<button type="button" onClick={() => saveDraft(true)} disabled={!draft.data || save.isPending}>
								Guardar y activar
							</button>
							<button type="button" onClick={() => saveDraft(false)} disabled={!draft.data || save.isPending}>
								Guardar sin activar
							</button>
							<span role="status">{save.isSuccess && 'Guardado.'}</span>
						</div>
						<Problems lines={api.errorLines(save.error, EXPLAIN)} />
					</div>
				</div>
			</section>

			<ParamsForm key={`${d.template.id}@${d.template.version}`} id={id} template={d.template} values={d.values} />
			<DataEditor id={id} values={d.values} />
			<Commands id={id} />
			<Events id={id} />
			<DeleteDisplay id={id} name={d.name} />
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
		<fieldset className="stack">
			<legend>Importar imagen</legend>
			<div className="row">
				<label>
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
				<label>
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
				<label className="grow">
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
			<small id="import-hint">
				Se escala al tamaño elegido (vacío = el lienzo entero), se pasa a RGB565 con la compresión más corta y se añade
				como elemento image en x 0, y 0. Muévelo editando el JSON.
			</small>
			<Problems lines={error ? [error] : []} />
		</fieldset>
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
		<section>
			<h2>Parámetros</h2>
			<form
				className="stack"
				onSubmit={(e) => {
					e.preventDefault()
					if (dirty && !issues.length) send.mutate(changed)
				}}
			>
				<p className="muted">
					Los declara la plantilla activa ({template.id} v{template.version}) en <code>params</code>. Sin valor
					guardado, se muestra su valor por defecto.
				</p>
				{params.map(([k, p]) => {
					const name = p.description ? `${k}: ${p.description}` : k
					if (p.type === 'boolean')
						return (
							<label key={k} className="check">
								<input type="checkbox" checked={truthy(value(k))} onChange={(e) => set(k, e.target.checked)} /> {name}
							</label>
						)
					return (
						<label key={k}>
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
				<Problems lines={issues} />
				<div className="row">
					<button type="submit" disabled={!dirty || issues.length > 0 || send.isPending}>
						Enviar parámetros
					</button>
					<span role="status">{send.isSuccess && 'Enviado.'}</span>
				</div>
				<Problems lines={api.errorLines(send.error, EXPLAIN)} />
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
		<section>
			<h2>Datos</h2>
			<div className="stack">
				<label>
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
				<Problems lines={draft.errors} />
				<div className="row">
					<button type="button" onClick={() => setText(fmt(goalData))}>
						Cargar datos de ejemplo
					</button>
					<button type="button" onClick={() => send(false)} disabled={!draft.data || save.isPending}>
						Reemplazar
					</button>
					<button type="button" onClick={() => send(true)} disabled={!draft.data || save.isPending}>
						Combinar
					</button>
					<span role="status">{save.isSuccess && 'Guardado.'}</span>
				</div>
				<Problems lines={api.errorLines(save.error, EXPLAIN)} />
			</div>
		</section>
	)
}

function Commands({ id }: { id: string }) {
	const [percent, setPercent] = useState(25)
	const send = useMutation({ mutationFn: (c: DisplayCommand) => api.sendDisplayCommand(id, c) })

	return (
		<section>
			<h2>Comandos</h2>
			<div className="stack">
				<div className="row">
					<button type="button" onClick={() => send.mutate({ type: 'display.refresh' })} disabled={send.isPending}>
						Refrescar pantalla
					</button>
				</div>
				<div className="row">
					<label className="grow">
						Brillo (0 a 50)
						<input type="range" min={0} max={50} value={percent} onChange={(e) => setPercent(Number(e.target.value))} />
					</label>
					<output>{percent}</output>
					<button
						type="button"
						onClick={() => send.mutate({ type: 'display.brightness', percent })}
						disabled={send.isPending}
					>
						Enviar
					</button>
				</div>
				<span role="status">{send.isSuccess && 'Enviado.'}</span>
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
		<section>
			<h2>Eventos táctiles</h2>
			<Problems lines={api.errorLines(events.error)} />
			{events.data?.length === 0 && <p className="muted">Sin toques todavía.</p>}
			{!!events.data?.length && (
				<div className="table-wrap">
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
									<td>
										<time dateTime={ev.ts}>{new Date(ev.ts).toLocaleString()}</time>
									</td>
									<td>{ev.actionId}</td>
									<td>{ev.name ?? '—'}</td>
									<td>{origin(ev)}</td>
									<td>{ev.status}</td>
									<td>{ev.toast ?? '—'}</td>
									<td>
										{ev.x},{ev.y}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
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
		<section>
			<h2>Borrar</h2>
			{confirming ? (
				<div className="card confirm">
					<p>
						¿Borrar «{name}»? Sus tokens dejan de funcionar al momento y la pantalla se desconecta. No se puede
						deshacer.
					</p>
					<div className="row">
						<button type="button" className="danger" onClick={() => del.mutate()} disabled={del.isPending}>
							Sí, borrar
						</button>
						<button type="button" autoFocus onClick={() => setConfirming(false)}>
							Cancelar
						</button>
					</div>
				</div>
			) : (
				<button type="button" className="danger" onClick={() => setConfirming(true)}>
					Borrar pantalla
				</button>
			)}
			<Problems lines={api.errorLines(del.error)} />
		</section>
	)
}
