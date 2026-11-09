import { useState, type FormEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { PatchDataInput, type Device, type PatchDeviceInput } from '@atekos/shared'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { Status } from '../components/Status'
import { IconTile, Loading, Switch } from '../components/ui'
import { putDevice, useDeviceSocket } from '../hooks/useDeviceSocket'
import { ACTOR, ago, DEVICE_ICON, DEVICE_TYPE, EVENT, fullDate, label, SOURCE } from '../labels'

const onOff = (s: boolean) => (s ? 'encendido' : 'apagado')
// La cabecera móvil es fija (56px): el ancla no debe quedar debajo
const SECTION = 'mt-8 scroll-mt-20 lg:scroll-mt-6'
const CARD_FOOT = 'flex flex-wrap items-center justify-end gap-3 border-t border-line px-4 py-3 sm:px-5'

export function DeviceDetail() {
	const { id = '' } = useParams()
	const qc = useQueryClient()
	const navigate = useNavigate()
	const [confirming, setConfirming] = useState(false)
	const [copyMsg, setCopyMsg] = useState('')
	const device = useQuery({ queryKey: ['device', id], queryFn: () => api.getDevice(id) })
	useDeviceSocket(device.data ? [id] : [])
	// La clave incluye updatedAt: cada cambio (propio o por WS) recarga el historial solo
	const events = useQuery({
		queryKey: ['events', id, device.data?.updatedAt],
		queryFn: () => api.listEvents(id),
		enabled: !!device.data,
		placeholderData: keepPreviousData,
	})
	const toggle = useMutation({ mutationFn: () => api.toggleDevice(id), onSuccess: (d) => putDevice(qc, d) })
	const patch = useMutation({
		mutationFn: (input: PatchDeviceInput) => api.patchDevice(id, input),
		onSuccess: (d) => putDevice(qc, d),
	})
	const del = useMutation({
		mutationFn: () => api.deleteDevice(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['devices'] })
			navigate('/')
		},
	})

	const copyLink = async () => {
		const url = new URL(`/p/${id}`, location.origin).href
		try {
			await navigator.clipboard.writeText(url)
			setCopyMsg('Enlace copiado.')
		} catch {
			// navigator.clipboard no existe fuera de HTTPS/localhost (p. ej. el celular por IP de la LAN)
			setCopyMsg(`No se pudo copiar; cópialo a mano: ${url}`)
		}
	}

	const back = (
		<Link
			to="/"
			className="-ml-1 mb-2 inline-flex h-11 items-center gap-1 rounded-md px-1 text-sm text-fg-muted hover:text-fg sm:h-8"
		>
			<Icon name="back" size={16} />
			Mis dispositivos
		</Link>
	)

	if (device.isPending) return <Loading />
	if (device.error)
		return (
			<>
				{back}
				<p role="alert" className="alert alert-error">
					{device.error.message}
				</p>
			</>
		)
	const d = device.data
	const stateText = d.state ? 'Encendido' : 'Apagado'

	return (
		<>
			{back}
			<div className="flex flex-wrap items-start gap-x-4 gap-y-3">
				<div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
					<IconTile name={DEVICE_ICON[d.type] ?? 'cube'} tone={d.state ? 'success' : 'neutral'} />
					<div className="min-w-0">
						<h1 className="break-words">{d.name}</h1>
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<span className={`badge ${d.state ? 'badge-success' : ''}`}>
								<span className={`dot ${d.state ? 'dot-on' : ''}`} />
								{stateText}
							</span>
							<span className="badge">{label(DEVICE_TYPE, d.type)}</span>
							<span className={`badge ${d.visibility === 'public' ? 'badge-brand' : ''}`}>
								{d.visibility === 'public' ? 'Público' : 'Privado'}
							</span>
						</div>
						<p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
							<span>
								Slug <span className="mono">{d.slug}</span>
							</span>
							<span>
								Id <span className="mono break-all">{d.id}</span>
							</span>
						</p>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<span className="text-sm font-medium text-fg-muted">{stateText}</span>
					<Switch checked={d.state} label={d.name} busy={toggle.isPending} onChange={() => toggle.mutate()} />
				</div>
			</div>
			{toggle.error && (
				<p role="alert" className="alert alert-error mt-3">
					{toggle.error.message}
				</p>
			)}
			{d.visibility === 'public' && (
				<div className="mt-4 flex flex-wrap items-center gap-2">
					<Link to={`/p/${d.id}`} className="btn btn-secondary">
						<Icon name="eye" size={16} />
						Vista pública
					</Link>
					<button type="button" className="btn btn-secondary" onClick={copyLink}>
						<Icon name="copy" size={16} />
						Copiar enlace
					</button>
					<span role="status" className="min-w-0 text-sm break-all text-fg-muted">
						{copyMsg}
					</span>
				</div>
			)}

			<nav aria-label="Secciones" className="subnav mt-6">
				<a href="#historial">Historial</a>
				<a href="#ajustes">Ajustes</a>
				<a href="#datos">Datos</a>
				<a href="#borrar">Borrar</a>
			</nav>

			<section id="historial" className={SECTION}>
				<h2>Historial</h2>
				{events.isPending && <Loading />}
				{events.error && (
					<p role="alert" className="alert alert-error mt-3">
						{events.error.message}
					</p>
				)}
				{events.data?.length === 0 && <p className="mt-1 text-sm text-fg-muted">Sin eventos todavía.</p>}
				{!!events.data?.length && (
					<ol className="mt-4 ml-1.5 border-l border-line">
						{events.data.map((ev, i) => (
							<li key={`${ev.ts}-${i}`} className="relative pb-5 pl-5 last:pb-0">
								<span className={`dot absolute top-1.5 -left-[4.5px] ${ev.after?.state ? 'dot-on' : ''}`} />
								<div className="flex items-baseline gap-3">
									<p className="min-w-0 flex-1 text-sm text-fg">
										<span className="font-medium">{label(EVENT, ev.type)}</span>
										{ev.before && ev.after && ev.before.state !== ev.after.state && (
											<span className="text-fg-muted">
												{' '}
												· {onOff(ev.before.state)} → {onOff(ev.after.state)}
											</span>
										)}
									</p>
									<time dateTime={ev.ts} title={fullDate(ev.ts)} className="shrink-0 text-xs text-fg-subtle">
										{ago(ev.ts)}
									</time>
								</div>
								<p className="text-sm text-fg-muted">
									{label(ACTOR, ev.actor.kind)} · {label(SOURCE, ev.source)}
								</p>
							</li>
						))}
					</ol>
				)}
			</section>

			<section id="ajustes" className={SECTION}>
				<form
					key={d.id}
					className="card"
					aria-labelledby="ajustes-title"
					onSubmit={(e) => {
						e.preventDefault()
						patch.mutate(Object.fromEntries(new FormData(e.currentTarget)) as PatchDeviceInput)
					}}
				>
					<div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
						<div className="sm:col-span-2">
							<h2 id="ajustes-title">Ajustes</h2>
							<p className="mt-1 text-sm text-fg-muted">Cómo se llama y quién puede verlo.</p>
						</div>
						<label className="field">
							Nombre
							<input name="name" required maxLength={80} defaultValue={d.name} />
						</label>
						<label className="field">
							Visibilidad
							<select name="visibility" defaultValue={d.visibility}>
								<option value="private">Privado</option>
								<option value="public">Público</option>
							</select>
						</label>
						<label className="field sm:col-span-2">
							Descripción
							<textarea name="description" maxLength={500} rows={2} defaultValue={d.description} />
						</label>
						{patch.error && (
							<p role="alert" className="alert alert-error sm:col-span-2">
								{patch.error.message}
							</p>
						)}
					</div>
					<div className={CARD_FOOT}>
						<Status m={patch} text="Guardado." />
						<button className="btn btn-primary" disabled={patch.isPending} aria-busy={patch.isPending}>
							Guardar
						</button>
					</div>
				</form>
			</section>

			<DataForm key={d.id} device={d} />

			<section id="borrar" className={SECTION}>
				<div className="card border-red-200 p-4 sm:p-5">
					<h2>Borrar</h2>
					{confirming ? (
						<>
							<p className="mt-1 text-sm text-fg">
								¿Borrar «{d.name}»? También se borran sus tokens ligados. No se puede deshacer.
							</p>
							<div className="mt-4 flex flex-wrap gap-2">
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
							{del.error && (
								<p role="alert" className="alert alert-error mt-3">
									{del.error.message}
								</p>
							)}
						</>
					) : (
						<div className="mt-1 flex flex-wrap items-center justify-between gap-3">
							<p className="text-sm text-fg-muted">Borra el dispositivo, su historial y sus tokens ligados.</p>
							<button type="button" className="btn btn-danger-outline" onClick={() => setConfirming(true)}>
								<Icon name="trash" size={16} />
								Borrar dispositivo
							</button>
						</div>
					)}
				</div>
			</section>
		</>
	)
}

