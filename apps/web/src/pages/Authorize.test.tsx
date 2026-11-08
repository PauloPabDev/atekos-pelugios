import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { OAuthRequestInfo } from '@atekos/shared'
import { mockFetch, renderApp, user } from '../test/utils'

const info: OAuthRequestInfo = {
	clientName: 'Claude',
	redirectHost: 'claude.ai',
	scopes: ['devices:read', 'devices:write', 'displays:write'],
}
const redirectTo = 'https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz'

// jsdom no deja redefinir window.location.assign, así que se sustituye location entera
function stubAssign() {
	const assign = vi.fn()
	vi.stubGlobal('location', { ...window.location, assign })
	return assign
}

function consent() {
	return mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		'GET /api/v1/oauth/requests/req-1': () => ({ body: info }),
		'POST /api/v1/oauth/requests/req-1': () => ({ body: { redirectTo } }),
	})
}

test('enseña el cliente, los scopes en claro y el host de vuelta', async () => {
	consent()
	renderApp('/autorizar?req=req-1')

	expect(await screen.findByRole('heading', { name: 'Autorizar a Claude' })).toBeInTheDocument()
	const list = screen.getByRole('list', { name: 'Permisos' })
	expect(list).toHaveTextContent('Ver tus dispositivos')
	expect(list).toHaveTextContent('Crear dispositivos y cambiar su estado y sus datos')
	expect(list).toHaveTextContent('Crear y administrar tus pantallas (plantillas y datos)')
	expect(screen.getByText(/Te devolverá a/)).toHaveTextContent('Te devolverá a claude.ai')
	expect(screen.getByText('Aprueba solo si tú acabas de iniciar esta conexión.')).toBeInTheDocument()
})

test('Permitir manda approve:true y lleva el navegador a redirectTo', async () => {
	const assign = stubAssign()
	const fetch = consent()
	renderApp('/autorizar?req=req-1')

	await userEvent.click(await screen.findByRole('button', { name: 'Permitir' }))

	await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(redirectTo))
	expect(fetch).toHaveBeenCalledWith(
		'/api/v1/oauth/requests/req-1',
		expect.objectContaining({ method: 'POST', body: JSON.stringify({ approve: true }) }),
	)
	expect(screen.getByRole('button', { name: 'Denegar' })).toBeDisabled()
})

test('Denegar manda approve:false', async () => {
	const assign = stubAssign()
	const fetch = consent()
	renderApp('/autorizar?req=req-1')

	await userEvent.click(await screen.findByRole('button', { name: 'Denegar' }))

	await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(redirectTo))
	expect(fetch).toHaveBeenCalledWith(
		'/api/v1/oauth/requests/req-1',
		expect.objectContaining({ method: 'POST', body: JSON.stringify({ approve: false }) }),
	)
})

test('una solicitud caducada (404) enseña el aviso y no los botones', async () => {
	mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		'GET /api/v1/oauth/requests/vieja': () => ({ status: 404, body: { error: 'not_found' } }),
	})
	renderApp('/autorizar?req=vieja')

	expect(await screen.findByRole('alert')).toHaveTextContent('no existe o ha caducado')
	expect(screen.queryByRole('button', { name: 'Permitir' })).not.toBeInTheDocument()
})

test('sin ?req= enseña el aviso sin llamar a la API', async () => {
	const fetch = mockFetch({ 'GET /api/v1/auth/me': () => ({ body: user }) })
	renderApp('/autorizar')

	expect(await screen.findByRole('alert')).toHaveTextContent('no existe o ha caducado')
	expect(fetch).toHaveBeenCalledTimes(1)
})
