import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { DisplayTemplate } from '@atekos/shared'
import { base, detail, inicio, mockDisplay, page } from '../../test/display'
import { renderApp } from '../../test/utils'

const conVariables: DisplayTemplate = {
	...inicio,
	elements: [
		{ type: 'text', x: 10, y: 10, bind: 'mensaje' },
		{ type: 'text', x: 10, y: 30, format: 'T: {temp} C', when: [{ key: 'alarma', op: 'truthy', set: {} }] },
	],
}

test('una fila por variable que usa la plantilla, con el control de su tipo; las demás, aparte', async () => {
	mockDisplay({
		[`GET ${base}`]: () => ({
			body: { ...detail, template: conVariables, values: { mensaje: 'HOLA', temp: 21, alarma: true, otra: 'x' } },
		}),
	})
	renderApp(`${page}/datos`)

	const list = within(await screen.findByRole('list', { name: 'Variables que usa la plantilla activa' }))
	expect(list.getAllByRole('listitem')).toHaveLength(3)
	expect(list.getByRole('textbox', { name: 'mensaje' })).toHaveValue('HOLA')
	expect(list.getByRole('textbox', { name: 'temp' })).toHaveAccessibleDescription('Número')
	expect(list.getByRole('switch', { name: 'alarma' })).toHaveAttribute('aria-checked', 'true')
	const others = within(screen.getByRole('list', { name: 'Otras variables' }))
	expect(others.getByRole('textbox', { name: 'otra' })).toHaveValue('x')

	// Un número mal escrito se explica y no deja enviar
	await userEvent.clear(list.getByRole('textbox', { name: 'temp' }))
	await userEvent.type(list.getByRole('textbox', { name: 'temp' }), '2x')
	expect(list.getByRole('textbox', { name: 'temp' })).toHaveAccessibleDescription('No es un número.')
	expect(screen.getByRole('button', { name: 'Enviar a la pantalla' })).toBeDisabled()
})

test('«Enviar a la pantalla» manda solo lo cambiado y la vista previa ya lo enseña antes', async () => {
	const bodies: unknown[] = []
	mockDisplay({
		[`GET ${base}`]: () => ({ body: { ...detail, template: conVariables, values: { mensaje: 'HOLA', temp: 21 } } }),
		[`PATCH ${base}/data`]: (init) => {
			bodies.push(JSON.parse(String(init?.body)))
			return { body: { values: {} } }
		},
	})
	renderApp(`${page}/datos`)

	const send = await screen.findByRole('button', { name: 'Enviar a la pantalla' })
	expect(send).toBeDisabled()
	const temp = screen.getByRole('textbox', { name: 'temp' })
	await userEvent.clear(temp)
	await userEvent.type(temp, '22,5')
	expect(within(screen.getByRole('img', { name: /Vista previa/ })).getByText('T: 22.5 C')).toBeInTheDocument()
	expect(screen.getByText('1 cambio')).toBeInTheDocument()

	await userEvent.click(send)
	expect(await screen.findByText('Enviado a la pantalla.')).toBeInTheDocument()
	expect(bodies).toEqual([{ temp: 22.5 }])
})
