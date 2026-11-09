import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { DEVICE_TYPES, type DeviceType, type Visibility } from '@atekos/shared'
import * as api from '../../api'
import { Icon } from '../../components/Icon'
import { Status } from '../../components/Status'
import { useDraft } from '../../hooks/useDraft'
import { putDevice } from '../../hooks/useDeviceSocket'
import { DEVICE_TYPE } from '../../labels'
import { STICKY_FOOT } from './DeviceData'
import { useDevice } from './DeviceLayout'

type Form = { name: string; type: DeviceType; description: string; visibility: Visibility }

const VISIBILITY: [Visibility, string, string][] = [
	['private', 'Privado', 'Solo tú y tus tokens.'],
	[
		'public',
		'Público',
		'Cualquiera con el enlace ve su estado, sus datos y su historial, sin iniciar sesión. Solo tú puedes cambiarlo.',
	],
]

export function DeviceSettings() {
	const { device: d } = useDevice()
	const qc = useQueryClient()
	const navigate = useNavigate()
	const [confirming, setConfirming] = useState(false)
	const [copied, setCopied] = useState<{ where: 'public' | 'dev'; text: string }>({ where: 'dev', text: '' })
	// Sin cambios tuyos, el formulario sigue a lo que llega en vivo
	const [form, setForm, { dirty, reset }] = useDraft<Form>(`/devices/${d.id}/ajustes`, {
		name: d.name,
		type: d.type,
		description: d.description,
		visibility: d.visibility,
	})
	const set = (patch: Partial<Form>) => setForm({ ...form, ...patch })
	const patch = useMutation({
		mutationFn: (input: Form) => api.patchDevice(d.id, input),
		onSuccess: (x) => {
			putDevice(qc, x)
			reset()
		},
	})
	const del = useMutation({
		mutationFn: () => api.deleteDevice(d.id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['devices'] })
			navigate('/')
		},
	})
	const publicUrl = new URL(`/p/${d.id}`, location.origin).href

	// El aviso sale junto al botón que copió
	const copy = async (where: 'public' | 'dev', text: string, done: string) => {
		try {
			await navigator.clipboard.writeText(text)
			setCopied({ where, text: done })
		} catch {
			// navigator.clipboard no existe fuera de HTTPS/localhost (p. ej. el celular por IP de la LAN)
			setCopied({ where, text: `No se pudo copiar; cópialo a mano: ${text}` })
		}
	}

	return (
		<div className="space-y-8">
			<form
				className="card"
				aria-labelledby="ajustes-general"
				onSubmit={(e) => {
					e.preventDefault()
					patch.mutate(form)
				}}
			>
				<div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
					<h2 id="ajustes-general" className="sm:col-span-2">
						General
					</h2>
					<label className="field">
						Nombre
						<input required maxLength={80} value={form.name} onChange={(e) => set({ name: e.target.value })} />
					</label>
					<label className="field">
						Tipo
						<select value={form.type} onChange={(e) => set({ type: e.target.value as DeviceType })}>
							{DEVICE_TYPES.map((t) => (
								<option key={t} value={t}>
									{DEVICE_TYPE[t] ?? t}
								</option>
							))}
						</select>
					</label>
					<label className="field sm:col-span-2">
						Descripción
						<textarea
							maxLength={500}
							rows={2}
							value={form.description}
							onChange={(e) => set({ description: e.target.value })}
						/>
					</label>
				</div>
				<fieldset className="rounded-none border-0 border-t border-line p-4 sm:p-5">
					<legend className="float-left mb-2 w-full p-0">
						<h2>Quién puede verlo</h2>
					</legend>
					<div className="clear-left space-y-1">
						{VISIBILITY.map(([v, title, text]) => (
							<label
								key={v}
								className="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 has-checked:bg-subtle"
							>
								<input
									type="radio"
									name="visibility"
									className="mt-0.5"
									checked={form.visibility === v}
									onChange={() => set({ visibility: v })}
									aria-labelledby={`vis-${v}`}
									aria-describedby={`vis-${v}-text`}
								/>
								<span className="min-w-0">
									<span id={`vis-${v}`} className="block text-sm font-medium text-fg">
										{title}
									</span>
									<span id={`vis-${v}-text`} className="block text-sm text-fg-muted">
										{text}
									</span>
								</span>
							</label>
						))}
					</div>
					{/* La página pública existe cuando ya está guardado como público */}
					{d.visibility === 'public' && (
						<div className="mt-3 flex flex-wrap items-center gap-2 sm:pl-10">
							<Link to={`/p/${d.id}`} className="btn btn-secondary">
								<Icon name="eye" size={16} />
								Ver página pública
							</Link>
							<button
								type="button"
								className="btn btn-secondary"
								onClick={() => copy('public', publicUrl, 'Enlace copiado.')}
							>
								<Icon name="copy" size={16} />
								Copiar enlace
							</button>
							<span role="status" className="min-w-0 text-sm break-all text-fg-muted">
								{copied.where === 'public' && copied.text}
							</span>
						</div>
					)}
				</fieldset>
				{patch.error && (
					<p role="alert" className="alert alert-error mx-4 mb-4 sm:mx-5">
						{patch.error.message}
					</p>
				)}
				<div className={STICKY_FOOT}>
					<Status m={patch} text="Guardado." />
					{dirty && (
						<button type="button" className="btn btn-ghost" onClick={reset}>
							Descartar
						</button>
					)}
					<button className="btn btn-primary" disabled={!dirty || patch.isPending} aria-busy={patch.isPending}>
						Guardar cambios
					</button>
				</div>
			</form>

			<section className="card" aria-labelledby="ajustes-dev">
				<div className="p-4 pb-2 sm:px-5">
					<h2 id="ajustes-dev">Para programadores</h2>
					<p className="mt-1 text-sm text-fg-muted">Lo que necesitas para hablar con él desde la API o un ESP.</p>
				</div>
				<dl className="divide-y divide-line">
					<Row label="Slug">
						<span className="mono min-w-0 break-all">{d.slug}</span>
						<CopyButton label="Copiar slug" onClick={() => copy('dev', d.slug, 'Slug copiado.')} />
					</Row>
					<Row label="Id">
						<span className="mono min-w-0 break-all">{d.id}</span>
						<CopyButton label="Copiar id" onClick={() => copy('dev', d.id, 'Id copiado.')} />
					</Row>
					<Row label="Tokens">
						<Link to="/tokens" className="link text-sm">
							Gestionar tokens ›
						</Link>
					</Row>
				</dl>
				<p role="status" className="px-4 pb-3 text-sm break-all text-fg-muted empty:p-0 sm:px-5">
					{copied.where === 'dev' && copied.text}
				</p>
			</section>

			<section className="card border-red-200 p-4 sm:p-5" aria-labelledby="ajustes-peligro">
				<h2 id="ajustes-peligro">Zona de peligro</h2>
				{confirming ? (
					<>
						<p className="mt-1 text-sm text-fg">
							¿Borrar «{d.name}»? Se borran sus datos, sus programas y sus tokens ligados. No se puede deshacer.
						</p>
						<div className="mt-4 flex flex-wrap gap-2">
							<button
								type="button"
								className="btn btn-danger"
								onClick={() => del.mutate()}
								disabled={del.isPending}
								aria-busy={del.isPending}
							>
								Sí, borrar
							</button>
							<button type="button" className="btn btn-secondary" autoFocus onClick={() => setConfirming(false)}>
								Cancelar
							</button>
						</div>
						{del.error && (
							<p role="alert" className="alert alert-error mt-3">
								{del.error.message}
							</p>
						)}
					</>
				) : (
					<div className="mt-1 flex flex-wrap items-center justify-between gap-3">
						<p className="text-sm text-fg-muted">Se borran sus datos, sus programas y sus tokens ligados.</p>
						<button type="button" className="btn btn-danger-outline" onClick={() => setConfirming(true)}>
							<Icon name="trash" size={16} />
							Borrar dispositivo
						</button>
					</div>
				)}
			</section>
		</div>
	)
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-5">
			<dt className="w-16 shrink-0 text-sm text-fg-muted">{label}</dt>
			<dd className="flex min-w-0 flex-1 items-center justify-between gap-2">{children}</dd>
		</div>
	)
}

function CopyButton({ label, onClick }: { label: string; onClick: () => void }) {
	return (
		<button type="button" className="btn btn-icon btn-ghost" aria-label={label} title={label} onClick={onClick}>
			<Icon name="copy" size={16} />
		</button>
	)
}
