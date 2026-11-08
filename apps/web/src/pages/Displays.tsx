import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { CreateDisplayInput } from '@atekos/shared'
import * as api from '../api'
import { Problems } from '../components/Problems'

export function Online({ online }: { online: boolean }) {
	return <span className={`state ${online ? 'on' : 'off'}`}>{online ? 'En línea' : 'Sin conexión'}</span>
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
			<h1>Mis pantallas</h1>
			{displays.isPending && <p>Cargando…</p>}
			<Problems lines={api.errorLines(displays.error)} />
			{displays.data?.length === 0 && <p className="muted">Todavía no tienes pantallas. Registra la primera abajo.</p>}
			<ul className="cards" aria-label="Pantallas">
				{displays.data?.map((d) => (
					<li key={d.deviceId} className="card row">
						<div className="grow">
							<Link to={`/displays/${d.deviceId}`}>
								<strong>{d.name}</strong>
							</Link>
							<div className="muted">
								<code>{d.deviceId}</code> · plantilla {d.activeTemplateId}
							</div>
						</div>
						<Online online={d.online} />
					</li>
				))}
			</ul>

			<section>
				<h2>Registrar pantalla</h2>
				<form className="stack" onSubmit={onSubmit}>
					<label>
						Id de la pantalla
						<input
							name="deviceId"
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
					<button disabled={create.isPending}>Registrar pantalla</button>
				</form>
			</section>
		</>
	)
}
