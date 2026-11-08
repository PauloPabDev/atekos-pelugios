import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { ApiToken } from '@atekos/shared'
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
		'GET /api/v1/tokens': () => ({ body: listed }),
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
