import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SCOPES, type Scope } from '@atekos/shared'
import * as api from '../api'

const date = (s: string | null) => (s ? new Date(s).toLocaleString() : 'nunca')

export function Tokens() {
	const qc = useQueryClient()
	const tokens = useQuery({ queryKey: ['tokens'], queryFn: api.listTokens })
	const devices = useQuery({ queryKey: ['devices'], queryFn: api.listDevices })
	const refresh = () => qc.invalidateQueries({ queryKey: ['tokens'] })
	// El token en claro solo vive en create.data (estado de esta página); la lista se recarga
	// de GET /tokens, que nunca lo incluye, así que al salir de la página desaparece
	const create = useMutation({ mutationFn: api.createToken, onSuccess: refresh })
	const revoke = useMutation({ mutationFn: api.revokeToken, onSuccess: refresh })
	const [copyMsg, setCopyMsg] = useState('')
	const fresh = create.data

	const onSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		const form = e.currentTarget
		const f = new FormData(form)
		const days = String(f.get('expiresInDays') ?? '')
		setCopyMsg('')
		create.mutate(
			{
				name: String(f.get('name')),
				scopes: f.getAll('scopes') as Scope[],
				deviceId: String(f.get('deviceId') ?? '') || undefined,
				expiresInDays: days ? Number(days) : undefined,
			},
			{ onSuccess: () => form.reset() },
		)
	}

	const copy = async (token: string) => {
		try {
			await navigator.clipboard.writeText(token)
			setCopyMsg('Copiado.')
		} catch {
			// navigator.clipboard no existe fuera de HTTPS/localhost (p. ej. el celular por IP de la LAN)
			setCopyMsg('No se pudo copiar: selecciónalo y cópialo a mano.')
		}
	}

	const deviceName = (id: string | null) =>
		id === null ? 'todos' : (devices.data?.find((d) => d.id === id)?.name ?? id)

	return (
		<>
			<h1>Tokens de API</h1>
			<p className="muted">
				Para el ESP8266 y scripts: header <code>Authorization: Bearer …</code>
			</p>
			{tokens.isPending && <p>Cargando…</p>}
			{tokens.error && (
				<p role="alert" className="error">
					{tokens.error.message}
				</p>
			)}
			{tokens.data?.length === 0 && <p className="muted">No tienes tokens.</p>}
			{revoke.error && (
				<p role="alert" className="error">
					{revoke.error.message}
				</p>
			)}
			<ul className="cards" aria-label="Tokens">
				{tokens.data?.map((t) => (
					<li key={t.id} className="card">
						<div className="row">
							<strong className="grow">{t.name}</strong>
							<code>{t.prefix}…</code>
						</div>
						<dl className="meta">
							<dt>Scopes</dt>
							<dd>{t.scopes.join(', ')}</dd>
							<dt>Dispositivo</dt>
							<dd>{deviceName(t.deviceId)}</dd>
							<dt>Último uso</dt>
							<dd>{date(t.lastUsedAt)}</dd>
							<dt>Vence</dt>
							<dd>{date(t.expiresAt)}</dd>
						</dl>
						{t.revokedAt ? (
							<p className="muted">Revocado el {date(t.revokedAt)}</p>
						) : (
							<button
								type="button"
								className="danger"
								aria-label={`Revocar ${t.name}`}
								disabled={revoke.isPending && revoke.variables === t.id}
								onClick={() => revoke.mutate(t.id)}
							>
								Revocar
							</button>
						)}
					</li>
				))}
			</ul>

			<section>
				<h2>Nuevo token</h2>
				<form className="stack" onSubmit={onSubmit}>
					<label>
						Nombre
						<input name="name" required maxLength={80} />
					</label>
					<fieldset>
						<legend>Scopes</legend>
						{SCOPES.map((s) => (
							<label key={s} className="check">
								<input type="checkbox" name="scopes" value={s} /> {s}
							</label>
						))}
					</fieldset>
					<label>
						Dispositivo (opcional)
						<select name="deviceId" defaultValue="">
							<option value="">Todos mis dispositivos</option>
							{devices.data?.map((d) => (
								<option key={d.id} value={d.id}>
									{d.name}
								</option>
							))}
						</select>
					</label>
					<label>
						Vence en días (opcional)
						<input name="expiresInDays" type="number" min={1} max={3650} inputMode="numeric" />
					</label>
					{create.error && (
						<p role="alert" className="error">
							{create.error.message}
						</p>
					)}
					<button disabled={create.isPending}>Crear token</button>
				</form>

				{fresh && (
					<div className="card secret" role="region" aria-label="Token nuevo">
						<p>
							<strong>Cópialo ahora: es la única vez que se muestra.</strong> Si lo pierdes, revócalo y crea otro.
						</p>
						<code className="token">{fresh.token}</code>
						<div className="row">
							<button type="button" onClick={() => copy(fresh.token)}>
								Copiar
							</button>
							<span role="status">{copyMsg}</span>
						</div>
					</div>
				)}
			</section>
		</>
	)
}
