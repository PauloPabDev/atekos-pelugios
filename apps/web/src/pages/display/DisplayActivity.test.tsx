import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { base, mockDisplay, page } from '../../test/display'
import { renderApp } from '../../test/utils'

test('los eventos dicen si vienen de un toque o de un botón físico', async () => {
	const ev = {
		ts: new Date().toISOString(),
		actionId: 'a',
		name: 'data.set',
		x: 0,
		y: 0,
		templateId: 'inicio',
		templateVersion: 1,
		status: 'ok',
		toast: null,
	}
	mockDisplay({
		[`GET ${base}/events`]: () => ({
			body: [
				{ ...ev, eventId: 'e1', source: 'button', button: 2, press: 'long' },
				{ ...ev, eventId: 'e2', source: 'touch', button: null, press: null },
				{ ...ev, eventId: 'e3', source: null, button: null, press: null },
			],
		}),
	})
	renderApp(`${page}/actividad`)

	const rows = (await screen.findAllByRole('row')).slice(1)
	expect(rows.map((r) => within(r).getAllByRole('cell')[3]?.textContent)).toEqual(['botón 2 larga', 'toque', '—'])
})
