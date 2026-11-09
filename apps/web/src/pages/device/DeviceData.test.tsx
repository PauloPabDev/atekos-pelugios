import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { putDevice } from '../../hooks/useDeviceSocket'
import { api, luz, mockDevice, page } from '../../test/device'
import { renderApp } from '../../test/utils'

const d = { ...luz, data: { ...luz.data, viejo: true } }

test('guardar envía solo las claves cambiadas (PATCH) y un DELETE por cada clave quitada', async () => {
	const after = { ...d, data: { brillo: 90, color: 'ámbar', modo: 'noche' } }
	const fn = mockDevice(d, {
		[`PATCH ${api(d)}/data`]: () => ({ body: { ...after, data: { ...after.data, viejo: true } } }),
		[`DELETE ${api(d)}/data/viejo`]: () => ({ body: after }),
	})
	renderApp(`${page(d)}/datos`)

	const brillo = await screen.findByLabelText('Valor de brillo')
	await userEvent.clear(brillo)
	expect(await screen.findByText('No es un número.')).toBeInTheDocument()
	await userEvent.type(brillo, '90')
	await userEvent.click(screen.getByRole('button', { name: 'Quitar viejo' }))
	expect(screen.getByText('Se quitará')).toBeInTheDocument()

	await userEvent.click(screen.getByRole('button', { name: 'Añadir dato' }))
	// el foco va a la clave nueva; vacía, no deja guardar
	expect(screen.getByLabelText('Clave del dato nuevo')).toHaveFocus()
	await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
	expect(await screen.findByText('La clave no puede estar vacía.')).toBeInTheDocument()
	await userEvent.type(screen.getByLabelText('Clave del dato nuevo'), 'modo')
	await userEvent.type(screen.getByLabelText('Valor de modo'), 'noche')
	expect(screen.getByText('3 cambios sin guardar')).toBeInTheDocument()

	await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
	expect(await screen.findByText('Guardado.')).toBeInTheDocument()
	const calls = fn.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
	expect(calls.map(([url, init]) => [init?.method, url, init?.body])).toEqual([
		['PATCH', `${api(d)}/data`, JSON.stringify({ brillo: 90, modo: 'noche' })],
		['DELETE', `${api(d)}/data/viejo`, undefined],
	])
	expect(screen.getByLabelText('Valor de modo')).toHaveValue('noche')
	expect(screen.queryByText(/sin guardar/)).toBeNull()
})

test('el borrador sobrevive al cambio de pestaña; lo que llega en vivo no lo pisa y avisa si choca', async () => {
	mockDevice(d)
	const qc = renderApp(`${page(d)}/datos`)

	await userEvent.clear(await screen.findByLabelText('Valor de brillo'))
	await userEvent.type(screen.getByLabelText('Valor de brillo'), '90')
	await userEvent.click(screen.getByRole('link', { name: 'En vivo' }))
	await userEvent.click(await screen.findByRole('link', { name: /^Datos/ }))
	expect(await screen.findByLabelText('Valor de brillo')).toHaveValue('90')
	// la pestaña marca el borrador
	expect(screen.getByRole('link', { name: /^Datos.*\(sin guardar\)$/ })).toBeInTheDocument()

	// El dispositivo escribe color (que no tocaste) y brillo (que sí)
	act(() => putDevice(qc, { ...d, data: { ...d.data, brillo: 85, color: 'rojo' } }))
	// TanStack avisa a los observadores en la siguiente vuelta: se espera
	await waitFor(() => expect(screen.getByLabelText('Valor de color')).toHaveValue('rojo'))
	expect(screen.getByLabelText('Valor de brillo')).toHaveValue('90')
	expect(screen.getByText('«brillo» cambió en el dispositivo a 85 mientras editabas.')).toBeInTheDocument()

	await userEvent.click(screen.getByRole('button', { name: 'Usar 85' }))
	expect(screen.getByLabelText('Valor de brillo')).toHaveValue('85')
	await waitFor(() => expect(screen.queryByText(/mientras editabas/)).toBeNull())
	expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
})

test('Ver como JSON edita el mismo borrador', async () => {
	mockDevice(d)
	renderApp(`${page(d)}/datos`)

	await userEvent.click(await screen.findByRole('button', { name: 'Ver como JSON' }))
	const text = screen.getByLabelText('Datos en JSON')
	await userEvent.clear(text)
	await userEvent.type(text, '{{"brillo": 80, "color": "azul"')
	expect(screen.getByText(/^JSON no válido: /)).toBeInTheDocument()
	await userEvent.type(text, '}')
	// viejo ya no está en el objeto: se quitará
	expect(screen.getByText('2 cambios sin guardar')).toBeInTheDocument()

	await userEvent.click(screen.getByRole('button', { name: 'Ver como formulario' }))
	expect(screen.getByLabelText('Valor de color')).toHaveValue('azul')
	expect(screen.getByText('Se quitará')).toBeInTheDocument()
})
