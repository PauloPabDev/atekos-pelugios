import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { api, luz, mockDevice, page } from '../../test/device'
import { renderApp } from '../../test/utils'

test('Ajustes cambia el tipo y la visibilidad, y explica qué ve cualquiera si es público', async () => {
	const fn = mockDevice(luz, {
		[`PATCH ${api()}`]: () => ({ body: { ...luz, type: 'switch', visibility: 'public' } }),
	})
	renderApp(`${page()}/ajustes`)

	const save = await screen.findByRole('button', { name: 'Guardar cambios' })
	expect(save).toBeDisabled()
	expect(screen.getByRole('radio', { name: 'Público' })).toHaveAccessibleDescription(
		/Cualquiera con el enlace ve su estado, sus datos y su historial/,
	)
	expect(screen.queryByRole('link', { name: 'Ver página pública' })).toBeNull()

	await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'Interruptor')
	await userEvent.click(screen.getByRole('radio', { name: 'Público' }))
	await userEvent.click(save)

	expect(await screen.findByText('Guardado.')).toBeInTheDocument()
	const patch = fn.mock.calls.find(([, init]) => init?.method === 'PATCH')
	expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
		name: luz.name,
		type: 'switch',
		description: '',
		visibility: 'public',
	})
	// ya guardado como público: su página y el enlace
	expect(screen.getByRole('link', { name: 'Ver página pública' })).toHaveAttribute('href', `/p/${luz.id}`)
	expect(screen.getByRole('button', { name: 'Copiar enlace' })).toBeInTheDocument()
	// para programadores: slug e id con su botón de copiar, y los tokens
	expect(screen.getByRole('button', { name: 'Copiar slug' })).toBeInTheDocument()
	expect(screen.getByRole('button', { name: 'Copiar id' })).toBeInTheDocument()
	expect(screen.getByRole('link', { name: 'Gestionar tokens ›' })).toHaveAttribute('href', '/tokens')
})
