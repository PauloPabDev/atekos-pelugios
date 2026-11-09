import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { DEVICE_TYPES, type CreateDeviceInput } from '@atekos/shared'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { Status } from '../components/Status'
import { putDevice, useDeviceSocket } from '../hooks/useDeviceSocket'
import { DEVICE_ICON, DEVICE_TYPE, label } from '../labels'
import '../styles/devices.css'

// «Luz del Salón» → «luz-del-salon», dentro de [a-z0-9-]{1,40}
const slugify = (s: string) =>
	s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+/, '')
		.slice(0, 40)
		.replace(/-+$/, '')

export function Devices() {
	const qc = useQueryClient()
	const devices = useQuery({ queryKey: ['devices'], queryFn: api.listDevices })
	useDeviceSocket(devices.data?.map((d) => d.id) ?? [])
	const toggle = useMutation({ mutationFn: api.toggleDevice, onSuccess: (d) => putDevice(qc, d) })
	const create = useMutation({
		mutationFn: api.createDevice,
		onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
	})
	const [name, setName] = useState('')
	// null = el usuario no ha tocado el slug: se deriva del nombre
	const [slug, setSlug] = useState<string | null>(null)

	return (
		<>
			<div className="page-head">
				<h1>Mis dispositivos</h1>
				{devices.data && (
					<span className="chip">
						{devices.data.length}
						<span className="sr-only"> dispositivos</span>
					</span>
				)}
				<a href="#nuevo" className="button primary">
					<Icon name="plus" />
					Nuevo
				</a>
			</div>
			{devices.isPending && <p className="loading">Cargando…</p>}
			{devices.error && (
				<p role="alert" className="error">
					{devices.error.message}
				</p>
			)}
			{devices.data?.length === 0 && (
				<div className="empty">
					<span className="tile yellow">
						<Icon name="bulb" size={32} />
					</span>
					<p>Todavía no tienes dispositivos.</p>
					<a href="#nuevo" className="button">
						<Icon name="plus" />
						Crear el primero
					</a>
				</div>
			)}
			<ul className="cards">
				{devices.data?.map((d) => {
					const busy = toggle.isPending && toggle.variables === d.id
					return (
						<li key={d.id} className="card device-card">
							<div className="row">
								<span className={`tile ${d.state ? 'green' : 'off'}`}>
									<Icon name={DEVICE_ICON[d.type] ?? 'cube'} />
								</span>
								<div className="grow">
									<Link to={`/devices/${d.id}`} className="stretch card-title">
										{d.name}
									</Link>
									<div className="chips">
										<span className="chip">{label(DEVICE_TYPE, d.type)}</span>
										<span className={`chip ${d.visibility === 'public' ? 'cyan' : ''}`}>
											{d.visibility === 'public' ? 'Público' : 'Privado'}
										</span>
									</div>
								</div>
							</div>
							<div className="row">
								<span className={`state ${d.state ? 'on' : 'off'}`}>{d.state ? 'Encendido' : 'Apagado'}</span>
								<button
									type="button"
									role="switch"
									aria-checked={d.state}
									aria-label={d.name}
									aria-busy={busy}
									className="switch"
									// sin disabled para que se vea el meneo de aria-busy; el if evita un doble toggle
									onClick={() => {
										if (!busy) toggle.mutate(d.id)
									}}
								/>
							</div>
							{toggle.error && toggle.variables === d.id && (
								<p role="alert" className="error">
									{toggle.error.message}
								</p>
							)}
						</li>
					)
				})}
			</ul>

			<section id="nuevo">
				<h2>Nuevo dispositivo</h2>
				<form
					className="card stack"
					onSubmit={(e) => {
						e.preventDefault()
						const form = e.currentTarget
						// todos los campos son texto y el navegador ya aplica required/pattern; la API valida con zod
						create.mutate(Object.fromEntries(new FormData(form)) as unknown as CreateDeviceInput, {
							onSuccess: () => {
								form.reset()
								setName('')
								setSlug(null)
							},
						})
					}}
				>
					<label>
						Nombre
						<input name="name" required maxLength={80} onChange={(e) => setName(e.target.value)} />
					</label>
					<label>
						Slug
						<input
							name="slug"
							required
							maxLength={40}
							pattern="[a-z0-9\-]{1,40}"
							aria-describedby="slug-hint"
							value={slug ?? slugify(name)}
							onChange={(e) => setSlug(e.target.value)}
						/>
					</label>
					<small id="slug-hint">Minúsculas, números y guiones, p. ej. «luz-sala». Se rellena desde el nombre.</small>
					<label>
						Tipo
						<select name="type" defaultValue="light">
							{DEVICE_TYPES.map((t) => (
								<option key={t} value={t}>
									{label(DEVICE_TYPE, t)}
								</option>
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
					<div className="row">
						<button className="primary" disabled={create.isPending}>
							Crear dispositivo
						</button>
						<Status m={create} text="Dispositivo creado." />
					</div>
				</form>
			</section>
		</>
	)
}
