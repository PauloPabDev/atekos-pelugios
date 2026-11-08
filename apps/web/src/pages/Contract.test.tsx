import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { METADISPLAY_CONTRACT, metaDisplayAsyncApi, metaDisplayOpenApi } from '@atekos/shared/contract'
import { mockFetch, renderApp } from '../test/utils'

// Documentos reales generados desde los zod: si la página deja de entender el contrato, el test se rompe
const origin = 'https://atekos.example'
const contract = {
	'GET /api/v1/contract/asyncapi.json': () => ({ body: metaDisplayAsyncApi(origin) }),
	'GET /api/v1/contract/openapi.json': () => ({ body: metaDisplayOpenApi(origin) }),
}
const updated = new Date(METADISPLAY_CONTRACT.updatedAt).toLocaleDateString('es-ES', {
	day: 'numeric',
	month: 'long',
	year: 'numeric',
	timeZone: 'UTC',
})

test('muestra versión, última actualización, WebSocket, mensajes por sentido, REST y descargas', async () => {
	mockFetch(contract)
	renderApp('/contrato')

	expect(await screen.findByText(updated)).toBeInTheDocument()
	expect(screen.getByText(/Última actualización/)).toHaveTextContent(
		`v${METADISPLAY_CONTRACT.version} · Última actualización: ${updated}`,
	)
	expect(screen.getByText('wss://atekos.example/ws/device')).toBeInTheDocument()

	const fromDevice = screen.getByRole('list', { name: 'Del dispositivo al servidor' })
	const fromServer = screen.getByRole('list', { name: 'Del servidor al dispositivo' })
	for (const t of ['device.hello', 'touch.tap']) expect(within(fromDevice).getByText(t)).toBeInTheDocument()
	for (const t of ['template.set', 'display.brightness']) expect(within(fromServer).getByText(t)).toBeInTheDocument()
	expect(within(fromDevice).queryByText('template.set')).toBeNull()

	const post = screen.getByText('POST /displays').closest('tr') as HTMLElement
	expect(within(post).getByText('sesión')).toBeInTheDocument()
	// El $ref del cuerpo enlaza a su esquema
	expect(within(post).getByRole('link', { name: 'CreateDisplayInput' })).toHaveAttribute(
		'href',
		'#schema-CreateDisplayInput',
	)
	expect(document.getElementById('schema-CreateDisplayInput')).not.toBeNull()

	expect(screen.getByRole('link', { name: 'asyncapi.json' })).toHaveAttribute('href', '/api/v1/contract/asyncapi.json')
	expect(screen.getByRole('link', { name: 'openapi.json' })).toHaveAttribute('href', '/api/v1/contract/openapi.json')
	expect(screen.getByRole('link', { name: 'Contrato oficial (CONTRATO.md)' })).toHaveAttribute(
		'href',
		'https://github.com/PauloPabDev/atekos-pelugios/blob/main/docs/metadisplay/CONTRATO.md',
	)
})

test('/contrato se ve sin sesión', async () => {
	const fetch = mockFetch({
		...contract,
		'GET /api/v1/auth/me': () => ({ status: 401, body: { error: 'unauthorized' } }),
	})
	renderApp('/contrato')

	expect(await screen.findByText(updated)).toBeInTheDocument()
	expect(screen.getByRole('heading', { name: 'Contrato MetaDisplay' })).toBeInTheDocument()
	expect(screen.getByText('wss://atekos.example/ws/device')).toBeInTheDocument()
	expect(fetch).not.toHaveBeenCalledWith('/api/v1/auth/me', expect.anything())
})
