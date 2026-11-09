import { DISPLAY_MAX_TEMPLATE_BYTES } from '@atekos/shared'
import request from 'supertest'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startStack } from './stack'

let s: Awaited<ReturnType<typeof startStack>>
beforeAll(async () => {
	s = await startStack()
})
afterAll(() => s?.stop())

type OpenApi = { servers: { url: string }[]; paths: Record<string, Record<string, unknown>> }

it('GET /contract/*.json es público y usa el origen de este despliegue', async () => {
	const async = await request(s.url).get('/api/v1/contract/asyncapi.json').expect('content-type', /json/).expect(200)
	expect(async.body.servers.atekos).toMatchObject({ host: new URL(s.url).host, protocol: 'ws', pathname: '/ws/device' })
	const open = await request(s.url).get('/api/v1/contract/openapi.json').expect(200)
	expect(open.body.servers).toEqual([{ url: `${s.url}/api/v1` }])
	// El tope que aplica esta API (DISPLAY_MAX_TEMPLATE_BYTES), no solo el de por defecto del paquete.
	expect(async.body.info['x-max-message-bytes']).toBe(s.c.env.DISPLAY_MAX_TEMPLATE_BYTES)
	expect(open.body.info['x-max-message-bytes']).toBe(DISPLAY_MAX_TEMPLATE_BYTES)
	await request(s.url).get('/api/v1/contract/otra.json').expect(404)
})

// Lo que documenta el contrato existe de verdad: sin credenciales, cada operación da 401 (no el 404 de ruta desconocida).
it('cada operación del OpenAPI existe en la API', async () => {
	const { body } = await request(s.url).get('/api/v1/contract/openapi.json').expect(200)
	const { paths } = body as OpenApi
	const ops = Object.entries(paths).flatMap(([path, item]) =>
		['get', 'post', 'put', 'patch', 'delete'].filter((m) => m in item).map((m) => [m, path] as const),
	)
	expect(ops.length).toBeGreaterThan(10)
	for (const [method, path] of ops) {
		const url = `/api/v1${path.replace('{deviceId}', 'md-000000000001').replace('{templateId}', 'inicio')}`
		const res = await request(s.url)[method as 'get'](url).send({})
		expect(res.status, `${method.toUpperCase()} ${path}`).toBe(path.startsWith('/contract/') ? 200 : 401)
	}
})
