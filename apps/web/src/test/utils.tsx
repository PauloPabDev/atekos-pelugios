import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { App } from '../App'

type Reply = { status?: number; body?: unknown }

// fetch simulado: las claves son "MÉTODO /ruta"; una ruta sin handler hace fallar el test
export function mockFetch(routes: Record<string, (init?: RequestInit) => Reply>) {
	const fn = vi.fn(async (url: string, init?: RequestInit) => {
		const key = `${init?.method ?? 'GET'} ${url}`
		const handler = routes[key]
		if (!handler) throw new Error(`fetch no simulado: ${key}`)
		const { status = 200, body } = handler(init)
		return new Response(body === undefined ? null : JSON.stringify(body), { status })
	})
	vi.stubGlobal('fetch', fn)
	return fn
}

export function renderApp(path: string) {
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	render(
		<QueryClientProvider client={qc}>
			<MemoryRouter initialEntries={[path]}>
				<App />
			</MemoryRouter>
		</QueryClientProvider>,
	)
	return qc
}

export const user = { id: crypto.randomUUID(), email: 'ana@example.com', username: 'ana' }
