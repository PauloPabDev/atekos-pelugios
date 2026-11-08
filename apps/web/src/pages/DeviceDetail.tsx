import { useState, type FormEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { PatchDataInput, type Device, type PatchDeviceInput } from '@atekos/shared'
import * as api from '../api'
import { putDevice, useDeviceSocket } from '../hooks/useDeviceSocket'

const onOff = (s: boolean) => (s ? 'encendido' : 'apagado')

export function DeviceDetail() {
	const { id = '' } = useParams()
	const qc = useQueryClient()
	const navigate = useNavigate()
	const [confirming, setConfirming] = useState(false)
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

	if (device.isPending) return <p>Cargando…</p>
	if (device.error)
		return (
			<p role="alert" className="error">
				{device.error.message}
			</p>
		)
	const d = device.data

	return (
		<>
			<p>
				<Link to="/">← Mis dispositivos</Link>
			</p>
			<h1>{d.name}</h1>
			<div className="card row">
				<span className={`state ${d.state ? 'on' : 'off'}`}>{d.state ? 'Encendido' : 'Apagado'}</span>
				<span className="grow muted">
					{d.type} · {d.slug}
				</span>
				<button type="button" onClick={() => toggle.mutate()} disabled={toggle.isPending}>
					{d.state ? 'Apagar' : 'Encender'}
				</button>
			</div>
			{toggle.error && (
				<p role="alert" className="error">
					{toggle.error.message}
				</p>
			)}
			<p className="muted">
				Id: <code>{d.id}</code>
				{d.visibility === 'public' && (
					<>
						{' · '}
						<Link to={`/p/${d.id}`}>Vista pública</Link>
					</>
				)}
			</p>

			<section>
				<h2>Datos generales</h2>
				<form
					key={d.id}
					className="stack"
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
						<button disabled={patch.isPending}>Guardar</button>
						<span role="status">{patch.isSuccess && 'Guardado.'}</span>
					</div>
				</form>
			</section>

			<DataForm key={d.id} device={d} />

			<section>
				<h2>Historial</h2>
				{events.error && (
					<p role="alert" className="error">
						{events.error.message}
					</p>
				)}
				{events.data?.length === 0 && <p className="muted">Sin eventos todavía.</p>}
				<ol className="events">
					{events.data?.map((ev, i) => (
						<li key={`${ev.ts}-${i}`}>
							<time dateTime={ev.ts}>{new Date(ev.ts).toLocaleString()}</time> {ev.type}
							{ev.before && ev.after && ev.before.state !== ev.after.state
								? ` (${onOff(ev.before.state)} → ${onOff(ev.after.state)})`
								: ''}
							<span className="muted">
								{' '}
								· {ev.actor.kind} · {ev.source}
							</span>
						</li>
					))}
				</ol>
			</section>

			<section>
				<h2>Borrar</h2>
				{confirming ? (
					<div className="card confirm">
						<p>¿Borrar «{d.name}»? También se borran sus tokens ligados. No se puede deshacer.</p>
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
						Borrar dispositivo
					</button>
				)}
				{del.error && (
					<p role="alert" className="error">
						{del.error.message}
					</p>
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
		<section>
			<h2>Data</h2>
			<form className="stack" onSubmit={onSubmit}>
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
					<button disabled={save.isPending}>Guardar data</button>
					<span role="status">{save.isSuccess && 'Guardado.'}</span>
				</div>
			</form>
		</section>
	)
}
