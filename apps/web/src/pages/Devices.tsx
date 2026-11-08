import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { DEVICE_TYPES, type CreateDeviceInput } from '@atekos/shared'
import * as api from '../api'
import { putDevice, useDeviceSocket } from '../hooks/useDeviceSocket'

export function Devices() {
	const qc = useQueryClient()
	const devices = useQuery({ queryKey: ['devices'], queryFn: api.listDevices })
	useDeviceSocket(devices.data?.map((d) => d.id) ?? [])
	const toggle = useMutation({ mutationFn: api.toggleDevice, onSuccess: (d) => putDevice(qc, d) })
	const create = useMutation({
		mutationFn: api.createDevice,
		onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
	})

	return (
		<>
			<h1>Mis dispositivos</h1>
			{devices.isPending && <p>Cargando…</p>}
			{devices.error && (
				<p role="alert" className="error">
					{devices.error.message}
				</p>
			)}
			{devices.data?.length === 0 && <p className="muted">Todavía no tienes dispositivos. Crea el primero abajo.</p>}
			{toggle.error && (
				<p role="alert" className="error">
					{toggle.error.message}
				</p>
			)}
			<ul className="cards">
				{devices.data?.map((d) => (
					<li key={d.id} className="card row">
						<div className="grow">
							<Link to={`/devices/${d.id}`}>
								<strong>{d.name}</strong>
							</Link>
							<div className="muted">
								{d.type} · {d.visibility === 'public' ? 'público' : 'privado'}
							</div>
						</div>
						<span className={`state ${d.state ? 'on' : 'off'}`}>{d.state ? 'Encendido' : 'Apagado'}</span>
						<button
							type="button"
							aria-label={`${d.state ? 'Apagar' : 'Encender'} ${d.name}`}
							disabled={toggle.isPending && toggle.variables === d.id}
							onClick={() => toggle.mutate(d.id)}
						>
							{d.state ? 'Apagar' : 'Encender'}
						</button>
					</li>
				))}
			</ul>

			<section>
				<h2>Nuevo dispositivo</h2>
				<form
					className="stack"
					onSubmit={(e) => {
						e.preventDefault()
						const form = e.currentTarget
						// todos los campos son texto y el navegador ya aplica required/pattern; la API valida con zod
						create.mutate(Object.fromEntries(new FormData(form)) as unknown as CreateDeviceInput, {
							onSuccess: () => form.reset(),
						})
					}}
				>
					<label>
						Slug
						<input name="slug" required maxLength={40} pattern="[a-z0-9\-]{1,40}" aria-describedby="slug-hint" />
					</label>
					<small id="slug-hint">Minúsculas, números y guiones, p. ej. «luz-sala».</small>
					<label>
						Nombre
						<input name="name" required maxLength={80} />
					</label>
					<label>
						Tipo
						<select name="type" defaultValue="light">
							{DEVICE_TYPES.map((t) => (
								<option key={t}>{t}</option>
							))}
						</select>
					</label>
					<label>
						Visibilidad
						<select name="visibility" defaultValue="private">
							<option value="private">Privado</option>
							<option value="public">Público</option>
						</select>
					</label>
					<label>
						Descripción
						<textarea name="description" maxLength={500} rows={2} />
					</label>
					{create.error && (
						<p role="alert" className="error">
							{create.error.message}
						</p>
					)}
					<button disabled={create.isPending}>Crear dispositivo</button>
				</form>
			</section>
		</>
	)
}
