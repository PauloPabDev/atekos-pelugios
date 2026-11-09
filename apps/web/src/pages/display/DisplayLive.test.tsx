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

test('desconectada: la cabecera, el aviso y la ficha dicen cuándo se la vio por última vez', async () => {
	const lastSeenAt = new Date(Date.now() - 5 * 60_000).toISOString()
	mockDisplay({ [`GET ${base}`]: () => ({ body: { ...detail, lastSeenAt } }) })
	renderApp(page)

	expect(await screen.findByText('Desconectada, última conexión hace 5 minutos')).toBeInTheDocument()
	expect(screen.getByRole('slider', { name: 'Brillo' })).toHaveAccessibleDescription(/hace 5 minutos/)
	const placa = screen.getByRole('region', { name: 'Placa' })
	expect(within(placa).getByText('Sin conexión, última conexión hace 5 minutos')).toBeInTheDocument()
	expect(within(placa).getByText(/aún no ha enviado su ficha/)).toBeInTheDocument()
	expect(within(placa).getByRole('button', { name: 'Pedir ficha' })).toBeDisabled()
})

test('la ficha enseña placa, pantalla y botones, y «Pedir ficha» envía display.info', async () => {
	const bodies: unknown[] = []
	const info = {
		firmware: '1.3.0',
		board: { model: 'Waveshare ESP32-C6-LCD-1.47', chip: 'ESP32-C6', flashBytes: 4_194_304, psramBytes: 0 },
		display: { width: 172, height: 320, touch: false, driver: 'ST7789', color: 'RGB565' },
		buttons: [{ button: 0, name: 'BOOT', gpio: 9 }],
		capabilities: ['text', 'info'],
		receivedAt: new Date().toISOString(),
	}
	mockDisplay({
		[`GET ${base}`]: () => ({ body: { ...detail, online: true, info } }),
		[`POST ${base}/commands`]: (init) => {
			bodies.push(JSON.parse(String(init?.body)))
			return { body: { ok: true } }
		},
	})
	renderApp(page)

	const placa = await screen.findByRole('region', { name: 'Placa' })
	for (const text of ['Waveshare ESP32-C6-LCD-1.47', 'ESP32-C6', '1.3.0', '4 MB', 'No tiene', 'RGB565'])
		expect(within(placa).getByText(text)).toBeInTheDocument()
	expect(within(placa).getByText('172×320 px · ST7789 · sin táctil')).toBeInTheDocument()
	expect(within(placa).getByText(/BOOT/)).toHaveTextContent('0 · BOOT · GPIO 9')
	expect(within(placa).getByRole('list', { name: 'Capacidades' })).toBeInTheDocument()

	await userEvent.click(within(placa).getByRole('button', { name: 'Pedir ficha' }))
	expect(await within(placa).findByText('Pedida: llega en unos segundos.')).toBeInTheDocument()
	expect(bodies).toEqual([{ type: 'display.info' }])
})
