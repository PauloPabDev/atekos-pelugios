import pino from 'pino'
import request from 'supertest'
import { expect, it } from 'vitest'
import { buildApp } from '../src/app'
import type { Container } from '../src/container'

// Sin Docker: solo lo que /health y el rate limit usan. El ping a Redis «cuelga» como cuando node-redis encola comandos mientras reconecta.
const fake = {
	logger: pino({ level: 'silent' }),
	pool: { query: async () => ({}) },
	mongo: { command: async () => Promise.reject(new Error('caído')) },
	redis: { ping: () => new Promise(() => {}), incr: async () => 1, expire: async () => 1 },
} as unknown as Container
const app = buildApp(fake)

it('/health da 503 e indica qué falló, aunque un ping no responda nunca', async () => {
	const { body } = await request(app).get('/api/v1/health').expect(503)
	expect(body).toEqual({ status: 'error', failed: ['mongo', 'redis'] })
})

it('una escritura sin cuerpo (Content-Length: 0, como el ESP) no da 415', async () => {
	await request(app).post('/api/v1/health').set('content-length', '0').expect(404)
})
