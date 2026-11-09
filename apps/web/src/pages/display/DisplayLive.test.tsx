import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { base, detail, mockDisplay, page, touch } from '../../test/display'
import { renderApp } from '../../test/utils'

test('sin conexión: enseña lo guardado y desactiva brillo y refresco con la explicación', async () => {
	mockDisplay({ [`GET ${base}/events`]: () => ({ body: [touch({ toast: 'Hola' })] }) })
	renderApp(page)

	expect(await screen.findByRole('heading', { name: 'Así se ve ahora' })).toBeInTheDocument()
	expect(within(screen.getByRole('img', { name: /Vista previa/ })).getByText('HOLA')).toBeInTheDocument()
	const slider = screen.getByRole('slider', { name: 'Brillo' })
	expect(slider).toBeDisabled()
	expect(slider).toHaveAccessibleDescription(/no está conectada/)
	expect(screen.getByRole('button', { name: 'Refrescar pantalla' })).toBeDisabled()
	expect(await screen.findByText('Toque · «Hola»')).toBeInTheDocument()
})

test('en línea: el brillo se envía al soltar y se recuerda como el último enviado', async () => {
	const bodies: unknown[] = []
	mockDisplay({
		[`GET ${base}`]: () => ({ body: { ...detail, online: true } }),
		[`POST ${base}/commands`]: (init) => {
			bodies.push(JSON.parse(String(init?.body)))
			return { body: { ok: true } }
		},
	})
	renderApp(page)

	const slider = await screen.findByRole('slider', { name: 'Brillo' })
	expect(slider).toHaveAccessibleDescription(/aún no has enviado ninguno/)
	fireEvent.change(slider, { target: { value: '10' } })
	fireEvent.pointerUp(slider)
	expect(await screen.findByText('Brillo enviado.')).toBeInTheDocument()
	expect(bodies).toEqual([{ type: 'display.brightness', percent: 10 }])
	expect(slider).toHaveAccessibleDescription(/último enviado, 10 %/)

	await userEvent.click(screen.getByRole('button', { name: 'Refrescar pantalla' }))
	expect(await screen.findByText('Refresco enviado.')).toBeInTheDocument()
	expect(bodies[1]).toEqual({ type: 'display.refresh' })
})
