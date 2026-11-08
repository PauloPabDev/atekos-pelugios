import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { CreatedApiToken, Device, WsServerMessage, type Scope } from '@atekos/shared'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { devices } from '../src/db/schema'
import { startStack } from './stack'

let s: Awaited<ReturnType<typeof startStack>>
beforeAll(async () => {
	s = await startStack()
}, 180_000)
afterAll(() => s?.stop())

const api = (path: string) => `/api/v1${path}`
const wsUrl = (query = '') => `${s.url.replace('http', 'ws')}/ws${query}`

// Espera el siguiente mensaje de ese tipo (validado con el esquema de shared); falla si no llega a tiempo.
const nextMessage = <T extends WsServerMessage['type']>(ws: WebSocket, type: T, ms = 5000) =>
	new Promise<Extract<WsServerMessage, { type: T }>>((resolve, reject) => {
		const timer = setTimeout(() => {
			ws.off('message', onMessage)
			reject(new Error(`no llegó ${type} en ${ms} ms`))
		}, ms)
		function onMessage(raw: WebSocket.RawData) {
			const m = WsServerMessage.parse(JSON.parse(raw.toString()))
			if (m.type !== type) return
			clearTimeout(timer)
			ws.off('message', onMessage)
			resolve(m as Extract<WsServerMessage, { type: T }>)
		}
		ws.on('message', onMessage)
	})

async function connect(opts: { headers?: Record<string, string>; query?: string } = {}) {
	const ws = new WebSocket(wsUrl(opts.query), { headers: opts.headers })
	await once(ws, 'open', { signal: AbortSignal.timeout(5000) })
	return ws
}

const sendJson = (ws: WebSocket, msg: unknown) => ws.send(JSON.stringify(msg))

async function subscribe(ws: WebSocket, deviceId: string) {
	const ack = nextMessage(ws, 'subscribed')
	sendJson(ws, { type: 'subscribe', deviceId })
	expect(await ack).toEqual({ type: 'subscribed', deviceId })
}

// Todo lo que reciba el socket a partir de ahora, para comprobar que no llega nada.
function collect(ws: WebSocket) {
	const received: unknown[] = []
	ws.on('message', (raw) => received.push(JSON.parse(raw.toString())))
	return received
}

// Status del handshake rechazado; falla si el WS llega a abrirse.
const handshakeStatus = (url: string, headers?: Record<string, string>) =>
	new Promise<number>((resolve, reject) => {
		const ws = new WebSocket(url, { headers })
		ws.on('unexpected-response', (req, res) => {
			resolve(res.statusCode!)
			req.destroy()
		})
		ws.on('open', () => reject(new Error('el WS se abrió')))
		ws.on('error', reject)
	})

let n = 0
async function registered() {
	n++
	const agent = request.agent(s.url)
	const res = await agent
		.post(api('/auth/register'))
		.send({ email: `ws${n}@x.com`, username: `ws${n}`, password: 'clave-larga-123' })
		.expect(201)
	return { agent, cookie: res.get('Set-Cookie')![0]!.split(';')[0]! }
}

async function create(agent: request.Agent, body: Record<string, unknown> = {}) {
	n++
	const res = await agent
		.post(api('/devices'))
		.send({ slug: `d${n}`, name: 'Luz', type: 'light', visibility: 'private', ...body })
		.expect(201)
	return Device.parse(res.body)
}

async function token(agent: request.Agent, scopes: Scope[], deviceId?: string) {
	const res = await agent.post(api('/tokens')).send({ name: 'esp', scopes, deviceId }).expect(201)
	return CreatedApiToken.parse(res.body).token
}

const stateInPg = async (id: string) =>
	(await s.c.db.select({ state: devices.state }).from(devices).where(eq(devices.id, id)))[0]!.state

it('privado: anónimo no lo ve; el token del ESP hace toggle y el WS lo recibe', async () => {
	const owner = request.agent(s.url)
	await owner
		.post('/api/v1/auth/register')
		.send({ email: 'a@x.com', username: 'a', password: 'clave-larga-123' })
		.expect(201)
	const { body: dev } = await owner
		.post('/api/v1/devices')
		.send({ slug: 'cuarto', name: 'Luz cuarto', type: 'light', visibility: 'private' })
		.expect(201)

	await request(s.url).get(`/api/v1/devices/${dev.id}/state`).expect(404)

	const { body: tok } = await owner
		.post('/api/v1/tokens')
		.send({ name: 'esp', scopes: ['devices:read', 'devices:write'], deviceId: dev.id })
		.expect(201)
	const auth = { authorization: `Bearer ${tok.token}` }

	const ws = new WebSocket(wsUrl(), { headers: auth })
	await once(ws, 'open', { signal: AbortSignal.timeout(5000) })
	ws.send(JSON.stringify({ type: 'subscribe', deviceId: dev.id }))
	await nextMessage(ws, 'subscribed')

	const updated = nextMessage(ws, 'device.updated')
	await request(s.url).post(`/api/v1/devices/${dev.id}/toggle`).set(auth).expect(200)

	expect((await updated).device.state).toBe(true)
	expect(await s.c.mongo.collection('device_events').countDocuments({ deviceId: dev.id, type: 'state.changed' })).toBe(
		1,
	)
	expect(JSON.parse((await s.c.redis.get(`device:${dev.id}`))!)).toMatchObject({ state: true })
	ws.close()
})

