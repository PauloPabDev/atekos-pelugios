import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { nextRun, type Device, type Display, type Schedule, type CreateScheduleInput } from '@atekos/shared'
import { browserZone } from '../../schedules'
import { mockFetch, renderApp, user } from '../../test/utils'

const now = new Date().toISOString()
const device: Device = {
	id: crypto.randomUUID(),
	ownerId: user.id,
	slug: 'luz-sala',
	name: 'Luz de la sala',
	description: '',
	type: 'light',
	state: false,
	data: {},
	visibility: 'private',
	status: 'active',
	createdAt: now,
	updatedAt: now,
}
const api = `/api/v1/devices/${device.id}`
const page = `/devices/${device.id}/programas`

const schedule = (input: CreateScheduleInput, target: Schedule['target'] = { kind: 'device', id: device.id }) =>
	({
		id: crypto.randomUUID(),
		target,
		...input,
		nextRunAt: nextRun(input.when, new Date())?.toISOString() ?? null,
		lastRunAt: null,
		lastResult: null,
		createdAt: now,
	}) as Schedule

beforeEach(() => {
	vi.stubGlobal(
		'WebSocket',
		class {
			send() {}
			close() {}
		},
	)
})

test('crear un programa: laborables a las 7:30, guardar y «Crear también el apagado» prellena el contrario', async () => {
	const list: Schedule[] = []
	const bodies: unknown[] = []
	mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		[`GET ${api}`]: () => ({ body: device }),
		[`GET ${api}/schedules`]: () => ({ body: list }),
		[`POST ${api}/schedules`]: (init) => {
			const body = JSON.parse(String(init?.body)) as CreateScheduleInput
			bodies.push(body)
			list.push(schedule(body))
			return { status: 201, body: list.at(-1) }
		},
	})
	renderApp(page)

	// vacío: sugerencias que dicen su hora, y el alta
	const suggestions = await screen.findByRole('list', { name: 'Sugerencias' })
	expect(within(suggestions).getByRole('link', { name: /Encender al anochecer/ })).toHaveTextContent(
		'Todos los días a las 19:00 → Encender',
	)
	await userEvent.click(screen.getByRole('link', { name: 'Nuevo programa' }))

	expect(await screen.findByRole('heading', { name: 'Nuevo programa' })).toBeInTheDocument()
	expect(screen.getByRole('radio', { name: 'Encender' })).toBeChecked()
	await userEvent.click(screen.getByRole('button', { name: 'Laborables' }))
	expect(screen.getByRole('button', { name: 'Laborables' })).toHaveAttribute('aria-pressed', 'true')
	expect(screen.getByRole('checkbox', { name: 'sábado' })).not.toBeChecked()
	fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '07:30' } })
	// frase viva
	expect(screen.getByText('De lunes a viernes a las 7:30 → Encender', { selector: 'p.text-lg' })).toBeInTheDocument()
	expect(screen.getByText(/^Próxima vez: /)).toBeInTheDocument()

	await userEvent.click(screen.getByRole('button', { name: 'Guardar programa' }))
	expect(await screen.findByRole('status')).toHaveTextContent(/Programa guardado\. Próxima vez: .+ a las 7:30/)
	expect(bodies).toEqual([
		{
			name: '',
			when: { repeat: 'weekly', days: [1, 2, 3, 4, 5], time: '07:30', timezone: browserZone() },
			action: { type: 'device.on' },
			enabled: true,
		},
	])
	expect(screen.getByRole('heading', { name: 'Programas' })).toHaveFocus()
	expect(screen.getByRole('link', { name: 'De lunes a viernes a las 7:30 → Encender' })).toHaveTextContent('07:30')
	expect(screen.getByRole('switch', { name: 'Activo: De lunes a viernes a las 7:30 → Encender' })).toBeChecked()
	expect(sessionStorage.length).toBe(0) // el borrador se fue al guardar

	await userEvent.click(screen.getByRole('link', { name: 'Crear también el apagado' }))
	expect(await screen.findByRole('radio', { name: 'Apagar' })).toBeChecked()
	expect(screen.getByRole('checkbox', { name: 'lunes' })).toBeChecked()
	expect(screen.getByRole('checkbox', { name: 'domingo' })).not.toBeChecked()
	expect(screen.getByLabelText('Hora')).toHaveFocus()
	// a la misma hora que el encendido: avisa, sin bloquear
	expect(screen.getByText(/Choca con «Encender a las 7:30»/)).toBeInTheDocument()
})

