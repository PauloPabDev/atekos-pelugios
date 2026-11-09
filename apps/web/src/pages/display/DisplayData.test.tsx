import { screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { DisplayTemplate } from '@atekos/shared'
import { base, detail, inicio, mockDisplay, page } from '../../test/display'
import { renderApp } from '../../test/utils'

test('Datos lista las variables que usa la plantilla activa y marca las que no tienen valor', async () => {
	const conVariables: DisplayTemplate = {
		...inicio,
		elements: [
			{ type: 'text', x: 10, y: 10, bind: 'mensaje' },
			{ type: 'text', x: 10, y: 30, format: 'T: {temp} C', when: [{ key: 'alarma', op: 'truthy', set: {} }] },
		],
	}
	mockDisplay({ [`GET ${base}`]: () => ({ body: { ...detail, template: conVariables } }) })
	renderApp(`${page}/datos`)

	const list = within(await screen.findByRole('list', { name: /Variables que usa la plantilla/ }))
	expect(list.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
		'mensaje: "HOLA"',
		'temp: sin valor',
		'alarma: sin valor',
	])
	expect(screen.queryByText('Parámetros')).toBeNull()
})
