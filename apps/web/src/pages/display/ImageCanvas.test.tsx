import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { encodeImage } from '@atekos/shared'
import { base, inicio, mockDisplay, page } from '../../test/display'
import { renderApp } from '../../test/utils'

// jsdom no tiene canvas 2D: el lienzo se abre igual, lo avisa y no deja insertar; el resto del formulario funciona
test('el lienzo sin canvas 2D avisa, valida el tamaño y carga una imagen del borrador para reemplazarla', async () => {
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
	const image = { type: 'image', x: 4, y: 6, w: 2, h: 2, ...encodeImage(new Array(16).fill(255), 2, 2) }
	mockDisplay({ [`GET ${base}/templates`]: () => ({ body: [{ ...inicio, elements: [image] }] }) })
	renderApp(`${page}/plantillas/inicio`)

	await userEvent.click(await screen.findByRole('button', { name: 'Lienzo e imagen' }))
	const dialog = within(screen.getByRole('dialog', { name: 'Lienzo e imagen' }))
	expect(dialog.getByRole('alert')).toHaveTextContent('no permite dibujar en un canvas 2D')
	expect(dialog.getByRole('button', { name: 'Lápiz' })).toHaveAttribute('aria-pressed', 'true')
	expect(dialog.getByLabelText('Ancho')).toHaveValue(172)
	expect(dialog.getByLabelText('Alto')).toHaveValue(320)
	expect(dialog.getByRole('button', { name: 'Añadir a la plantilla' })).toBeDisabled()

	await userEvent.click(dialog.getByRole('button', { name: 'Borrador' }))
	expect(dialog.getByRole('button', { name: 'Borrador' })).toHaveAttribute('aria-pressed', 'true')
	expect(dialog.getByRole('button', { name: 'Lápiz' })).toHaveAttribute('aria-pressed', 'false')

	await userEvent.clear(dialog.getByLabelText('x'))
	await userEvent.type(dialog.getByLabelText('x'), '10')
	expect(dialog.getByText(/No cabe a lo ancho: x \+ ancho = 182 px/)).toBeInTheDocument()
	await userEvent.click(dialog.getByRole('button', { name: 'Mitad inferior' }))
	expect(dialog.queryByText(/No cabe/)).toBeNull()
	expect(dialog.getByLabelText('y')).toHaveValue(160)

	await userEvent.selectOptions(dialog.getByLabelText('Imagen'), 'Editar imagen n.º 1 (4,6 2×2)')
	expect(dialog.getByLabelText('x')).toHaveValue(4)
	expect(dialog.getByLabelText('Ancho')).toHaveValue(2)
	expect(dialog.getByRole('button', { name: 'Reemplazar imagen' })).toBeDisabled()
	expect(dialog.queryByLabelText('Como fondo (debajo de todo)')).toBeNull()

	await userEvent.click(dialog.getByRole('button', { name: 'Cerrar' }))
	expect(screen.queryByRole('dialog')).toBeNull()
})
