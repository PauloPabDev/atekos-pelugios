import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Device } from '@atekos/shared'
import { mockFetch, renderApp, user } from '../test/utils'

const now = new Date().toISOString()
const device = (name: string): Device => ({
	id: crypto.randomUUID(),
	ownerId: user.id,
	slug: 'x',
	name,
	description: '',
	type: 'light',
	state: false,
	data: {},
	visibility: 'private',
	status: 'active',
	createdAt: now,
	updatedAt: now,
})

test('el slug se rellena desde el nombre hasta que lo tocas', async () => {
	mockFetch({ 'GET /api/v1/auth/me': () => ({ body: user }), 'GET /api/v1/devices': () => ({ body: [] }) })
	renderApp('/')

	const name = await screen.findByLabelText('Nombre')
	const slug = screen.getByLabelText('Slug')
	await userEvent.type(name, ' Luz del Salón — Ñandú! ')
	expect(slug).toHaveValue('luz-del-salon-nandu')

	await userEvent.clear(slug)
	await userEvent.type(slug, 'mi-luz')
	await userEvent.type(name, 'x')
	expect(slug).toHaveValue('mi-luz')
})

test('el error del interruptor sale en la tarjeta del dispositivo que falló', async () => {
	vi.stubGlobal(
		'WebSocket',
		class {
			send() {}
			close() {}
		},
	)
	const [a, b] = [device('Luz sala'), device('Luz cocina')]
	mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		'GET /api/v1/devices': () => ({ body: [a, b] }),
		[`POST /api/v1/devices/${b.id}/toggle`]: () => ({ status: 503, body: { error: 'x', message: 'Sin conexión' } }),
	})
	renderApp('/')

	await userEvent.click(await screen.findByRole('switch', { name: 'Luz cocina' }))

	const alert = await screen.findByRole('alert')
	expect(alert).toHaveTextContent('Sin conexión')
	expect(within(screen.getByRole('link', { name: 'Luz cocina' }).closest('li')!).getByRole('alert')).toBe(alert)
})
