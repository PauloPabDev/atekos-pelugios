import { useMutation, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { Loading } from '../components/ui'
import { SCOPE_TEXT } from '../scopes'

const GONE = 'La solicitud de autorización no existe o ha caducado. Vuelve a conectar desde la app.'
const message = (e: Error) => (e instanceof api.HttpError && e.status === 404 ? GONE : e.message)

// Consentimiento OAuth: GET /api/oauth/authorize guarda la petición y redirige aquí con ?req=<id>
export function Authorize() {
	const id = useSearchParams()[0].get('req')
	if (!id)
		return (
			<p role="alert" className="alert alert-error mx-auto max-w-md">
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

	if (info.isPending) return <Loading />
	if (info.error)
		return (
			<p role="alert" className="alert alert-error mx-auto max-w-md">
				{message(info.error)}
			</p>
		)

	const { clientName, redirectHost, scopes } = info.data
	// Tras decidir siguen desactivados: la petición ya no vale y el navegador está saliendo
	const busy = decide.isPending || decide.isSuccess
	return (
		<div className="card mx-auto max-w-md p-6 sm:mt-8 sm:p-8">
			<span
				className="grid size-12 place-items-center rounded-xl border border-line bg-subtle text-lg font-semibold text-fg"
				aria-hidden="true"
			>
				{[...clientName][0]?.toUpperCase()}
			</span>
			<h1 className="mt-4 text-xl">Autorizar a {clientName}</h1>
			<p className="mt-1 text-sm text-fg-muted">Quiere conectarse a tu cuenta de Atekos. Podrá, en tu nombre:</p>
			<ul aria-label="Permisos" className="mt-4 space-y-2.5 text-sm">
				{scopes.map((s) => (
					<li key={s} className="flex items-start gap-2.5">
						<span className="mt-0.5 text-success">
							<Icon name="check" size={16} />
						</span>
						{/* Uno desconocido se enseña tal cual en vez de ocultarlo */}
						{SCOPE_TEXT[s] ?? s}
					</li>
				))}
			</ul>
			<p className="mt-5 text-sm text-fg-muted">
				Te devolverá a <span className="mono">{redirectHost}</span>
			</p>
			<p className="alert alert-warning mt-4">
				<strong className="font-medium">Aprueba solo si tú acabas de iniciar esta conexión.</strong>
			</p>
			{decide.error && (
				<p role="alert" className="alert alert-error mt-4">
					{message(decide.error)}
				</p>
			)}
			<div className="mt-6 space-y-2">
				<button type="button" className="btn btn-primary w-full" disabled={busy} onClick={() => decide.mutate(true)}>
					Permitir
				</button>
				<button type="button" className="btn btn-secondary w-full" disabled={busy} onClick={() => decide.mutate(false)}>
					Denegar
				</button>
			</div>
		</div>
	)
}
