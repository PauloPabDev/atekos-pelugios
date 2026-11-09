import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { Display } from '@atekos/shared'
import { mockFetch, renderApp, user } from '../test/utils'

const now = new Date().toISOString()
const display: Display = {
	id: crypto.randomUUID(),
	deviceId: 'md-34B7DA01ABCD',
	name: 'Meta',
	activeTemplateId: 'inicio',
	online: true,
	createdAt: now,
	updatedAt: now,
}

test('registrar una pantalla llama a POST /displays con el hex en mayúsculas y la lista la muestra', async () => {
	const listed: Display[] = []
	const fetch = mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		'GET /api/v1/displays': () => ({ body: listed }),
		'POST /api/v1/displays': () => {
			listed.push(display)
			return { status: 201, body: display }
		},
	})
	renderApp('/displays')

	await userEvent.click(await screen.findByRole('button', { name: 'Nueva pantalla' }))
	await userEvent.type(await screen.findByLabelText('Id de la pantalla'), 'md-34b7da01abcd')
	await userEvent.type(screen.getByLabelText('Nombre'), 'Meta')
	await userEvent.click(screen.getByRole('button', { name: 'Registrar pantalla' }))

	expect(fetch).toHaveBeenCalledWith(
		'/api/v1/displays',
		expect.objectContaining({ method: 'POST', body: JSON.stringify({ deviceId: 'md-34B7DA01ABCD', name: 'Meta' }) }),
	)
	const list = screen.getByRole('list', { name: 'Pantallas' })
	expect(await screen.findByRole('link', { name: 'Meta' })).toHaveAttribute('href', '/displays/md-34B7DA01ABCD')
	expect(list).toHaveTextContent('En línea')
	expect(list).toHaveTextContent('plantilla inicio')
})

test('un deviceId con formato inválido no se envía', async () => {
	const fetch = mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		'GET /api/v1/displays': () => ({ body: [] }),
	})
	renderApp('/displays')

	await userEvent.click(await screen.findByRole('button', { name: 'Nueva pantalla' }))
	const input = await screen.findByLabelText('Id de la pantalla')
	await userEvent.type(input, 'md-123')
	await userEvent.type(screen.getByLabelText('Nombre'), 'Meta')
	await userEvent.click(screen.getByRole('button', { name: 'Registrar pantalla' }))

	expect(input).toBeInvalid()
	expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
})
