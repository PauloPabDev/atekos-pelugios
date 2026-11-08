import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, test, vi } from 'vitest'
import type { Device } from '@atekos/shared'
import { useDeviceSocket } from './useDeviceSocket'

class FakeWebSocket {
	static instances: FakeWebSocket[] = []
	url: string
	sent: string[] = []
	onopen: (() => void) | null = null
	onmessage: ((e: { data: string }) => void) | null = null
	constructor(url: string) {
		this.url = url
		FakeWebSocket.instances.push(this)
	}
	send(msg: string) {
		this.sent.push(msg)
	}
	close() {}
}

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

test('al abrir se suscribe a cada id y un device.updated actualiza la caché', () => {
	vi.stubGlobal('WebSocket', FakeWebSocket)
	const a = crypto.randomUUID()
	const b = crypto.randomUUID()
	const qc = new QueryClient()
	qc.setQueryData(['devices'], [makeDevice(a, false), makeDevice(b, false)])
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={qc}>{children}</QueryClientProvider>
	)
	renderHook(() => useDeviceSocket([a, b]), { wrapper })

	const ws = FakeWebSocket.instances[0]!
	expect(ws.url).toBe(`ws://${location.host}/ws`)
	ws.onopen?.()
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
