import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Device } from '@atekos/shared'
import { mockFetch, renderApp, user } from '../../test/utils'

const now = new Date().toISOString()
const device: Device = {
	id: crypto.randomUUID(),
	ownerId: user.id,
	slug: 'luz-sala',
	name: 'Luz de la sala',
	description: '',
	type: 'light',
	state: false,
	data: {},
	visibility: 'private',
	status: 'active',
	createdAt: now,
	updatedAt: now,
}

test('cada pestaña es una ruta: aria-current, título del documento e interruptor fuera de En vivo', async () => {
	vi.stubGlobal(
		'WebSocket',
		class {
			send() {}
			close() {}
		},
	)
	mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		[`GET /api/v1/devices/${device.id}`]: () => ({ body: device }),
	})
	renderApp(`/devices/${device.id}/ajustes`)

	const tabs = await screen.findByRole('navigation', { name: 'Secciones de «Luz de la sala»' })
	expect(screen.getByRole('link', { name: 'Ajustes' })).toHaveAttribute('aria-current', 'page')
	expect(screen.getByRole('link', { name: 'En vivo' })).not.toHaveAttribute('aria-current')
	// la pestaña principal sigue marcada en las subrutas
	expect(screen.getByRole('link', { name: 'Dispositivos' })).toHaveClass('text-fg')
	expect(document.title).toBe('Ajustes · Luz de la sala · atekos')
	expect(screen.getByRole('heading', { level: 2, name: 'Ajustes' })).toBeInTheDocument()
	// fuera de En vivo, el interruptor va en la cabecera
	expect(screen.getAllByRole('switch', { name: 'Luz de la sala' })).toHaveLength(1)

	await userEvent.click(screen.getByRole('link', { name: 'En vivo' }))
	expect(tabs.querySelector('[aria-current="page"]')).toHaveTextContent('En vivo')
	expect(document.title).toBe('En vivo · Luz de la sala · atekos')
	// en En vivo solo está el de la página: nunca dos controles con el mismo nombre
	expect(screen.getAllByRole('switch', { name: 'Luz de la sala' })).toHaveLength(1)
})
