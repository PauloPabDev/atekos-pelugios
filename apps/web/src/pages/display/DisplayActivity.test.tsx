import { act, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { base, mockDisplay, page, touch } from '../../test/display'
import { renderApp } from '../../test/utils'

test('la actividad va en filas por día que dicen si vino de un toque o de un botón; lo técnico, debajo', async () => {
	mockDisplay({
		[`GET ${base}/events`]: () => ({
			body: [
				touch({ source: 'button', button: 2, press: 'long', toast: 'Datos cambiados', x: 204, y: 138 }),
				touch({ status: 'rejected' }),
				touch({ source: null, actionId: 'menu', name: null }),
			],
		}),
	})
	renderApp(`${page}/actividad`)

	const day = await screen.findByRole('heading', { name: 'Hoy' })
	const rows = within(day.nextElementSibling as HTMLElement).getAllByRole('listitem')
	expect(rows[0]).toHaveTextContent('Botón 2 (larga) · «Datos cambiados»Aceptado')
	expect(rows[0]).toHaveTextContent('data.set · acción pulsar · inicio v1 · x 204, y 138')
	expect(rows[1]).toHaveTextContent('ToqueRechazado')
	// Sin origen ni aviso, la acción hace de título
	expect(rows[2]).toHaveTextContent('Acción menuAceptado')
	expect(screen.queryByRole('table')).toBeNull()
})

test('lo que llega por polling destella; lo que ya estaba al entrar, no', async () => {
	const old = touch({ ts: new Date(Date.now() - 60_000).toISOString(), toast: 'viejo' })
	let events = [old]
	mockDisplay({ [`GET ${base}/events`]: () => ({ body: events }) })
	const qc = renderApp(`${page}/actividad`)

	const first = (await screen.findByText(/«viejo»/)).closest('li')
	expect(first).not.toHaveClass('motion-safe:animate-flash')

	events = [touch({ toast: 'nuevo' }), old]
	await act(() => qc.invalidateQueries({ queryKey: ['display-events'] }))
	expect((await screen.findByText(/«nuevo»/)).closest('li')).toHaveClass('motion-safe:animate-flash')
	expect(screen.getByText(/«viejo»/).closest('li')).not.toHaveClass('motion-safe:animate-flash')
})
