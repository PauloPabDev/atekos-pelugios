import { vi } from 'vitest'
import type { Device, DeviceEvent } from '@atekos/shared'
import { mockFetch, user } from './utils'

// Una luz apagada con dos datos: lo que usan los tests de las pestañas del dispositivo
const now = new Date().toISOString()
export const luz: Device = {
	id: crypto.randomUUID(),
	ownerId: user.id,
	slug: 'luz-sala',
	name: 'Luz de la sala',
	description: '',
	type: 'light',
	state: false,
	data: { brillo: 80, color: 'ámbar' },
	visibility: 'private',
	status: 'active',
	createdAt: now,
	updatedAt: now,
}
export const api = (d: Device = luz) => `/api/v1/devices/${d.id}`
export const page = (d: Device = luz) => `/devices/${d.id}`

export const event = (e: Partial<DeviceEvent> & Pick<DeviceEvent, 'type'>): DeviceEvent => ({
	ts: new Date().toISOString(),
	deviceId: luz.id,
	ownerId: user.id,
	before: luz,
	after: luz,
	actor: { kind: 'user', id: user.id },
	source: 'http',
	...e,
})

// WS de mentira y las cargas de cada pestaña vacías. La telemetría lleva ?from= con la hora del momento:
// se casa sin él («GET …/telemetry?limit=1000»).
export function mockDevice(d: Device = luz, extra: Parameters<typeof mockFetch>[0] = {}) {
	vi.stubGlobal(
		'WebSocket',
		class {
			send() {}
			close() {}
		},
	)
	const fn = mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		'GET /api/v1/tokens': () => ({ body: [] }),
		[`GET ${api(d)}`]: () => ({ body: d }),
		[`GET ${api(d)}/events?limit=8`]: () => ({ body: [] }),
		[`GET ${api(d)}/events?limit=200`]: () => ({ body: [] }),
		[`GET ${api(d)}/telemetry?limit=1000`]: () => ({ body: [] }),
		[`GET ${api(d)}/schedules`]: () => ({ body: [] }),
		...extra,
	})
	vi.stubGlobal('fetch', (url: string, init?: RequestInit) => fn(url.replace(/from=[^&]*&/, ''), init))
	return fn
}
