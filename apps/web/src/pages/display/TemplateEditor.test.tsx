import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import type { DisplayTemplate } from '@atekos/shared'
import { base, detail, inicio, mockDisplay, page } from '../../test/display'
import { renderApp } from '../../test/utils'

async function typeTemplate(t: unknown) {
	const editor = await screen.findByLabelText('Plantilla (JSON)')
	await userEvent.clear(editor)
	await userEvent.paste(typeof t === 'string' ? t : JSON.stringify(t))
	return editor
}

test('el preview sigue al editor si el JSON es válido; si no, muestra los errores de zod', async () => {
	mockDisplay()
	renderApp(`${page}/plantillas/inicio`)

	const preview = () => screen.getByRole('img', { name: /Vista previa/ })
	expect(await screen.findByText('Sin conexión')).toBeInTheDocument()
	// el editor carga la plantilla de /templates después de la cabecera
	expect(within(await screen.findByRole('img', { name: /Vista previa/ })).getByText('HOLA')).toBeInTheDocument()

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
	renderApp(`${page}/plantillas/inicio`)

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
