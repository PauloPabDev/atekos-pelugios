import { useMutation, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import type { Scope } from '@atekos/shared'
import * as api from '../api'

// Lo que concede cada scope, en claro; uno desconocido se enseña tal cual en vez de ocultarlo
const SCOPE_TEXT: Partial<Record<Scope, string>> = {
	'devices:read': 'Ver tus dispositivos',
	'devices:write': 'Crear dispositivos y cambiar su estado y sus datos',
	'displays:write': 'Crear y administrar tus pantallas (plantillas y datos)',
}

const GONE = 'La solicitud de autorización no existe o ha caducado. Vuelve a conectar desde la app.'
const message = (e: Error) => (e instanceof api.HttpError && e.status === 404 ? GONE : e.message)

// Consentimiento OAuth: GET /api/oauth/authorize guarda la petición y redirige aquí con ?req=<id>
export function Authorize() {
	const id = useSearchParams()[0].get('req')
	if (!id)
		return (
			<p role="alert" className="error">
				{GONE}
			</p>
		)
	return <Consent id={id} />
}

function Consent({ id }: { id: string }) {
	const info = useQuery({ queryKey: ['oauth-request', id], queryFn: () => api.getOAuthRequest(id) })
	const decide = useMutation({
		mutationFn: (approve: boolean) => api.decideOAuthRequest(id, approve),
		onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
	})

	if (info.isPending) return <p>Cargando…</p>
	if (info.error)
		return (
			<p role="alert" className="error">
				{message(info.error)}
			</p>
		)

	const { clientName, redirectHost, scopes } = info.data
	// Tras decidir siguen desactivados: la petición ya no vale y el navegador está saliendo
	const busy = decide.isPending || decide.isSuccess
	return (
		<>
			<h1>Autorizar a {clientName}</h1>
			<p>Podrá, en tu nombre:</p>
			<ul aria-label="Permisos">
				{scopes.map((s) => (
					<li key={s}>{SCOPE_TEXT[s] ?? s}</li>
				))}
			</ul>
			<p>
				Te devolverá a <strong>{redirectHost}</strong>
			</p>
			<p>
				<strong>Aprueba solo si tú acabas de iniciar esta conexión.</strong>
			</p>
			{decide.error && (
				<p role="alert" className="error">
					{message(decide.error)}
				</p>
			)}
			<div className="row">
				<button type="button" disabled={busy} onClick={() => decide.mutate(true)}>
					Permitir
				</button>
				<button type="button" disabled={busy} onClick={() => decide.mutate(false)}>
					Denegar
				</button>
			</div>
		</>
	)
}
