import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { DeviceEvent, TelemetryReading } from '@atekos/shared'
import { putDevice } from '../../hooks/useDeviceSocket'
import { api, event, luz, mockDevice, page } from '../../test/device'
import { renderApp } from '../../test/utils'
import { metricSeries, sinceText } from './DeviceLive'

test('sinceText: hoy, ayer u otro día', () => {
	const now = new Date(2026, 10, 9, 20, 0)
	expect(sinceText(new Date(2026, 10, 9, 19, 5).toISOString(), now)).toBe('desde las 19:05')
	expect(sinceText(new Date(2026, 10, 8, 23, 30).toISOString(), now)).toBe('desde ayer a las 23:30')
	expect(sinceText(new Date(2026, 10, 5, 7, 0).toISOString(), now)).toBe('desde el jueves 5 de noviembre')
})

test('metricSeries: una serie por métrica aunque alguna lectura no la traiga', () => {
	const r = (ts: string, values: Record<string, number>) => ({ ts, deviceId: luz.id, values })
	const s = metricSeries([
		r('2026-01-01T00:00:00Z', { temp: 20, hum: 50 }),
		r('2026-01-01T00:01:00Z', { temp: 22 }),
		r('2026-01-01T00:02:00Z', { temp: 19, hum: 40 }),
	])
	expect(s.map(({ key, last, min, max, points }) => [key, last, min, max, points.length])).toEqual([
		['temp', 19, 19, 22, 3],
		['hum', 40, 40, 50, 2],
	])
})

test('la tarjeta es el interruptor: cambia al momento, aria-busy mientras guarda y vuelve atrás si falla', async () => {
	let fail = false
	mockDevice(luz, {
		[`POST ${api()}/toggle`]: () =>
			fail ? { status: 503, body: { error: 'x', message: 'Sin conexión' } } : { body: { ...luz, state: true } },
	})
	// El POST espera a que el test lo suelte
	let release = () => {}
	const hold = () => new Promise<void>((r) => (release = r))
	let gate = hold()
	const fetch = globalThis.fetch
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		if (init?.method === 'POST') await gate
		return fetch(url, init)
	})
	renderApp(page())

	const tile = await screen.findByRole('switch', { name: luz.name })
	expect(tile).toHaveTextContent('Toca para encender')
	await userEvent.click(tile)
	await waitFor(() => expect(tile).toHaveAttribute('aria-checked', 'true'))
	expect(tile).toHaveAttribute('aria-busy', 'true')
	act(() => release())
	await waitFor(() => expect(tile).toHaveAttribute('aria-busy', 'false'))
	expect(tile).toHaveAttribute('aria-checked', 'true')

	fail = true
	gate = hold()
	await userEvent.click(tile)
	await waitFor(() => expect(tile).toHaveAttribute('aria-checked', 'false'))
	act(() => release())
	expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión')
	expect(tile).toHaveAttribute('aria-checked', 'true')
})

test('lo que llega en vivo entra con destello y se anuncia resumido', async () => {
	let events: DeviceEvent[] = []
	mockDevice(luz, {
		'GET /api/v1/tokens': () => ({ body: [{ id: 't1', name: 'ESP sala' }] }),
		[`GET ${api()}/events?limit=8`]: () => ({ body: events }),
	})
	const qc = renderApp(page())
	expect(await screen.findByText('Sin cambios todavía.')).toBeInTheDocument()

	const on = {
		...luz,
		state: true,
		data: { ...luz.data, brillo: 95 },
		updatedAt: new Date(Date.now() + 1000).toISOString(),
	}
	events = [event({ type: 'state.changed', before: luz, after: on, actor: { kind: 'token', id: 't1' } })]
	act(() => putDevice(qc, on))

	const row = await screen.findByText('Se encendió')
	expect(row.closest('li')).toHaveClass('motion-safe:animate-flash')
	expect(await screen.findByText('«Luz de la sala»: se encendió · Token «ESP sala»')).toHaveAttribute('role', 'status')
	// la clave de data que cambió también destella
	expect(screen.getByText('brillo').parentElement).toHaveClass('motion-safe:animate-flash')
	expect(screen.getByText('color').parentElement).not.toHaveClass('motion-safe:animate-flash')
})

test('sensor: la tarjeta no es un interruptor (va en la cabecera) y sus lecturas tienen minigráfica y rótulo honesto', async () => {
	const sensor = { ...luz, type: 'sensor' as const, state: true }
	const t = Date.now()
	// 1000 lecturas, una por minuto: el tope de la API, que no llega a cubrir 24 h
	const readings: TelemetryReading[] = Array.from({ length: 1000 }, (_, i) => ({
		ts: new Date(t - (999 - i) * 60_000).toISOString(),
		deviceId: sensor.id,
		values: { temp: i === 999 ? 21.5 : 19 + (i % 3) },
	}))
	mockDevice(sensor, { [`GET ${api(sensor)}/telemetry?limit=1000`]: () => ({ body: readings }) })
	renderApp(page(sensor))

	const chart = await screen.findByRole('img', { name: /^temp: 21,5 ahora; mínimo 19 y máximo 21,5/ })
	expect(chart).toBeInTheDocument()
	expect(screen.getByText(/cubren las últimas 17 h/)).toBeInTheDocument()
	// un solo interruptor con su nombre, en la cabecera; la tarjeta solo informa
	const [only] = screen.getAllByRole('switch', { name: sensor.name })
	expect(only).not.toHaveTextContent('Activo')
	expect(screen.getAllByRole('switch', { name: sensor.name })).toHaveLength(1)
	expect(screen.getByText('Activo')).toBeInTheDocument()
})
