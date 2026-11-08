import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { DisplayDetail, DisplayTemplate } from '@atekos/shared'
import { mockFetch, renderApp, user } from '../test/utils'

const now = new Date().toISOString()
const inicio: DisplayTemplate = {
	id: 'inicio',
	version: 1,
	elements: [{ type: 'text', x: 10, y: 10, size: 2, bind: 'mensaje' }],
	actions: [],
}
const detail: DisplayDetail = {
	deviceId: 'md-34B7DA01ABCD',
	name: 'Meta',
	activeTemplateId: 'inicio',
	online: false,
	createdAt: now,
	updatedAt: now,
	template: inicio,
	templates: [{ id: 'inicio', version: 1 }],
	values: { mensaje: 'HOLA' },
}
const base = '/api/v1/displays/md-34B7DA01ABCD'

function mockDisplay(extra: Parameters<typeof mockFetch>[0] = {}) {
	return mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		[`GET ${base}`]: () => ({ body: detail }),
		[`GET ${base}/templates`]: () => ({ body: [inicio] }),
		[`GET ${base}/events`]: () => ({ body: [] }),
		...extra,
	})
}

async function typeTemplate(t: unknown) {
	const editor = await screen.findByLabelText('Plantilla (JSON)')
	await userEvent.clear(editor)
	await userEvent.paste(typeof t === 'string' ? t : JSON.stringify(t))
	return editor
}

test('el preview sigue al editor si el JSON es válido; si no, muestra los errores de zod', async () => {
	mockDisplay()
	renderApp('/displays/md-34B7DA01ABCD')

	const preview = () => screen.getByRole('img', { name: /Vista previa/ })
	expect(await screen.findByText('Sin conexión')).toBeInTheDocument()
	expect(within(preview()).getByText('HOLA')).toBeInTheDocument()

	await typeTemplate({ ...inicio, elements: [{ type: 'text', x: 10, y: 10, value: 'NUEVO' }] })
	expect(within(preview()).getByText('NUEVO')).toBeInTheDocument()

	const editor = await typeTemplate({ ...inicio, elements: [{ type: 'text', x: 500, y: 10, value: 'NUEVO' }] })
	expect(editor).toHaveAttribute('aria-invalid', 'true')
	expect(screen.getByRole('alert')).toHaveTextContent('elements.0.x')
	expect(within(preview()).getByText('HOLA')).toBeInTheDocument()
	expect(screen.getByRole('button', { name: 'Guardar y activar' })).toBeDisabled()

	await typeTemplate('{ roto')
	expect(screen.getByRole('alert')).toHaveTextContent('No es JSON válido')
})

test('«Guardar y activar» hace PUT /template con el cuerpo; un 409 se explica y «version +1» lo resuelve', async () => {
	const bodies: unknown[] = []
	const fetch = mockDisplay({
		[`PUT ${base}/template`]: (init) => {
			const body = JSON.parse(String(init?.body)) as DisplayTemplate
			bodies.push(body)
			return body.version > 1
				? { body: detail }
				: { status: 409, body: { error: 'version_not_incremented', message: 'version must increase' } }
		},
	})
	renderApp('/displays/md-34B7DA01ABCD')

	const edited = { ...inicio, elements: [{ type: 'text', x: 10, y: 10, value: 'NUEVO' }] }
	await typeTemplate(edited)
	await userEvent.click(screen.getByRole('button', { name: 'Guardar y activar' }))

	expect(await screen.findByRole('alert')).toHaveTextContent('version +1')
	expect(screen.getByRole('alert')).toHaveTextContent('409 version_not_incremented')
	expect(bodies[0]).toEqual(edited)
	expect(fetch).toHaveBeenCalledWith(`${base}/template`, expect.objectContaining({ method: 'PUT' }))

	await userEvent.click(screen.getByRole('button', { name: 'version +1' }))
	await userEvent.click(screen.getByRole('button', { name: 'Guardar y activar' }))
	expect(await screen.findByText('Guardado.')).toBeInTheDocument()
	expect(bodies[1]).toEqual({ ...edited, version: 2 })
	expect(screen.queryByRole('alert')).toBeNull()
})
