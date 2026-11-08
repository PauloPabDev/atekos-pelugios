import type { FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import type { LoginInput, RegisterInput } from '@atekos/shared'
import * as api from '../api'

// Tras entrar se vacía la caché (puede quedar la de otro usuario o un ['me'] en 401) y se va a /
function useEnter<T>(mutationFn: (input: T) => Promise<unknown>) {
	const qc = useQueryClient()
	const navigate = useNavigate()
	const m = useMutation({
		mutationFn,
		onSuccess: () => {
			qc.removeQueries()
			navigate('/')
		},
	})
	const onSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		m.mutate(Object.fromEntries(new FormData(e.currentTarget)) as T)
	}
	return { m, onSubmit }
}

export function Login() {
	const { m, onSubmit } = useEnter<LoginInput>(api.login)
	return (
		<main className="page narrow">
			<h1>Entrar</h1>
			<form className="stack" onSubmit={onSubmit}>
				<label>
					Email
					<input name="email" type="email" autoComplete="email" required />
				</label>
				<label>
					Contraseña
					<input name="password" type="password" autoComplete="current-password" required />
				</label>
				{m.error && (
					<p role="alert" className="error">
						{m.error.message}
					</p>
				)}
				<button disabled={m.isPending}>Entrar</button>
			</form>
			<p>
				¿No tienes cuenta? <Link to="/register">Regístrate</Link>
			</p>
		</main>
	)
}

export function Register() {
	const { m, onSubmit } = useEnter<RegisterInput>(api.register)
	return (
		<main className="page narrow">
			<h1>Crear cuenta</h1>
			<form className="stack" onSubmit={onSubmit}>
				<label>
					Email
					<input name="email" type="email" autoComplete="email" required maxLength={254} />
				</label>
				<label>
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
				<label>
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
				{m.error && (
					<p role="alert" className="error">
						{m.error.message}
					</p>
				)}
				<button disabled={m.isPending}>Crear cuenta</button>
			</form>
			<p>
				¿Ya tienes cuenta? <Link to="/login">Entra</Link>
			</p>
		</main>
	)
}
