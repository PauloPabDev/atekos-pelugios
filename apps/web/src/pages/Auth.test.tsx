import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { mockFetch, renderApp, user } from '../test/utils'

const unauthorized = { status: 401, body: { error: 'unauthorized', message: 'sin sesión' } }

async function fillLogin() {
	await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
	await userEvent.type(screen.getByLabelText('Contraseña'), 'secreta-larga')
	await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
}

test('login: enviar el formulario llama a POST /auth/login y navega a /', async () => {
	let loggedIn = false
	const fetch = mockFetch({
		'POST /api/v1/auth/login': () => {
			loggedIn = true
			return { body: user }
		},
		'GET /api/v1/auth/me': () => (loggedIn ? { body: user } : unauthorized),
		'GET /api/v1/devices': () => ({ body: [] }),
	})
	renderApp('/login')
	await fillLogin()

	expect(await screen.findByRole('heading', { name: 'Mis dispositivos' })).toBeInTheDocument()
	expect(fetch).toHaveBeenCalledWith(
		'/api/v1/auth/login',
		expect.objectContaining({
			method: 'POST',
			credentials: 'same-origin',
			body: JSON.stringify({ email: 'ana@example.com', password: 'secreta-larga' }),
		}),
	)
})

test('login: un error de la API se muestra', async () => {
	mockFetch({
		'POST /api/v1/auth/login': () => ({
			status: 401,
			body: { error: 'invalid_credentials', message: 'Email o contraseña incorrectos' },
		}),
	})
	renderApp('/login')
	await fillLogin()

	expect(await screen.findByRole('alert')).toHaveTextContent('Email o contraseña incorrectos')
	expect(screen.getByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
})

test('ruta protegida sin sesión (/auth/me → 401) redirige a /login', async () => {
	mockFetch({ 'GET /api/v1/auth/me': () => unauthorized })
	renderApp('/tokens')

	expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
})