test('una sugerencia abre el formulario relleno (2 toques) y un 422 se explica junto al pie', async () => {
	mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		[`GET ${api}`]: () => ({ body: device }),
		[`GET ${api}/schedules`]: () => ({ body: [] }),
		[`POST ${api}/schedules`]: () => ({
			status: 422,
			body: { error: 'too_many_schedules', message: 'Máximo 20 programas por dispositivo' },
		}),
	})
	renderApp(page)

	await userEvent.click(await screen.findByRole('link', { name: /Apagar a medianoche/ }))
	expect(await screen.findByText('Todos los días a las 0:00 → Apagar', { selector: 'p.text-lg' })).toBeInTheDocument()
	await userEvent.click(screen.getByRole('button', { name: 'Guardar programa' }))
	expect(await screen.findByRole('alert')).toHaveTextContent('Has llegado al máximo de programas para este dispositivo')
})

test('/programas: agenda con el destino de cada ejecución y pausar al momento desde la lista', async () => {
	const display: Display = {
		id: crypto.randomUUID(),
		deviceId: 'md-34B7DA01ABCD',
		name: 'Pantalla cocina',
		activeTemplateId: 'inicio',
		online: true,
		lastSeenAt: null,
		createdAt: now,
		updatedAt: now,
	}
	const timezone = browserZone()
	const luz = schedule({
		name: '',
		enabled: true,
		when: { repeat: 'weekly', days: [1, 2, 3, 4, 5, 6, 7], time: '23:59', timezone },
		action: { type: 'device.off' },
	})
	const brillo = schedule(
		{
			name: 'Noche',
			enabled: true,
			when: { repeat: 'weekly', days: [1, 2, 3, 4, 5, 6, 7], time: '23:58', timezone },
			action: { type: 'display.brightness', percent: 5 },
		},
		{ kind: 'display', id: display.deviceId },
	)
	const patches: unknown[] = []
	let current = luz
	mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		'GET /api/v1/schedules': () => ({ body: [current, brillo] }),
		'GET /api/v1/devices': () => ({ body: [device] }),
		'GET /api/v1/displays': () => ({ body: [display] }),
		[`PATCH /api/v1/schedules/${luz.id}`]: (init) => {
			patches.push(JSON.parse(String(init?.body)))
			current = { ...luz, enabled: false, nextRunAt: null }
			return { body: current }
		},
	})
	renderApp('/programas')

	expect(await screen.findByRole('heading', { level: 1, name: 'Programas' })).toBeInTheDocument()
	expect(screen.getByRole('link', { name: 'Programas' })).toHaveAttribute('aria-current', 'page')
	// la fila de la agenda dice qué, a qué hora y en qué destino, y abre el programa en su pantalla
	// diario: sale hoy (o, pasadas las 23:58, mañana) y en los días siguientes
	const rows = await screen.findAllByRole('link', { name: /23:58\s*Brillo al 5 %\s*Pantalla cocina · Noche/ })
	expect(rows[0]).toHaveAttribute('href', `/displays/${display.deviceId}/programas/${brillo.id}`)
	expect(screen.getByRole('link', { name: 'Luz de la sala' })).toHaveAttribute(
		'href',
		`/devices/${device.id}/programas`,
	)

	const sw = screen.getByRole('switch', { name: 'Activo: Todos los días a las 23:59 → Apagar' })
	await userEvent.click(sw)
	expect(sw).not.toBeChecked()
	expect(patches).toEqual([{ enabled: false }])
})
