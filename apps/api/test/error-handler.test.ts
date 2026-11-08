import express from 'express'
import pino from 'pino'
import { pinoHttp } from 'pino-http'
import request from 'supertest'
import { z } from 'zod'
import { expect, it } from 'vitest'
import { errorHandler } from '../src/app'
import { Conflict } from '../src/shared/errors'

// Sin Docker: una app mínima con rutas que lanzan cada tipo de error.
const app = express()
app.use(pinoHttp({ logger: pino({ level: 'silent' }) }))
app.use(express.json())
app.get('/app-error', () => {
	throw Conflict('ya existe')
})
app.get('/zod', () => {
	z.object({ n: z.number() }).parse({ n: 'x' })
})
app.get('/boom', async () => {
	throw new Error('detalle interno')
})
app.post('/json', (_req, res) => {
	res.json({})
})
app.use(errorHandler)

it('AppError → su status y código', async () => {
	await request(app).get('/app-error').expect(409, { error: 'conflict', message: 'ya existe' })
})

it('ZodError → 400 validation con los issues', async () => {
	const { body } = await request(app).get('/zod').expect(400)
	expect(body.error).toBe('validation')
	expect(body.issues[0].path).toEqual(['n'])
})

it('error desconocido (también async) → 500 sin filtrar el mensaje', async () => {
	await request(app).get('/boom').expect(500, { error: 'internal', message: 'Error interno' })
})

it('JSON mal formado → 400, no 500', async () => {
	const { body } = await request(app).post('/json').type('application/json').send('{no-json').expect(400)
	expect(body.error).toBe('invalid_body')
})
