import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { ApiToken } from '@atekos/shared'
import { api, event, luz, mockDevice, page } from '../../test/device'
import { renderApp } from '../../test/utils'
import { dataChanges, eventText, whoText } from './DeviceActivity'

const on = { ...luz, state: true }

test('eventText: qué pasó, en claro', () => {
	expect(eventText(event({ type: 'state.changed', before: luz, after: on }))).toBe('Se encendió')
	expect(eventText(event({ type: 'state.changed', before: on, after: luz }))).toBe('Se apagó')
	const sensor = { ...on, type: 'sensor' as const }
	expect(eventText(event({ type: 'state.changed', before: { ...sensor, state: false }, after: sensor }))).toBe(
		'Se activó',
	)
	expect(
		eventText(event({ type: 'data.changed', before: luz, after: { ...luz, data: { brillo: 40, modo: 'noche' } } })),
	).toBe('Datos: brillo 80 → 40, color quitado, +1 más')
	expect(
		eventText(event({ type: 'device.updated', before: luz, after: { ...luz, name: 'Lámpara', visibility: 'public' } })),
	).toBe('Ajustes: nombre «Luz de la sala» → «Lámpara», ahora es público')
	expect(eventText(event({ type: 'device.updated', before: luz, after: { ...luz, visibility: 'public' } }))).toBe(
		'Ahora es público',
	)
	expect(eventText(event({ type: 'device.created', before: null }))).toBe('Creado')
	expect(dataChanges({ a: true }, { a: false, b: 'x' })).toEqual(['a Sí → No', 'b añadido'])
})

test('whoText: programa, tú, el token por su nombre o «Token» si no está en la lista', () => {
	const tokens = [{ id: 't1', name: 'ESP sala' }] as ApiToken[]
	expect(whoText(event({ type: 'state.changed', source: 'schedule' }), tokens)).toBe('Programa')
	expect(whoText(event({ type: 'state.changed' }), tokens)).toBe('Tú')
	expect(whoText(event({ type: 'state.changed', actor: { kind: 'token', id: 't1' } }), tokens)).toBe('Token «ESP sala»')
	expect(whoText(event({ type: 'state.changed', actor: { kind: 'token', id: 'otro' } }), tokens)).toBe('Token')
	expect(whoText(event({ type: 'state.changed', actor: { kind: 'anonymous', id: null } }))).toBe('Anónimo')
})

test('Actividad agrupa por día y filtra por tipo y por origen (con Programa)', async () => {
	const t = Date.now()
	const ts = (minAgo: number) => new Date(t - minAgo * 60_000).toISOString()
	mockDevice(luz, {
		[`GET ${api()}/events?limit=200`]: () => ({
			body: [
				event({ ts: ts(1), type: 'state.changed', before: luz, after: on, source: 'schedule' }),
				event({ ts: ts(2), type: 'data.changed', after: { ...luz, data: { ...luz.data, brillo: 90 } } }),
				event({ ts: ts(3), type: 'state.changed', before: on, after: luz }),
			],
		}),
	})
	renderApp(`${page()}/actividad`)

	const list = await screen.findByRole('list')
	const texts = () =>
		within(screen.getByRole('list'))
			.getAllByRole('listitem')
			.map((li) => li.textContent)
	expect(screen.getByRole('heading', { level: 3, name: 'Hoy' })).toBeInTheDocument()
	expect(within(list).getAllByRole('listitem')).toHaveLength(3)
	expect(texts()[1]).toContain('Datos: brillo 80 → 90')

	await userEvent.selectOptions(screen.getByLabelText('Origen'), 'Programas')
	expect(texts()).toHaveLength(1)
	expect(texts()[0]).toContain('Se encendióPrograma')

	await userEvent.selectOptions(screen.getByLabelText('Origen'), 'Tú')
	await userEvent.click(screen.getByRole('radio', { name: 'Estado' }))
	expect(texts()).toHaveLength(1)
	expect(texts()[0]).toContain('Se apagóTú')

	await userEvent.click(screen.getByRole('radio', { name: 'Ajustes' }))
	expect(screen.getByText('Nada con estos filtros')).toBeInTheDocument()
	await userEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }))
	expect(texts()).toHaveLength(3)
})