// Textarea controlado: un device.updated por WS no pisa lo que estás escribiendo
function DataForm({ device }: { device: Device }) {
	const qc = useQueryClient()
	const [text, setText] = useState(() => JSON.stringify(device.data, null, 2))
	const [invalid, setInvalid] = useState('')
	const save = useMutation({
		mutationFn: (data: PatchDataInput) => api.patchData(device.id, data),
		onSuccess: (d) => {
			putDevice(qc, d)
			setText(JSON.stringify(d.data, null, 2))
		},
	})

	const onSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		let value: unknown
		try {
			value = JSON.parse(text)
		} catch {
			return setInvalid('No es JSON válido.')
		}
		const parsed = PatchDataInput.safeParse(value)
		if (!parsed.success) return setInvalid('Tiene que ser un objeto JSON, p. ej. {"brillo": 80}.')
		setInvalid('')
		save.mutate(parsed.data)
	}

	return (
		<section id="datos" className={SECTION}>
			<form className="card" aria-labelledby="datos-title" onSubmit={onSubmit}>
				<div className="space-y-4 p-4 sm:p-5">
					<div>
						<h2 id="datos-title">Datos</h2>
						<p className="mt-1 text-sm text-fg-muted">Valores libres del dispositivo, en JSON.</p>
					</div>
					<div className="space-y-1.5">
						<label className="field">
							data (JSON)
							<textarea
								value={text}
								onChange={(e) => setText(e.target.value)}
								rows={8}
								spellCheck={false}
								aria-invalid={!!invalid}
								aria-describedby="data-hint"
							/>
						</label>
						<small id="data-hint">Se mezcla con el data actual: las claves que no envíes se conservan.</small>
					</div>
					{(invalid || save.error) && (
						<p role="alert" className="alert alert-error">
							{invalid || save.error?.message}
						</p>
					)}
				</div>
				<div className={CARD_FOOT}>
					<Status m={save} text="Guardado." />
					<button className="btn btn-primary" disabled={save.isPending} aria-busy={save.isPending}>
						Guardar data
					</button>
				</div>
			</form>
		</section>
	)
}
