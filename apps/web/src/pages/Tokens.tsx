import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { CreateTokenInput, SCOPES, type ApiToken, type Scope } from '@atekos/shared'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { Problems } from '../components/Problems'
import { EmptyState, Loading, PageHeader } from '../components/ui'
import { ago, fullDate } from '../labels'
import { SCOPE_TEXT } from '../scopes'

// Relativo («hace 5 minutos», «dentro de 30 días») con la fecha completa al pasar el ratón
const when = (s: string | null) =>
	s ? (
		<time dateTime={s} title={fullDate(s)}>
			{ago(s)}
		</time>
	) : (
		'nunca'
	)

// Insignias con la coma solo para lectores de pantalla: el texto sigue siendo «a, b»
function ScopeBadges({ scopes }: { scopes: Scope[] }) {
	return (
		<dd className="flex flex-wrap gap-1">
			{scopes.map((s, i) => (
				<Fragment key={s}>
					{i > 0 && <span className="sr-only">, </span>}
					<span className="badge font-mono" title={SCOPE_TEXT[s]}>
						{s}
					</span>
				</Fragment>
			))}
		</dd>
	)
}

// Metadatos en línea («Último uso: hace 2 días»); un nombre largo parte en vez de desbordar la fila
function Meta({ items }: { items: [term: string, value: ReactNode][] }) {
	return (
		<dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
			{items.map(([term, value]) => (
				<div key={term} className="min-w-0 break-words">
					<dt className="inline text-fg-subtle">{term}:</dt> <dd className="inline">{value}</dd>
				</div>
			))}
		</dl>
	)
}

// Fila de token o de app: nombre, permisos y metadatos a la izquierda; la acción a la derecha
function Row({
	title,
	extra,
	scopes,
	meta,
	children,
}: {
	title: string
	extra?: ReactNode
	scopes: Scope[]
	meta: [string, ReactNode][]
	children?: ReactNode
}) {
	return (
		<li className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-3.5">
			<div className="min-w-0 flex-1 space-y-2">
				<div className="flex flex-wrap items-center gap-2">
					<h3 className="min-w-0 break-words">{title}</h3>
					{extra}
				</div>
				<dl>
					<dt className="sr-only">Permisos</dt>
					<ScopeBadges scopes={scopes} />
				</dl>
				<Meta items={meta} />
			</div>
			{children}
		</li>
	)
}

// Revocar en dos pasos dentro de la fila; 'back' devuelve el foco a «Revocar» al cancelar
function Revoke({ name, busy, onConfirm }: { name: string; busy: boolean; onConfirm: () => void }) {
	const [step, setStep] = useState<'idle' | 'asking' | 'back'>('idle')
	if (step !== 'asking')
		return (
			<button
				type="button"
				className="btn btn-danger-outline"
				aria-label={`Revocar ${name}`}
				autoFocus={step === 'back'}
				onClick={() => setStep('asking')}
			>
				Revocar
			</button>
		)
	return (
		<div className="basis-full rounded-md border border-red-200 bg-danger-soft p-3">
			<p className="text-sm font-medium text-danger-fg">
				¿Revocar {name}? Lo que lo use dejará de funcionar al momento.
			</p>
			<div className="mt-3 flex flex-wrap gap-2">
				<button type="button" className="btn btn-danger" disabled={busy} aria-busy={busy} onClick={onConfirm}>
					Sí, revocar
				</button>
				<button type="button" className="btn btn-secondary" autoFocus onClick={() => setStep('back')}>
					Cancelar
				</button>
			</div>
		</div>
	)
}

// Un error de revocar va en la fila que falló, a lo ancho
const RowError = ({ error }: { error: Error }) => (
	<p role="alert" className="alert alert-error basis-full">
		{error.message}
	</p>
)

