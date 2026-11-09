import { useState, type FormEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { PatchDataInput, type Device, type PatchDeviceInput } from '@atekos/shared'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { Status } from '../components/Status'
import { putDevice, useDeviceSocket } from '../hooks/useDeviceSocket'
import { ACTOR, ago, DEVICE_ICON, DEVICE_TYPE, EVENT, fullDate, label, SOURCE } from '../labels'
import '../styles/devices.css'

const onOff = (s: boolean) => (s ? 'encendido' : 'apagado')

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

	if (device.isPending) return <p className="loading">Cargando…</p>
	if (device.error)
		return (
			<p role="alert" className="error">
				{device.error.message}
			</p>
		)
	const d = device.data

	return (
		<>
			<Link to="/" className="back">
				<Icon name="back" />
				Mis dispositivos
			</Link>
			<div className="card device-hero">
				<div className="row">
					<span className={`tile ${d.state ? 'green' : 'off'}`}>
						<Icon name={DEVICE_ICON[d.type] ?? 'cube'} />
					</span>
					<h1 className="grow">{d.name}</h1>
					<button
						type="button"
						role="switch"
						aria-checked={d.state}
						aria-label={d.name}
						aria-busy={toggle.isPending}
						className="switch big"
						// sin disabled para que se vea el meneo de aria-busy; el if evita un doble toggle
						onClick={() => {
							if (!toggle.isPending) toggle.mutate()
						}}
					/>
				</div>
				<div className="chips">
					<span className={`state ${d.state ? 'on' : 'off'}`}>{d.state ? 'Encendido' : 'Apagado'}</span>
					<span className="chip">{label(DEVICE_TYPE, d.type)}</span>
					<span className="chip mono">{d.slug}</span>
				</div>
				{toggle.error && (
					<p role="alert" className="error">
						{toggle.error.message}
					</p>
				)}
				{d.visibility === 'public' && (
					<div className="row">
						<Link to={`/p/${d.id}`} className="button">
							<Icon name="eye" />
							Vista pública
						</Link>
						<button type="button" onClick={copyLink}>
							<Icon name="copy" />
							Copiar enlace
						</button>
						<span role="status">{copyMsg}</span>
					</div>
				)}
				<p className="muted">
					<small>
						Id: <code>{d.id}</code>
					</small>
				</p>
			</div>

			<nav aria-label="Secciones" className="sections">
				<a href="#historial">Historial</a>
				<a href="#ajustes">Ajustes</a>
				<a href="#datos">Datos</a>
				<a href="#borrar">Borrar</a>
			</nav>

			<section id="historial">
				<h2>Historial</h2>
				{events.isPending && <p className="loading">Cargando…</p>}
				{events.error && (
					<p role="alert" className="error">
						{events.error.message}
					</p>
				)}
				{events.data?.length === 0 && <p className="muted">Sin eventos todavía.</p>}
				<ol className="timeline">
					{events.data?.map((ev, i) => (
						<li key={`${ev.ts}-${i}`} className={ev.after?.state ? 'on' : 'off'}>
							<time dateTime={ev.ts} title={fullDate(ev.ts)}>
								{ago(ev.ts)}
							</time>
							<strong>{label(EVENT, ev.type)}</strong>
							{ev.before && ev.after && ev.before.state !== ev.after.state
								? ` (${onOff(ev.before.state)} → ${onOff(ev.after.state)})`
								: ''}
							<span className="muted">
								{' '}
								· {label(ACTOR, ev.actor.kind)} · {label(SOURCE, ev.source)}
							</span>
						</li>
					))}
				</ol>
			</section>

			<section id="ajustes">
				<h2>Datos generales</h2>
				<form
					key={d.id}
					className="card stack"
					onSubmit={(e) => {
						e.preventDefault()
						patch.mutate(Object.fromEntries(new FormData(e.currentTarget)) as PatchDeviceInput)
					}}
				>
					<label>
						Nombre
						<input name="name" required maxLength={80} defaultValue={d.name} />
					</label>
					<label>
						Descripción
						<textarea name="description" maxLength={500} rows={2} defaultValue={d.description} />
					</label>
					<label>
						Visibilidad
						<select name="visibility" defaultValue={d.visibility}>
							<option value="private">Privado</option>
							<option value="public">Público</option>
						</select>
					</label>
					{patch.error && (
						<p role="alert" className="error">
							{patch.error.message}
						</p>
					)}
					<div className="row">
						<button className="primary" disabled={patch.isPending}>
							Guardar
						</button>
						<Status m={patch} text="Guardado." />
					</div>
				</form>
			</section>

			<DataForm key={d.id} device={d} />

			<section id="borrar">
				<h2>Borrar</h2>
				{confirming ? (
					<div className="card confirm">
						<p>¿Borrar «{d.name}»? También se borran sus tokens ligados. No se puede deshacer.</p>
						<div className="row">
							<button type="button" className="danger-solid" onClick={() => del.mutate()} disabled={del.isPending}>
								Sí, borrar
							</button>
							<button type="button" autoFocus onClick={() => setConfirming(false)}>
								Cancelar
							</button>
						</div>
						{del.error && (
							<p role="alert" className="error">
								{del.error.message}
							</p>
						)}
					</div>
				) : (
					<div className="card danger-zone">
						<p className="muted">Borra el dispositivo, su historial y sus tokens ligados.</p>
						<button type="button" className="danger" onClick={() => setConfirming(true)}>
							<Icon name="trash" />
							Borrar dispositivo
						</button>
					</div>
				)}
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
		<section id="datos">
			<h2>Data</h2>
			<form className="card stack" onSubmit={onSubmit}>
				<label>
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
				{(invalid || save.error) && (
					<p role="alert" className="error">
						{invalid || save.error?.message}
					</p>
				)}
				<div className="row">
					<button className="primary" disabled={save.isPending}>
						Guardar data
					</button>
					<Status m={save} text="Guardado." />
				</div>
			</form>
		</section>
	)
}
