import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { base, detail, mockDisplay, page } from '../../test/display'
import { renderApp } from '../../test/utils'

test('Ajustes renombra, copia el id de hardware y enlaza a crear su token', async () => {
	const bodies: unknown[] = []
	mockDisplay({
		[`PATCH ${base}`]: (init) => {
			bodies.push(JSON.parse(String(init?.body)))
			return { body: detail }
		},
	})
	renderApp(`${page}/ajustes`)

	const nameInput = await screen.findByRole('textbox', { name: 'Nombre' })
	await userEvent.clear(nameInput)
	await userEvent.type(nameInput, 'Cocina')
	await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
	expect(await screen.findByText('Guardado.')).toBeInTheDocument()
	expect(bodies).toEqual([{ name: 'Cocina' }])

	// userEvent.setup() pone un portapapeles de mentira en navigator
	const clip = userEvent.setup()
	await clip.click(screen.getByRole('button', { name: 'Copiar' }))
	expect(await screen.findByText('Copiado.')).toBeInTheDocument()
	expect(await navigator.clipboard.readText()).toBe(detail.deviceId)

	expect(screen.getByRole('link', { name: 'Crear token para esta pantalla' })).toHaveAttribute(
		'href',
		`/tokens?pantalla=${detail.id}`,
	)
	expect(screen.getByRole('button', { name: 'Borrar pantalla' })).toBeInTheDocument()
})