describe('ws', () => {
	it('un mensaje que no es JSON o de tipo desconocido da bad_message y el socket sigue abierto', async () => {
		const ws = await connect()
		for (const bad of ['no-json', JSON.stringify({ type: 'nope' })]) {
			const err = nextMessage(ws, 'error')
			ws.send(bad)
			expect(await err).toMatchObject({ type: 'error', code: 'bad_message' })
			expect(ws.readyState).toBe(WebSocket.OPEN)
			const pong = nextMessage(ws, 'pong')
			sendJson(ws, { type: 'ping' })
			expect(await pong).toEqual({ type: 'pong' })
		}
		ws.close()
	})

	it('una trama de más de 32 KB cierra ese socket con 1009 y la API sigue viva', async () => {
		const ws = await connect()
		const closed = once(ws, 'close', { signal: AbortSignal.timeout(5000) })
		ws.send('x'.repeat(33 * 1024))
		const [code] = await closed
		expect(code).toBe(1009)
		await request(s.url).get(api('/health')).expect(200)
		const other = await connect()
		const pong = nextMessage(other, 'pong')
		sendJson(other, { type: 'ping' })
		expect(await pong).toEqual({ type: 'pong' })
		other.close()
	})

	it('un token ligado al dispositivo A no puede hacer toggle de B por WS', async () => {
		const { agent } = await registered()
		const devA = await create(agent)
		const devB = await create(agent)
		const ws = await connect({
			headers: { authorization: `Bearer ${await token(agent, ['devices:read', 'devices:write'], devA.id)}` },
		})

		await subscribe(ws, devA.id)
		const updated = nextMessage(ws, 'device.updated')
		sendJson(ws, { type: 'toggle', deviceId: devA.id })
		expect((await updated).device).toMatchObject({ id: devA.id, state: true })

		const err = nextMessage(ws, 'error')
		sendJson(ws, { type: 'toggle', deviceId: devB.id })
		expect(await err).toMatchObject({ code: 'not_found' })
		expect(await stateInPg(devB.id)).toBe(false)
		ws.close()
	})

	it('un dispositivo que pasa de público a privado deja de notificar a los anónimos', async () => {
		const { agent, cookie } = await registered()
		const d = await create(agent, { visibility: 'public' })
		const anonWs = await connect()
		const ownerWs = await connect({ headers: { cookie } })
		await subscribe(anonWs, d.id)
		await subscribe(ownerWs, d.id)

		// Mientras es público, el anónimo recibe los cambios.
		const seen = nextMessage(anonWs, 'device.updated')
		await agent.post(api(`/devices/${d.id}/toggle`)).expect(200)
		expect((await seen).device.state).toBe(true)

		const received = collect(anonWs)
		const patched = nextMessage(ownerWs, 'device.updated')
		await agent
			.patch(api(`/devices/${d.id}`))
			.send({ visibility: 'private' })
			.expect(200)
		expect((await patched).device.visibility).toBe('private')
		const toggled = nextMessage(ownerWs, 'device.updated')
		await agent.post(api(`/devices/${d.id}/toggle`)).expect(200)
		expect((await toggled).device.state).toBe(false)

		await sleep(500)
		expect(received).toEqual([])
		anonWs.close()
		ownerWs.close()
	})

	it('un anónimo no puede suscribirse a un privado', async () => {
		const { agent } = await registered()
		const d = await create(agent)
		const ws = await connect()
		const err = nextMessage(ws, 'error')
		sendJson(ws, { type: 'subscribe', deviceId: d.id })
		expect(await err).toMatchObject({ code: 'not_found' })
		ws.close()
	})

	it('handshake: token inválido → 401 (header o ?token=); ?token= válido sí entra; otra ruta se corta', async () => {
		expect(await handshakeStatus(wsUrl(), { authorization: 'Bearer dmt_invalido' })).toBe(401)
		expect(await handshakeStatus(wsUrl('?token=dmt_invalido'))).toBe(401)

		const { agent } = await registered()
		const d = await create(agent)
		const ws = await connect({ query: `?token=${await token(agent, ['devices:read'], d.id)}` })
		await subscribe(ws, d.id) // es privado: solo entra si el token se usó
		ws.close()

		const other = new WebSocket(`${s.url.replace('http', 'ws')}/otra`)
		await expect(once(other, 'open', { signal: AbortSignal.timeout(5000) })).rejects.toThrow()
	})

	it('toggle y set por WS con la cookie del dueño notifican a otro suscriptor; tras unsubscribe ya no', async () => {
		const { agent, cookie } = await registered()
		const d = await create(agent)
		const ownerWs = await connect({ headers: { cookie } })
		const espWs = await connect({ headers: { authorization: `Bearer ${await token(agent, ['devices:read'], d.id)}` } })
		await subscribe(espWs, d.id)

		let updated = nextMessage(espWs, 'device.updated')
		sendJson(ownerWs, { type: 'toggle', deviceId: d.id })
		expect((await updated).device.state).toBe(true)

		updated = nextMessage(espWs, 'device.updated')
		sendJson(ownerWs, { type: 'set', deviceId: d.id, state: false })
		expect((await updated).device.state).toBe(false)
		expect(await stateInPg(d.id)).toBe(false)

		sendJson(espWs, { type: 'unsubscribe', deviceId: d.id })
		// Los mensajes de un socket se procesan en orden: el pong confirma que el unsubscribe ya se aplicó.
		const pong = nextMessage(espWs, 'pong')
		sendJson(espWs, { type: 'ping' })
		await pong
		const received = collect(espWs)
		sendJson(ownerWs, { type: 'toggle', deviceId: d.id })
		await expect.poll(() => stateInPg(d.id)).toBe(true)
		await sleep(500)
		expect(received).toEqual([])
		ownerWs.close()
		espWs.close()
	})
})
