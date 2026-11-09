import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { ApiToken, CreateTokenInput, Display, OAuthGrant } from '@atekos/shared'
import { mockFetch, renderApp, user } from '../test/utils'

test('tras crear, el token en claro aparece y no queda guardado en la lista', async () => {
	const plain = `dmt_${'x'.repeat(43)}`
	const token: ApiToken = {
		id: crypto.randomUUID(),
		name: 'esp-sala',
		prefix: 'dmt_xxxx',
		scopes: ['devices:read'],
		deviceId: null,
		displayId: null,
		expiresAt: null,
		lastUsedAt: null,
		revokedAt: null,
		createdAt: new Date().toISOString(),
	}
	const listed: ApiToken[] = []
	const fetch = mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		'GET /api/v1/devices': () => ({ body: [] }),
		'GET /api/v1/displays': () => ({ body: [] }),
		'GET /api/v1/tokens': () => ({ body: listed }),
		'GET /api/v1/oauth/grants': () => ({ body: [] }),
		'POST /api/v1/tokens': () => {
			listed.push(token)
			return { status: 201, body: { ...token, token: plain } }
		},
	})
	const qc = renderApp('/tokens')

	await userEvent.type(await screen.findByLabelText('Nombre'), 'esp-sala')
	await userEvent.click(screen.getByLabelText('devices:read'))
	await userEvent.click(screen.getByRole('button', { name: 'Crear token' }))

	expect(await screen.findByText(plain)).toBeInTheDocument()
	expect(fetch).toHaveBeenCalledWith(
		'/api/v1/tokens',
		expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'esp-sala', scopes: ['devices:read'] }) }),
	)
	const list = screen.getByRole('list', { name: 'Tokens' })
	expect(await within(list).findByText('esp-sala')).toBeInTheDocument()
	expect(list).not.toHaveTextContent(plain)
	expect(JSON.stringify(qc.getQueryData(['tokens']))).not.toContain(plain)
})

test('display:connect sin pantalla muestra la regla y no envía; con pantalla envía displayId', async () => {
	const now = new Date().toISOString()
	const display: Display = {
		id: crypto.randomUUID(),
		deviceId: 'md-34B7DA01ABCD',
		name: 'Meta',
		activeTemplateId: 'inicio',
		online: false,
		lastSeenAt: null,
		createdAt: now,
		updatedAt: now,
	}
	const listed: ApiToken[] = []
	const plain = `dmt_${'y'.repeat(43)}`
	const fetch = mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		'GET /api/v1/devices': () => ({ body: [] }),
		'GET /api/v1/displays': () => ({ body: [display] }),
		'GET /api/v1/tokens': () => ({ body: listed }),
		'GET /api/v1/oauth/grants': () => ({ body: [] }),
		'POST /api/v1/tokens': (init) => {
			const input = JSON.parse(String(init?.body)) as CreateTokenInput
			const token: ApiToken = {
				id: crypto.randomUUID(),
				name: input.name,
				prefix: 'dmt_yyyy',
				scopes: input.scopes,
				deviceId: null,
				displayId: input.displayId ?? null,
				expiresAt: null,
				lastUsedAt: null,
				revokedAt: null,
				createdAt: now,
			}
			listed.push(token)
			return { status: 201, body: { ...token, token: plain } }
		},
	})
	renderApp('/tokens')
	const posts = () => fetch.mock.calls.filter(([, init]) => init?.method === 'POST')

	await userEvent.type(await screen.findByLabelText('Nombre'), 'pantalla-meta')
	await userEvent.click(screen.getByRole('button', { name: 'Token para pantalla MetaDisplay' }))
	expect(screen.getByLabelText('display:connect')).toBeChecked()
	expect(screen.getByLabelText(/^Pantalla/)).toHaveFocus()
	await userEvent.click(screen.getByRole('button', { name: 'Crear token' }))

	expect(await screen.findByRole('alert')).toHaveTextContent('display:connect exige displayId')
	expect(posts()).toHaveLength(0)

	await userEvent.selectOptions(screen.getByLabelText(/^Pantalla/), 'Meta (md-34B7DA01ABCD)')
	await userEvent.click(screen.getByRole('button', { name: 'Crear token' }))

	expect(await screen.findByText(plain)).toBeInTheDocument()
	expect(posts()).toHaveLength(1)
	expect(JSON.parse(String(posts()[0]?.[1]?.body))).toEqual({
		name: 'pantalla-meta',
		scopes: ['display:connect'],
		displayId: display.id,
	})
	expect(screen.getByRole('region', { name: 'Token nuevo' })).toHaveTextContent('/ws/device')
	const list = screen.getByRole('list', { name: 'Tokens' })
	expect(await within(list).findByText('Meta')).toBeInTheDocument()
	expect(list).toHaveTextContent('Pantalla')
})

test('apps conectadas: lista los grants y Revocar llama a DELETE y recarga la lista', async () => {
	const grant: OAuthGrant = {
		id: crypto.randomUUID(),
		clientName: 'Claude',
		scopes: ['devices:read', 'displays:write'],
		createdAt: new Date().toISOString(),
		lastUsedAt: null,
	}
	let grants = [grant]
	const fetch = mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		'GET /api/v1/devices': () => ({ body: [] }),
		'GET /api/v1/displays': () => ({ body: [] }),
		'GET /api/v1/tokens': () => ({ body: [] }),
		'GET /api/v1/oauth/grants': () => ({ body: grants }),
		[`DELETE /api/v1/oauth/grants/${grant.id}`]: () => {
			grants = []
			return { status: 204 }
		},
	})
	renderApp('/tokens')

	const list = await screen.findByRole('list', { name: 'Apps conectadas' })
	expect(await within(list).findByText('Claude')).toBeInTheDocument()
	expect(list).toHaveTextContent('devices:read, displays:write')
	expect(list).toHaveTextContent('nunca')

	await userEvent.click(within(list).getByRole('button', { name: 'Revocar Claude' }))
	await userEvent.click(within(list).getByRole('button', { name: 'Sí, revocar' }))

	expect(await screen.findByText('Ninguna app conectada.')).toBeInTheDocument()
	expect(fetch).toHaveBeenCalledWith(`/api/v1/oauth/grants/${grant.id}`, expect.objectContaining({ method: 'DELETE' }))
	expect(list).not.toHaveTextContent('Claude')
})

test('?pantalla=<id> preselecciona la pantalla, display:connect y un nombre', async () => {
	const now = new Date().toISOString()
	const display: Display = {
		id: crypto.randomUUID(),
		deviceId: 'md-34B7DA01ABCD',
		name: 'Meta',
		activeTemplateId: 'inicio',
		online: false,
		lastSeenAt: null,
		createdAt: now,
		updatedAt: now,
	}
	mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		'GET /api/v1/devices': () => ({ body: [] }),
		'GET /api/v1/displays': () => ({ body: [display] }),
		'GET /api/v1/tokens': () => ({ body: [] }),
		'GET /api/v1/oauth/grants': () => ({ body: [] }),
	})
	renderApp(`/tokens?pantalla=${display.id}`)

	expect(await screen.findByDisplayValue('Pantalla Meta')).toHaveFocus()
	expect(screen.getByLabelText(/^Pantalla/)).toHaveValue(display.id)
	expect(screen.getByLabelText('display:connect')).toBeChecked()
})
