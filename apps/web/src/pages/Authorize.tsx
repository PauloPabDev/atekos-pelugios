import { useMutation, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { SCOPE_TEXT } from '../scopes'
import '../styles/tokens.css'

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

	if (info.isPending) return <p className="loading">Cargando…</p>
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
		<div className="card narrow consent">
			<span className="tile pink" aria-hidden="true">
				{[...clientName][0]?.toUpperCase()}
			</span>
			<h1>Autorizar a {clientName}</h1>
			<p>Podrá, en tu nombre:</p>
			<ul aria-label="Permisos" className="perms">
				{scopes.map((s) => (
					<li key={s}>
						<Icon name="check" size={18} />
						{/* Uno desconocido se enseña tal cual en vez de ocultarlo */}
						{SCOPE_TEXT[s] ?? s}
					</li>
				))}
			</ul>
			<p>
				Te devolverá a <span className="chip mono">{redirectHost}</span>
			</p>
			<p className="callout warn">
				<strong>Aprueba solo si tú acabas de iniciar esta conexión.</strong>
			</p>
			{decide.error && (
				<p role="alert" className="error">
					{message(decide.error)}
				</p>
			)}
			<div className="stack">
				<button type="button" className="primary block" disabled={busy} onClick={() => decide.mutate(true)}>
					Permitir
				</button>
				<button type="button" className="block" disabled={busy} onClick={() => decide.mutate(false)}>
					Denegar
				</button>
			</div>
		</div>
	)
}
