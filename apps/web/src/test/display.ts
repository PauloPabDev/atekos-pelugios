import type { DisplayDetail, DisplayTemplate } from '@atekos/shared'
import { mockFetch, user } from './utils'

// Una pantalla «Meta» desconectada con la plantilla «inicio» activa: lo que usan los tests de sus pestañas
const now = new Date().toISOString()
export const inicio: DisplayTemplate = {
	id: 'inicio',
	version: 1,
	elements: [{ type: 'text', x: 10, y: 10, size: 2, bind: 'mensaje' }],
	actions: [],
}
export const detail: DisplayDetail = {
	id: crypto.randomUUID(),
	deviceId: 'md-34B7DA01ABCD',
	name: 'Meta',
	activeTemplateId: 'inicio',
	online: false,
	createdAt: now,
	updatedAt: now,
	template: inicio,
	templates: [{ id: 'inicio', version: 1 }],
	values: { mensaje: 'HOLA' },
}
export const page = '/displays/md-34B7DA01ABCD'
export const base = `/api/v1${page}`

export function mockDisplay(extra: Parameters<typeof mockFetch>[0] = {}) {
	return mockFetch({
		'GET /api/v1/auth/me': () => ({ body: user }),
		[`GET ${base}`]: () => ({ body: detail }),
		[`GET ${base}/templates`]: () => ({ body: [inicio] }),
		[`GET ${base}/events`]: () => ({ body: [] }),
		...extra,
	})
}
