import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Device } from '@atekos/shared'
import { useDeviceSocket } from './useDeviceSocket'

class FakeWebSocket {
	static instances: FakeWebSocket[] = []
	url: string
	sent: string[] = []
	closed = false
	onopen: (() => void) | null = null
	onclose: (() => void) | null = null
	onmessage: ((e: { data: string }) => void) | null = null
	constructor(url: string) {
		this.url = url
		FakeWebSocket.instances.push(this)
	}
	send(msg: string) {
		this.sent.push(msg)
	}
	close() {
		this.closed = true
	}
}
const last = () => FakeWebSocket.instances.at(-1)!

beforeEach(() => {
	FakeWebSocket.instances = []
	vi.stubGlobal('WebSocket', FakeWebSocket)
})
afterEach(() => {
	vi.useRealTimers()
})

const now = new Date().toISOString()
const makeDevice = (id: string, state: boolean): Device => ({
	id,
	ownerId: crypto.randomUUID(),
	slug: 'luz-sala',
	name: 'Luz sala',
	description: '',
	type: 'light',
	state,
	data: {},
	visibility: 'private',
	status: 'active',
	createdAt: now,
	updatedAt: now,
})

function setup(ids: string[], qc = new QueryClient()) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={qc}>{children}</QueryClientProvider>
	)
	return renderHook(() => useDeviceSocket(ids), { wrapper })
}

test('al abrir se suscribe a cada id y un device.updated actualiza la caché', () => {
	const a = crypto.randomUUID()
	const b = crypto.randomUUID()
	const qc = new QueryClient()
	qc.setQueryData(['devices'], [makeDevice(a, false), makeDevice(b, false)])
	const { result } = setup([a, b], qc)

	const ws = last()
	expect(ws.url).toBe(`ws://${location.host}/ws`)
	expect(result.current).toBe('connecting')
	act(() => ws.onopen?.())
	expect(result.current).toBe('live')
	expect(ws.sent.map((m) => JSON.parse(m))).toEqual([
		{ type: 'subscribe', deviceId: a },
		{ type: 'subscribe', deviceId: b },
	])

	const updated = makeDevice(a, true)
	act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'device.updated', device: updated }) }))
	expect(qc.getQueryData(['device', a])).toEqual(updated)
	// la lista de / también se entera (otra pestaña cambió el estado)
	expect(qc.getQueryData<Device[]>(['devices'])?.map((d) => d.state)).toEqual([true, false])
})

test('se reconecta con espera creciente, recarga lo del dispositivo al volver y tras 5 fallos queda offline', () => {
	vi.useFakeTimers()
	const a = crypto.randomUUID()
	const qc = new QueryClient()
	qc.setQueryData(['device', a], makeDevice(a, false))
	qc.setQueryData(['events', a, now], [])
	qc.setQueryData(['display', 'md-1'], {})
	const { result } = setup([a], qc)
	act(() => last().onopen?.())

	act(() => last().onclose?.())
	expect(result.current).toBe('connecting')
	act(() => vi.advanceTimersByTime(1000)) // la primera espera es de 1 s como mucho
	expect(FakeWebSocket.instances).toHaveLength(2)
	act(() => last().onopen?.())
	expect(result.current).toBe('live')
	// el WS no reenvía lo perdido: se recargan el dispositivo y su historial, no lo demás
	expect(qc.getQueryState(['device', a])?.isInvalidated).toBe(true)
	expect(qc.getQueryState(['events', a, now])?.isInvalidated).toBe(true)
	expect(qc.getQueryState(['display', 'md-1'])?.isInvalidated).toBe(false)

	for (let i = 0; i < 5; i++) {
		act(() => last().onclose?.())
		act(() => vi.advanceTimersByTime(30_000))
	}
	expect(result.current).toBe('offline')
	expect(FakeWebSocket.instances).toHaveLength(7) // sigue reintentando
})

test('al desmontar cierra el socket y no reintenta', () => {
	vi.useFakeTimers()
	const { unmount } = setup([crypto.randomUUID()])
	const ws = last()
	act(() => ws.onclose?.())
	unmount()
	act(() => vi.advanceTimersByTime(60_000))
	expect(ws.closed).toBe(true)
	expect(FakeWebSocket.instances).toHaveLength(1)
})
