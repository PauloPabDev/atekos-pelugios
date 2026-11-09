import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { luz, mockDevice, page } from '../../test/device'
import { renderApp } from '../../test/utils'

test('cada pestaña es una ruta: aria-current, título del documento e interruptor fuera de En vivo', async () => {
	mockDevice()
	renderApp(`${page()}/ajustes`)

	const tabs = await screen.findByRole('navigation', { name: 'Secciones de «Luz de la sala»' })
	expect(screen.getByRole('link', { name: 'Ajustes' })).toHaveAttribute('aria-current', 'page')
	expect(screen.getByRole('link', { name: 'En vivo' })).not.toHaveAttribute('aria-current')
	// la pestaña principal sigue marcada en las subrutas
	expect(screen.getByRole('link', { name: 'Dispositivos' })).toHaveClass('text-fg')
	expect(document.title).toBe('Ajustes · Luz de la sala · atekos')
	// Ajustes ya no es un formulario con título «Ajustes»: la primera tarjeta es «General»
	expect(screen.getByRole('heading', { level: 2, name: 'General' })).toBeInTheDocument()
	// fuera de En vivo, el interruptor va en la cabecera
	expect(screen.getAllByRole('switch', { name: luz.name })).toHaveLength(1)

	await userEvent.click(screen.getByRole('link', { name: 'En vivo' }))
	expect(tabs.querySelector('[aria-current="page"]')).toHaveTextContent('En vivo')
	expect(document.title).toBe('En vivo · Luz de la sala · atekos')
	// en En vivo solo está el de la página: nunca dos controles con el mismo nombre
	expect(screen.getAllByRole('switch', { name: luz.name })).toHaveLength(1)
})