export function Tokens() {
	const qc = useQueryClient()
	const tokens = useQuery({ queryKey: ['tokens'], queryFn: api.listTokens })
	const devices = useQuery({ queryKey: ['devices'], queryFn: api.listDevices })
	const displays = useQuery({ queryKey: ['displays'], queryFn: api.listDisplays })
	const refresh = () => qc.invalidateQueries({ queryKey: ['tokens'] })
	// El token en claro solo vive en create.data (estado de esta página); la lista se recarga
	// de GET /tokens, que nunca lo incluye, así que al salir de la página desaparece
	const create = useMutation({ mutationFn: api.createToken, onSuccess: refresh })
	const revoke = useMutation({ mutationFn: api.revokeToken, onSuccess: refresh })
	const grants = useQuery({ queryKey: ['oauth-grants'], queryFn: api.listOAuthGrants })
	const revokeGrant = useMutation({
		mutationFn: api.revokeOAuthGrant,
		onSuccess: () => qc.invalidateQueries({ queryKey: ['oauth-grants'] }),
	})
	// at hace de key: cada intento de copiar se anuncia y anima de nuevo
	const [copied, setCopied] = useState<{ ok: boolean; at: number } | null>(null)
	// Scopes controlados para que los atajos puedan marcarlos
	const [scopes, setScopes] = useState<Scope[]>([])
	const [invalid, setInvalid] = useState<string[]>([])
	const nameInput = useRef<HTMLInputElement>(null)
	const displaySelect = useRef<HTMLSelectElement>(null)
	const secret = useRef<HTMLDivElement>(null)
	const fresh = create.data

	// El token solo se ve una vez: se lleva a la vista y se enfoca para que no pase desapercibido
	useEffect(() => {
		if (!fresh) return
		// jsdom no implementa scrollIntoView
		secret.current?.scrollIntoView?.({ block: 'center' })
		secret.current?.focus({ preventScroll: true })
	}, [fresh])

	const onSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		const form = e.currentTarget
		const f = new FormData(form)
		const days = String(f.get('expiresInDays') ?? '')
		setCopied(null)
		// La regla de separación de CreateTokenInput (DISENO §1) se aplica antes de enviar, con sus mensajes
		const parsed = CreateTokenInput.safeParse({
			name: String(f.get('name')),
			scopes,
			deviceId: String(f.get('deviceId') ?? '') || undefined,
			displayId: String(f.get('displayId') ?? '') || undefined,
			expiresInDays: days ? Number(days) : undefined,
		})
		setInvalid(parsed.success ? [] : api.issueLines(parsed.error.issues))
		if (!parsed.success) return
		create.mutate(parsed.data, {
			onSuccess: () => {
				form.reset()
				setScopes([])
			},
		})
	}

	// Desde los ajustes de una pantalla (?pantalla=<id>): el atajo de pantalla con ella ya elegida, una sola vez
	const pantalla = useSearchParams()[0].get('pantalla')
	const preset = useRef(false)
	useEffect(() => {
		const d = displays.data?.find((x) => x.id === pantalla)
		if (!d || preset.current || !displaySelect.current || !nameInput.current) return
		preset.current = true
		displaySelect.current.value = d.id
		if (!nameInput.current.value) nameInput.current.value = `Pantalla ${d.name}`
		setScopes(['display:connect'])
		nameInput.current.focus()
	}, [displays.data, pantalla])

	const forDisplay = () => {
		setScopes(['display:connect'])
		displaySelect.current?.focus()
	}

	const forDevice = () => {
		setScopes(['devices:read', 'devices:write'])
		nameInput.current?.focus()
	}

	const copy = async (token: string) => {
		try {
			await navigator.clipboard.writeText(token)
			setCopied({ ok: true, at: Date.now() })
		} catch {
			// navigator.clipboard no existe fuera de HTTPS/localhost (p. ej. el celular por IP de la LAN)
			setCopied({ ok: false, at: Date.now() })
		}
	}

	const deviceName = (id: string | null) =>
		id === null ? 'todos' : (devices.data?.find((d) => d.id === id)?.name ?? id)
	const displayName = (id: string) => displays.data?.find((d) => d.id === id)?.name ?? id
	const active = tokens.data?.filter((t) => !t.revokedAt) ?? []
	const revoked = tokens.data?.filter((t) => t.revokedAt) ?? []

	const tokenRow = (t: ApiToken) => (
		<Row
			key={t.id}
			title={t.name}
			extra={<code className="mono">{t.prefix}…</code>}
			scopes={t.scopes}
			meta={[
				t.displayId ? ['Pantalla', displayName(t.displayId)] : ['Dispositivo', deviceName(t.deviceId)],
				['Último uso', when(t.lastUsedAt)],
				t.revokedAt ? ['Revocado', when(t.revokedAt)] : ['Vence', when(t.expiresAt)],
			]}
		>
			{!t.revokedAt && (
				<>
					<Revoke
						name={t.name}
						busy={revoke.isPending && revoke.variables === t.id}
						onConfirm={() => revoke.mutate(t.id)}
					/>
					{revoke.error && revoke.variables === t.id && <RowError error={revoke.error} />}
				</>
			)}
		</Row>
	)

	// Las listas siempre montadas (los tests y los lectores las siguen tras recargar); el marco, solo con filas
	const listClass = (n: number) => (n > 0 ? 'card divide-y divide-line' : undefined)

	return (
		<>
			<PageHeader
				title="Tokens de API"
				description={
					<>
						Llaves para que tus dispositivos, scripts y pantallas hablen con Atekos. Van en la cabecera{' '}
						<code className="mono">Authorization: Bearer …</code>
					</>
				}
			/>

			<section className="space-y-3">
				<h2>Nuevo token</h2>
				<div className="card">
					<div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row">
						<button type="button" className="btn btn-secondary" onClick={forDisplay}>
							<Icon name="screen" size={16} />
							Token para pantalla MetaDisplay
						</button>
						<button type="button" className="btn btn-secondary" onClick={forDevice}>
							<Icon name="bulb" size={16} />
							Token para un dispositivo o script
						</button>
					</div>
					<form className="space-y-5 p-4 sm:p-5" onSubmit={onSubmit}>
						<label className="field sm:max-w-sm">
							Nombre
							<input name="name" required maxLength={80} ref={nameInput} />
						</label>
						<fieldset>
							<legend>Permisos</legend>
							<div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
								{SCOPES.map((s) => (
									<div key={s}>
										{/* La descripción va fuera del label: su nombre accesible es solo el scope */}
										<label className="check font-mono">
											<input
												type="checkbox"
												aria-describedby={`scope-${s}`}
												checked={scopes.includes(s)}
												onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
											/>
											{s}
										</label>
										<p id={`scope-${s}`} className="-mt-2 mb-1 pl-7 text-sm text-fg-muted sm:-mt-1">
											{SCOPE_TEXT[s]}
										</p>
									</div>
								))}
							</div>
							<small className="mt-3 block">
								display:connect es el token que va en la pantalla; displays:write sirve para administrar pantallas. No
								pueden ir juntos.
							</small>
						</fieldset>
						<div className="grid items-end gap-4 sm:grid-cols-2">
							<label className="field">
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
							<label className="field">
								Pantalla{scopes.includes('display:connect') ? ' (obligatoria con display:connect)' : ' (opcional)'}
								<select name="displayId" defaultValue="" ref={displaySelect}>
									<option value="">Ninguna</option>
									{displays.data?.map((d) => (
										<option key={d.id} value={d.id}>
											{`${d.name} (${d.deviceId})`}
										</option>
									))}
								</select>
							</label>
							<label className="field">
								Vence en días (opcional)
								<input name="expiresInDays" type="number" min={1} max={3650} inputMode="numeric" />
							</label>
						</div>
						<Problems lines={invalid} />
						{create.error && (
							<p role="alert" className="alert alert-error">
								{create.error.message}
							</p>
						)}
						<div className="flex justify-end border-t border-line pt-4">
							<button
								className="btn btn-primary w-full sm:w-auto"
								disabled={create.isPending}
								aria-busy={create.isPending}
							>
								Crear token
							</button>
						</div>
					</form>
				</div>

				{fresh && (
					<div
						className="card space-y-4 border-indigo-200 bg-brand-soft p-4 sm:p-5"
						role="region"
						aria-label="Token nuevo"
						tabIndex={-1}
						ref={secret}
					>
						<p className="text-sm">
							<strong className="font-semibold">Cópialo ahora: es la única vez que se muestra.</strong> Si lo pierdes,
							revócalo y crea otro.
						</p>
						<code className="block rounded-md border border-indigo-200 bg-surface px-3 py-2.5 font-mono text-[15px] break-all text-fg select-all">
							{fresh.token}
						</code>
						<div className="flex flex-wrap items-center gap-3">
							<button type="button" className="btn btn-primary" onClick={() => copy(fresh.token)}>
								<Icon name="copy" size={16} />
								Copiar
							</button>
							<span role="status" className="text-sm font-medium">
								{copied && (
									<span
										key={copied.at}
										className={
											copied.ok
												? 'animate-[fade-in_160ms_ease-out,fade-out_400ms_ease_3s_forwards] text-success-fg'
												: 'animate-fade-in text-danger-fg'
										}
									>
										{copied.ok ? 'Copiado.' : 'No se pudo copiar: selecciónalo y cópialo a mano.'}
									</span>
								)}
							</span>
						</div>
						{fresh.scopes.includes('display:connect') && (
							<p className="alert alert-info">
								Pégalo tal cual en el campo <strong>token</strong> del portal WiFiManager de la pantalla,{' '}
								<strong>sin</strong> «Bearer». La URL del servidor es{' '}
								<code className="mono break-all">wss://{location.host}/ws/device</code>.
							</p>
						)}
					</div>
				)}
			</section>

			<section className="mt-10 space-y-3">
				<h2>Tus tokens</h2>
				{tokens.isPending && <Loading />}
				{tokens.error && (
					<p role="alert" className="alert alert-error">
						{tokens.error.message}
					</p>
				)}
				{tokens.data?.length === 0 && (
					<EmptyState icon="key" title="No tienes tokens.">
						Crea el primero con el formulario de arriba.
					</EmptyState>
				)}
				<ul className={listClass(active.length)} aria-label="Tokens">
					{active.map(tokenRow)}
				</ul>
				{revoked.length > 0 && (
					<details>
						<summary>Revocados ({revoked.length})</summary>
						<ul className="card mt-2 divide-y divide-line opacity-70" aria-label="Tokens revocados">
							{revoked.map(tokenRow)}
						</ul>
					</details>
				)}
			</section>

			<section className="mt-10 space-y-3">
				<h2>Apps conectadas (IA)</h2>
				{grants.isPending && <Loading />}
				{grants.error && (
					<p role="alert" className="alert alert-error">
						{grants.error.message}
					</p>
				)}
				{grants.data?.length === 0 && (
					<EmptyState icon="bot" title="Ninguna app conectada.">
						Cuando autorices a una IA (por ejemplo, Claude), aparecerá aquí.
					</EmptyState>
				)}
				<ul className={listClass(grants.data?.length ?? 0)} aria-label="Apps conectadas">
					{grants.data?.map((g) => (
						<Row
							key={g.id}
							title={g.clientName}
							scopes={g.scopes}
							meta={[
								['Creada', when(g.createdAt)],
								['Último uso', when(g.lastUsedAt)],
							]}
						>
							<Revoke
								name={g.clientName}
								busy={revokeGrant.isPending && revokeGrant.variables === g.id}
								onConfirm={() => revokeGrant.mutate(g.id)}
							/>
							{revokeGrant.error && revokeGrant.variables === g.id && <RowError error={revokeGrant.error} />}
						</Row>
					))}
				</ul>
			</section>
		</>
	)
}
