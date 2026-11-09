import type { FormEvent, ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { LoginInput, RegisterInput } from '@atekos/shared'
import * as api from '../api'
import { BrandMark } from '../components/Icon'

// ?next= solo puede ser una ruta de esta web: «//host» y «/\host» saldrían a otro sitio (open redirect),
// y el navegador quita tabuladores y saltos de línea de las URL («/\t/host» acaba en «//host»)
const safeNext = (next: string | null) => (next && /^\/(?![/\\])[^\t\n\r]*$/.test(next) ? next : '/')

// Tras entrar se vacía la caché (puede quedar la de otro usuario o un ['me'] en 401) y se va a ?next= o a /
function useEnter<T>(mutationFn: (input: T) => Promise<unknown>) {
	const qc = useQueryClient()
	const navigate = useNavigate()
	const next = useSearchParams()[0].get('next')
	const m = useMutation({
		mutationFn,
		onSuccess: () => {
			qc.removeQueries()
			navigate(safeNext(next))
		},
	})
	const onSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		m.mutate(Object.fromEntries(new FormData(e.currentTarget)) as T)
	}
	// Para que el enlace entre Login y Register no pierda el destino
	const keepNext = next ? `?${new URLSearchParams({ next })}` : ''
	return { m, onSubmit, keepNext }
}

// Pantalla de entrada: marca, tarjeta con el formulario y el enlace a la otra acción
function AuthFrame({
	title,
	description,
	children,
	alt,
}: {
	title: string
	description: string
	children: ReactNode
	alt: ReactNode
}) {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
			<div className="w-full max-w-sm">
				<p className="mb-8 flex items-center justify-center gap-2.5">
					<BrandMark />
				</p>
				<div className="card p-6 sm:p-8">
					<h1 className="text-xl">{title}</h1>
					<p className="mt-1 text-sm text-fg-muted">{description}</p>
					{children}
				</div>
				<p className="mt-6 text-center text-sm text-fg-muted">{alt}</p>
			</div>
		</main>
	)
}

export function Login() {
	const { m, onSubmit, keepNext } = useEnter<LoginInput>(api.login)
	return (
		<AuthFrame
			title="Entrar"
			description="Controla tus dispositivos y pantallas."
			alt={
				<>
					¿No tienes cuenta?{' '}
					<Link className="link" to={`/register${keepNext}`}>
						Regístrate
					</Link>
				</>
			}
		>
			<form className="mt-6 space-y-4" onSubmit={onSubmit}>
				<label className="field">
					Email
					<input name="email" type="email" autoComplete="email" required />
				</label>
				<label className="field">
					Contraseña
					<input name="password" type="password" autoComplete="current-password" required />
				</label>
				{m.error && (
					<p role="alert" className="alert alert-error">
						{m.error.message}
					</p>
				)}
				<button className="btn btn-primary w-full" disabled={m.isPending} aria-busy={m.isPending}>
					Entrar
				</button>
			</form>
		</AuthFrame>
	)
}

export function Register() {
	const { m, onSubmit, keepNext } = useEnter<RegisterInput>(api.register)
	return (
		<AuthFrame
			title="Crear cuenta"
			description="Solo necesitas un email y una contraseña."
			alt={
				<>
					¿Ya tienes cuenta?{' '}
					<Link className="link" to={`/login${keepNext}`}>
						Entra
					</Link>
				</>
			}
		>
			<form className="mt-6 space-y-4" onSubmit={onSubmit}>
				<label className="field">
					Email
					<input name="email" type="email" autoComplete="email" required maxLength={254} />
				</label>
				<div className="space-y-1.5">
					<label className="field">
						Usuario
						<input
							name="username"
							autoComplete="username"
							required
							maxLength={40}
							pattern="[a-zA-Z0-9_\-]+"
							aria-describedby="username-hint"
						/>
					</label>
					<small id="username-hint">Letras, números, «_» y «-».</small>
				</div>
				<div className="space-y-1.5">
					<label className="field">
						Contraseña
						<input
							name="password"
							type="password"
							autoComplete="new-password"
							required
							minLength={10}
							maxLength={200}
							aria-describedby="password-hint"
						/>
					</label>
					<small id="password-hint">Mínimo 10 caracteres.</small>
				</div>
				{m.error && (
					<p role="alert" className="alert alert-error">
						{m.error.message}
					</p>
				)}
				<button className="btn btn-primary w-full" disabled={m.isPending} aria-busy={m.isPending}>
					Crear cuenta
				</button>
			</form>
		</AuthFrame>
	)
}
