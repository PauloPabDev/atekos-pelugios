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
	// En el móvil, el error se nombra también en el selector de panel (no solo con color)
	expect(screen.getByRole('radio', { name: 'Código (1 error)' })).toBeChecked()
})

test('«Guardar y activar» sube la versión sola; un 409 por una carrera se explica y el reintento funciona', async () => {
	const bodies: DisplayTemplate[] = []
	const fetch = mockDisplay({
		[`PUT ${base}/template`]: (init) => {
			bodies.push(JSON.parse(String(init?.body)) as DisplayTemplate)
			return bodies.length > 1
				? { body: detail }
				: { status: 409, body: { error: 'version_not_incremented', message: 'version must increase' } }
		},
	})
	renderApp(`${page}/plantillas/inicio`)

	const edited = { ...inicio, elements: [{ type: 'text', x: 10, y: 10, value: 'NUEVO' }] }
	await typeTemplate(edited)
	expect(screen.getByText(/v1 → se guardará como v2/)).toHaveTextContent('Sin guardar')
	expect(screen.queryByRole('button', { name: 'version +1' })).toBeNull()
	await userEvent.click(screen.getByRole('button', { name: 'Guardar y activar' }))

	expect(await screen.findByRole('alert')).toHaveTextContent('vuelve a guardar')
	expect(screen.getByRole('alert')).toHaveTextContent('409 version_not_incremented')
	expect(bodies[0]).toEqual({ ...edited, version: 2 })
	expect(fetch).toHaveBeenCalledWith(`${base}/template`, expect.objectContaining({ method: 'PUT' }))

	await userEvent.click(screen.getByRole('button', { name: 'Guardar y activar' }))
	expect(await screen.findByText('Guardada como v2.')).toBeInTheDocument()
	expect(bodies[1]).toEqual({ ...edited, version: 2 })
	expect(screen.queryByRole('alert')).toBeNull()
})

test('una plantilla nueva parte de un id libre y, al guardarla, pasa a su editor con el foco en el título', async () => {
	const templates = [inicio]
	mockDisplay({
		[`GET ${base}`]: () => ({
			body: { ...detail, templates: templates.map(({ id, version }) => ({ id, version })) },
		}),
		[`GET ${base}/templates`]: () => ({ body: templates }),
		[`PUT ${base}/templates/plantilla-2`]: (init) => {
			templates.push(JSON.parse(String(init?.body)) as DisplayTemplate)
			return { body: detail }
		},
	})
	renderApp(`${page}/plantillas/nueva`)

	expect(await screen.findByLabelText('Plantilla (JSON)')).toHaveValue(
		JSON.stringify({ id: 'plantilla-2', version: 1, elements: [], actions: [] }, null, 2),
	)
	expect(screen.getByText('Se guardará como v1.')).toBeInTheDocument()
	await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

	expect(await screen.findByRole('heading', { name: 'Editar «plantilla-2»' })).toHaveFocus()
	expect(screen.getByText('Guardada como v1.')).toBeInTheDocument()
	expect(screen.getByText(/v1 → se guardará como v2/)).toBeInTheDocument()
})
