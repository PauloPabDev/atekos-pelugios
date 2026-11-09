import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CreateTokenInput, SCOPES, type ApiToken, type Scope } from '@atekos/shared'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { Problems } from '../components/Problems'
import { SCOPE_TEXT } from '../scopes'
import '../styles/tokens.css'

const date = (s: string | null) => (s ? new Date(s).toLocaleString() : 'nunca')

// Chips con la coma solo para lectores de pantalla: el texto sigue siendo «a, b»
function ScopeChips({ scopes }: { scopes: Scope[] }) {
	return (
		<dd className="chips">
			{scopes.map((s, i) => (
				<Fragment key={s}>
					{i > 0 && <span className="sr-only">, </span>}
					<span className="chip mono" title={SCOPE_TEXT[s]}>
						{s}
					</span>
				</Fragment>
			))}
		</dd>
	)
}

// Revocar en dos pasos dentro de la tarjeta; 'back' devuelve el foco a «Revocar» al cancelar
function Revoke({ name, busy, onConfirm }: { name: string; busy: boolean; onConfirm: () => void }) {
	const [step, setStep] = useState<'idle' | 'asking' | 'back'>('idle')
	if (step !== 'asking')
		return (
			<button
				type="button"
				className="danger"
				aria-label={`Revocar ${name}`}
				autoFocus={step === 'back'}
				onClick={() => setStep('asking')}
			>
				Revocar
			</button>
		)
	return (
		<div className="revoke-ask">
			<p>¿Revocar {name}? Lo que lo use dejará de funcionar al momento.</p>
			<div className="row">
				<button type="button" className="danger-solid" disabled={busy} aria-busy={busy} onClick={onConfirm}>
					Sí, revocar
				</button>
				<button type="button" autoFocus onClick={() => setStep('back')}>
					Cancelar
				</button>
			</div>
		</div>
	)
}

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

	const tokenCard = (t: ApiToken) => (
		<li key={t.id} className="card">
			<div className="row">
				<span className={t.revokedAt ? 'tile off' : 'tile yellow'}>
					<Icon name="key" />
				</span>
				<div className="grow">
					<h3 className="card-title">{t.name}</h3>
					<code className="muted">{t.prefix}…</code>
				</div>
			</div>
			<dl className="meta">
				<dt>Permisos</dt>
				<ScopeChips scopes={t.scopes} />
				{t.displayId ? (
					<>
						<dt>Pantalla</dt>
						<dd>{displayName(t.displayId)}</dd>
					</>
				) : (
					<>
						<dt>Dispositivo</dt>
						<dd>{deviceName(t.deviceId)}</dd>
					</>
				)}
				<dt>Último uso</dt>
				<dd>{date(t.lastUsedAt)}</dd>
				<dt>Vence</dt>
				<dd>{date(t.expiresAt)}</dd>
			</dl>
			{t.revokedAt ? (
				<p className="muted">Revocado el {date(t.revokedAt)}</p>
			) : (
				<>
					{revoke.error && revoke.variables === t.id && (
						<p role="alert" className="error">
							{revoke.error.message}
						</p>
					)}
					<Revoke
						name={t.name}
						busy={revoke.isPending && revoke.variables === t.id}
						onConfirm={() => revoke.mutate(t.id)}
					/>
				</>
			)}
		</li>
	)

	return (
		<>
			<h1>Tokens de API</h1>
			<p className="lead">
				Llaves para que tus dispositivos, scripts y pantallas hablen con Atekos. Van en la cabecera{' '}
				<code>Authorization: Bearer …</code>
			</p>

			<section className="new-token">
				<h2>Nuevo token</h2>
				<div className="cards shortcuts">
					<button type="button" onClick={forDisplay}>
						<span className="tile violet">
							<Icon name="screen" />
						</span>
						Token para pantalla MetaDisplay
					</button>
					<button type="button" onClick={forDevice}>
						<span className="tile">
							<Icon name="bulb" />
						</span>
						Token para un dispositivo o script
					</button>
				</div>
				<form className="card stack" onSubmit={onSubmit}>
					<label>
						Nombre
						<input name="name" required maxLength={80} ref={nameInput} />
					</label>
					<fieldset>
						<legend>Permisos</legend>
						<div className="scope-grid">
							{SCOPES.map((s) => (
								<div key={s}>
									{/* La descripción va fuera del label: su nombre accesible es solo el scope */}
									<label className="check">
										<input
											type="checkbox"
											aria-describedby={`scope-${s}`}
											checked={scopes.includes(s)}
											onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
										/>{' '}
										{s}
									</label>
									<span id={`scope-${s}`} className="scope-text">
										{SCOPE_TEXT[s]}
									</span>
								</div>
							))}
						</div>
					</fieldset>
					<small>
						display:connect es el token que va en la pantalla; displays:write sirve para administrar pantallas. No
						pueden ir juntos.
					</small>
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
					<label>
						Vence en días (opcional)
						<input name="expiresInDays" type="number" min={1} max={3650} inputMode="numeric" />
					</label>
					<Problems lines={invalid} />
					{create.error && (
						<p role="alert" className="error">
							{create.error.message}
						</p>
					)}
					<button className="primary" disabled={create.isPending} aria-busy={create.isPending}>
						Crear token
					</button>
				</form>

				{fresh && (
					<div className="card secret" role="region" aria-label="Token nuevo" tabIndex={-1} ref={secret}>
						<p>
							<strong>Cópialo ahora: es la única vez que se muestra.</strong> Si lo pierdes, revócalo y crea otro.
						</p>
						<code className="token">{fresh.token}</code>
						{fresh.scopes.includes('display:connect') && (
							<p>
								Pégalo tal cual en el campo <strong>token</strong> del portal WiFiManager de la pantalla,{' '}
								<strong>sin</strong> «Bearer». La URL del servidor es <code>wss://{location.host}/ws/device</code>.
							</p>
						)}
						<div className="row">
							<button type="button" className="primary" onClick={() => copy(fresh.token)}>
								<Icon name="copy" />
								Copiar
							</button>
							<span role="status" className="toast">
								{copied && (
									<span key={copied.at} className={copied.ok ? undefined : 'fail'}>
										{copied.ok ? 'Copiado.' : 'No se pudo copiar: selecciónalo y cópialo a mano.'}
									</span>
								)}
							</span>
						</div>
					</div>
				)}
			</section>

			<section>
				<h2>Tus tokens</h2>
				{tokens.isPending && <p className="loading">Cargando…</p>}
				{tokens.error && (
					<p role="alert" className="error">
						{tokens.error.message}
					</p>
				)}
				{tokens.data?.length === 0 && (
					<div className="empty">
						<span className="tile off">
							<Icon name="key" size={32} />
						</span>
						<p>No tienes tokens.</p>
						<p className="muted">Crea el primero con el formulario de arriba.</p>
					</div>
				)}
				<ul className="cards" aria-label="Tokens">
					{active.map(tokenCard)}
				</ul>
				{revoked.length > 0 && (
					<details className="revoked">
						<summary>Revocados ({revoked.length})</summary>
						<ul className="cards" aria-label="Tokens revocados">
							{revoked.map(tokenCard)}
						</ul>
					</details>
				)}
			</section>

			<section>
				<h2>Apps conectadas (IA)</h2>
				{grants.isPending && <p className="loading">Cargando…</p>}
				{grants.error && (
					<p role="alert" className="error">
						{grants.error.message}
					</p>
				)}
				{grants.data?.length === 0 && (
					<div className="empty">
						<span className="tile off">
							<Icon name="bot" size={32} />
						</span>
						<p>Ninguna app conectada.</p>
						<p className="muted">Cuando autorices a una IA (por ejemplo, Claude), aparecerá aquí.</p>
					</div>
				)}
				<ul className="cards" aria-label="Apps conectadas">
					{grants.data?.map((g) => (
						<li key={g.id} className="card">
							<div className="row">
								<span className="tile violet">
									<Icon name="bot" />
								</span>
								<h3 className="card-title grow">{g.clientName}</h3>
							</div>
							<dl className="meta">
								<dt>Permisos</dt>
								<ScopeChips scopes={g.scopes} />
								<dt>Creada</dt>
								<dd>{date(g.createdAt)}</dd>
								<dt>Último uso</dt>
								<dd>{date(g.lastUsedAt)}</dd>
							</dl>
							{revokeGrant.error && revokeGrant.variables === g.id && (
								<p role="alert" className="error">
									{revokeGrant.error.message}
								</p>
							)}
							<Revoke
								name={g.clientName}
								busy={revokeGrant.isPending && revokeGrant.variables === g.id}
								onConfirm={() => revokeGrant.mutate(g.id)}
							/>
						</li>
					))}
				</ul>
			</section>
		</>
	)
}
