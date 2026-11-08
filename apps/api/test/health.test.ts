import request from 'supertest'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startStack } from './stack'

let s: Awaited<ReturnType<typeof startStack>>
beforeAll(async () => {
	s = await startStack()
})
afterAll(() => s?.stop())

it('/health responde 200 con PG, Mongo y Redis reales', async () => {
	await request(s.url).get('/api/v1/health').expect(200, { status: 'ok' })
})

it('al arrancar migra PG y crea las colecciones time-series de Mongo', async () => {
	const { rows } = await s.c.pool.query<{ tablename: string }>(
		"select tablename from pg_tables where schemaname = 'public' order by tablename",
	)
	expect(rows.map((r) => r.tablename)).toEqual(['api_tokens', 'devices', 'users'])
	const cols = await s.c.mongo.listCollections({ type: 'timeseries' }, { nameOnly: true }).toArray()
	expect(cols.map((col) => col.name).sort()).toEqual(['device_events', 'telemetry'])
})

it('una ruta /api desconocida da 404 JSON y una escritura no JSON da 415', async () => {
	await request(s.url).get('/api/v1/nada').expect(404, { error: 'not_found', message: 'Recurso no encontrado' })
	await request(s.url).post('/api/v1/health').type('text/plain').send('hola').expect(415)
})
