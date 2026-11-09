import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { CreateDisplayInput } from '@atekos/shared'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { Problems } from '../components/Problems'
import '../styles/displays.css'

export function Online({ online }: { online: boolean }) {
	return <span className={online ? 'state on live' : 'state off'}>{online ? 'En línea' : 'Sin conexión'}</span>
}

export function Displays() {
	const qc = useQueryClient()
	// Polling (DISENO §1): el estado online y la plantilla activa cambian sin que la web haga nada
	const displays = useQuery({ queryKey: ['displays'], queryFn: api.listDisplays, refetchInterval: 3000 })
	const create = useMutation({
		mutationFn: api.createDisplay,
		onSuccess: () => qc.invalidateQueries({ queryKey: ['displays'] }),
	})
	const [invalid, setInvalid] = useState<string[]>([])
	const count = displays.data?.length ?? 0

	const onSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		const form = e.currentTarget
		// Además del pattern del navegador: CreateDisplayInput normaliza el hex a mayúsculas
		const parsed = CreateDisplayInput.safeParse(Object.fromEntries(new FormData(form)))
		setInvalid(parsed.success ? [] : api.issueLines(parsed.error.issues))
		if (parsed.success) create.mutate(parsed.data, { onSuccess: () => form.reset() })
	}

	return (
		<>
			<div className="page-head">
				<h1>Mis pantallas</h1>
				{/* Sin pantallas, la acción la lleva el bloque vacío */}
				{count > 0 && (
					<>
						<span className="chip">{count === 1 ? '1 pantalla' : `${count} pantallas`}</span>
						<a href="#nueva" className="button primary">
							<Icon name="plus" />
							Nueva
						</a>
					</>
				)}
			</div>
			{displays.isPending && <p className="loading">Cargando…</p>}
			<Problems lines={api.errorLines(displays.error)} />
			{displays.data?.length === 0 && (
				<div className="empty">
					<span className="tile violet">
						<Icon name="screen" />
					</span>
					<p>
						<strong>Todavía no tienes pantallas.</strong>
					</p>
					<p className="muted">Regístrala con su id y un nombre para editar lo que muestra.</p>
					<a href="#nueva" className="button primary">
						<Icon name="plus" />
						Registrar la primera
					</a>
				</div>
			)}
			<ul className="cards" aria-label="Pantallas">
				{displays.data?.map((d) => (
					<li key={d.deviceId} className="card display-card">
						<div className="row">
							<span className="tile violet">
								<Icon name="screen" />
							</span>
							<Online online={d.online} />
						</div>
						<Link to={`/displays/${d.deviceId}`} className="stretch card-title">
							{d.name}
						</Link>
						<div className="chips">
							<span className="chip mono">{d.deviceId}</span>
							<span className="chip">plantilla {d.activeTemplateId}</span>
						</div>
					</li>
				))}
			</ul>

			<section id="nueva">
				<h2>Registrar pantalla</h2>
				<form className="card stack" onSubmit={onSubmit}>
					<label>
						Id de la pantalla
						<input
							name="deviceId"
							className="device-id"
							required
							pattern="md-[0-9a-fA-F]{12}"
							placeholder="md-34B7DA01ABCD"
							autoComplete="off"
							spellCheck={false}
							aria-describedby="device-id-hint"
						/>
					</label>
					<small id="device-id-hint">
						«md-» y 12 hexadecimales: el deviceId que la pantalla envía en su device.hello.
					</small>
					<label>
						Nombre
						<input name="name" required maxLength={80} />
					</label>
					<Problems lines={[...invalid, ...api.errorLines(create.error)]} />
					<button className="primary" disabled={create.isPending}>
						Registrar pantalla
					</button>
				</form>
			</section>
		</>
	)
}
