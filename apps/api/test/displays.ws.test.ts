import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import {
	CreatedApiToken,
	DISPLAY_MAX_FRAME,
	Display,
	DisplayDetail,
	DisplayEvent,
	encodeBase64,
	type DisplayTemplate,
	type Scope,
} from '@atekos/shared'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { startStack } from './stack'

const example = (name: string) =>
	JSON.parse(readFileSync(new URL(`../../../docs/metadisplay/examples/${name}`, import.meta.url), 'utf8'))
const goal: DisplayTemplate = example('goal-template.json')
const status: DisplayTemplate = example('status-template.json')
const goalData = example('goal-data.json')

type Msg = { type: string } & Record<string, unknown>
let s: Awaited<ReturnType<typeof startStack>>
beforeAll(async () => {
	s = await startStack()
}, 180_000)
afterAll(() => s?.stop())

const api = (path: string) => `/api/v1${path}`
const wsBase = () => s.url.replace('http', 'ws')
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

let n = 0
async function setup() {
	n++
	const agent = request.agent(s.url)
	const res = await agent
		.post(api('/auth/register'))
		.send({ email: `dws${n}@x.com`, username: `dws${n}`, password: 'clave-larga-123' })
		.expect(201)
	const cookie = res.get('Set-Cookie')![0]!.split(';')[0]!
	const created = await agent
		.post(api('/displays'))
		.send({ deviceId: `md-ABCD${String(n).padStart(8, '0')}`, name: 'Sala' })
		.expect(201)
	const d = Display.parse(created.body)
	return { agent, cookie, d, path: `/displays/${d.deviceId}`, tok: await token(agent, ['display:connect'], d.id) }
}

async function token(agent: request.Agent, scopes: Scope[], displayId: string) {
	const res = await agent.post(api('/tokens')).send({ name: 'pantalla', scopes, displayId }).expect(201)
	return CreatedApiToken.parse(res.body)
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

// ESP32 simulado: guarda todo lo que recibe, en orden.
async function device(tok: string) {
	const ws = new WebSocket(`${wsBase()}/ws/device`, { headers: bearer(tok) })
	const inbox: Msg[] = []
	ws.on('message', (raw) => inbox.push(JSON.parse(raw.toString())))
	const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)))
	await once(ws, 'open', { signal: AbortSignal.timeout(5000) })
	let read = 0
	return {
		ws,
		inbox,
		send: (m: unknown) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
		// Los `count` mensajes siguientes a los ya leídos.
		async take(count = 1) {
			await vi.waitFor(() => expect(inbox.length).toBeGreaterThanOrEqual(read + count), { timeout: 5000 })
			read += count
			return inbox.slice(read - count, read)
		},
		// Nada más que lo ya leído (margen para que llegue lo que no debería).
		async nothingMore() {
			await sleep(300)
			expect(inbox.slice(read)).toEqual([])
		},
		closeCode: () => Promise.race([closed, sleep(5000).then(() => Promise.reject(new Error('el socket no se cerró')))]),
	}
}
type Device = Awaited<ReturnType<typeof device>>

const hello = (deviceId: string, template?: { id: string; version: number }, protocol = 1) => ({
	type: 'device.hello',
	protocol,
	deviceId,
	firmware: '1.0.0-touch',
	display: { width: 172, height: 320, touch: true, color: 'RGB565' },
	template: template && { id: template.id, version: template.version },
	capabilities: ['text', 'rect', 'button', 'touch.tap', 'ui.result', 'template.cache'],
})

// hello con la plantilla de la caché y espera la sincronización (template.set si no coincide + snapshot).
async function synced(dev: Device, deviceId: string, cache?: { id: string; version: number }, expected = 2) {
	dev.send(hello(deviceId, cache))
	return dev.take(expected)
}

let ev = 0
const tap = (
	deviceId: string,
	actionId: string,
	t: { id: string; version: number },
	eventId = `${deviceId}-${++ev}`,
) => ({
	type: 'touch.tap',
	eventId,
	deviceId,
	actionId,
	name: actionId,
	x: 50,
	y: 250,
	templateId: t.id,
	templateVersion: t.version,
	uptimeMs: 1000,
})
const uiResult = (eventId: string, st: string, toast: string) => ({ type: 'ui.result', eventId, status: st, toast })
const snapshot = (values: unknown, templateVersion = 1) => ({
	type: 'data.update',
	templateVersion,
	strategy: 'snapshot',
	values,
})

async function events(agent: request.Agent, path: string) {
	return DisplayEvent.array().parse((await agent.get(api(`${path}/events`)).expect(200)).body)
}

describe('/ws/device handshake', () => {
	it('solo un Bearer display:connect válido entra; ?token=, cookie, displays:write y revocado → 401', async () => {
		const { agent, cookie, d, tok } = await setup()
		const url = `${wsBase()}/ws/device`
		expect(await handshakeStatus(url)).toBe(401)
		expect(await handshakeStatus(url, bearer('dmt_invalido'))).toBe(401)
		expect(await handshakeStatus(url, bearer((await token(agent, ['displays:write'], d.id)).token))).toBe(401)
		expect(await handshakeStatus(`${url}?token=${tok.token}`)).toBe(401)
		expect(await handshakeStatus(url, { cookie })).toBe(401)

		const dev = await device(tok.token) // el mismo token por el header sí entra
		dev.ws.close()
		await agent.delete(api(`/tokens/${tok.id}`)).expect(204)
		expect(await handshakeStatus(url, bearer(tok.token))).toBe(401)
	})

	it('otra ruta /ws/* se corta y /ws sigue funcionando', async () => {
		const other = new WebSocket(`${wsBase()}/ws/otra`)
		await expect(once(other, 'open', { signal: AbortSignal.timeout(5000) })).rejects.toThrow()

		const web = new WebSocket(`${wsBase()}/ws`)
		await once(web, 'open', { signal: AbortSignal.timeout(5000) })
		const pong = once(web, 'message', { signal: AbortSignal.timeout(5000) })
		web.send(JSON.stringify({ type: 'ping' }))
		expect(JSON.parse(String((await pong)[0]))).toEqual({ type: 'pong' })
		web.close()
	})
})

describe('/ws/device cierres', () => {
	it('binaria → 1003; no JSON → 1007; > 8192 bytes → 1009', async () => {
		const { tok } = await setup()
		const cases: [unknown, number][] = [
			[Buffer.from([1, 2, 3]), 1003],
			['no-json', 1007],
			[JSON.stringify({ type: 'data.ack', ok: true, reason: 'x'.repeat(9000) }), 1009],
		]
		for (const [payload, code] of cases) {
			const dev = await device(tok.token)
			dev.ws.send(payload as string)
			expect(await dev.closeCode()).toBe(code)
		}
	})

	it('antes del hello, un touch.tap → 1008; hello de otro deviceId → 1008; protocol 2 → 1008', async () => {
		const { d, tok } = await setup()
		let dev = await device(tok.token)
		dev.send(tap(d.deviceId, 'x', { id: 'inicio', version: 1 }))
		expect(await dev.closeCode()).toBe(1008)

		dev = await device(tok.token)
		dev.send(hello('md-000000000000'))
		expect(await dev.closeCode()).toBe(1008)

		dev = await device(tok.token)
		dev.send(hello(d.deviceId, undefined, 2))
		expect(await dev.closeCode()).toBe(1008)

		// También tras un hello válido: protocol 2 no se ignora como un mensaje mal formado.
		dev = await device(tok.token)
		await synced(dev, d.deviceId)
		dev.send(hello(d.deviceId, undefined, 2))
		expect(await dev.closeCode()).toBe(1008)
	})

	it('tras el hello: un tipo desconocido o mal formado se ignora; touch.tap de otro deviceId → 1008', async () => {
		const { d, tok } = await setup()
		const dev = await device(tok.token)
		await synced(dev, d.deviceId.toLowerCase(), { id: 'inicio', version: 1 }, 1) // sin distinguir mayúsculas
		dev.send({ type: 'nope' })
		dev.send({ type: 'touch.tap', eventId: 'e' }) // tipo conocido, esquema inválido
		dev.send({ type: 'data.ack', ok: false, reason: 'version_mismatch' })
		dev.send(tap(d.deviceId, 'nada', { id: 'inicio', version: 1 }, 'e-1'))
		expect(await dev.take()).toEqual([uiResult('e-1', 'rejected', 'Accion desactualizada')])

		dev.send(tap('md-000000000000', 'nada', { id: 'inicio', version: 1 }))
		expect(await dev.closeCode()).toBe(1008)
	})
})

describe('/ws/device hello', () => {
	it('con inicio v1 en caché solo recibe el snapshot; sin caché u otra versión, template.set y luego snapshot', async () => {
		const { agent, d, path, tok } = await setup()
		const inicio = DisplayDetail.parse((await agent.get(api(path)).expect(200)).body).template

		const cached = await device(tok.token)
		expect(await synced(cached, d.deviceId, { id: 'inicio', version: 1 }, 1)).toEqual([snapshot({})])
		await cached.nothingMore()

		for (const cache of [undefined, { id: 'inicio', version: 0 }, { id: 'goal.v1', version: 1 }]) {
			const dev = await device(tok.token)
			expect(await synced(dev, d.deviceId, cache)).toEqual([{ type: 'template.set', template: inicio }, snapshot({})])
			dev.ws.close()
		}
		cached.ws.close()
	})

	it('online mientras está conectado; un segundo hello resincroniza sin duplicar la presencia', async () => {
		const { agent, d, path, tok } = await setup()
		const online = async () => Display.parse((await agent.get(api(path)).expect(200)).body).online
		const dev = await device(tok.token)
		expect(await online()).toBe(false) // sin hello todavía no cuenta
		await synced(dev, d.deviceId)
		expect(await online()).toBe(true)

		expect(await synced(dev, d.deviceId, { id: 'inicio', version: 1 }, 1)).toEqual([snapshot({})])
		expect(await s.c.redis.zCard(`dpres:${d.id}`)).toBe(1)

		dev.ws.close()
		await expect.poll(online).toBe(false)
	})
})

describe('/ws/device mensajes grandes', () => {
	it('una plantilla de más de 8192 bytes llega en frag seguidos que reensamblados dan su template.set; luego el snapshot', async () => {
		const { agent, d, path, tok } = await setup()
		const image = {
			type: 'image',
			x: 0,
			y: 0,
			w: 60,
			h: 60,
			encoding: 'rgb565',
			data: encodeBase64(new Uint8Array(60 * 60 * 2)),
		}
		const big = { ...goal, id: 'grande', version: 1, elements: [...goal.elements, image] } as DisplayTemplate
		await agent
			.put(api(`${path}/template`))
			.send(big)
			.expect(200)
		const dev = await device(tok.token)
		dev.send(hello(d.deviceId))
		const [first] = (await dev.take()) as [Msg & { count: number }]
		expect(first).toMatchObject({ type: 'frag', seq: 0 })
		const rest = await dev.take(first.count) // los demás trozos y el snapshot
		const frags = [first, ...rest.slice(0, -1)] as (Msg & { id: string; seq: number; data: string })[]
		expect(frags.map((f) => [f.type, f.id, f.seq])).toEqual(frags.map((_, i) => ['frag', first.id, i]))
		for (const f of frags) expect(JSON.stringify(f).length).toBeLessThanOrEqual(DISPLAY_MAX_FRAME)
		const json = Buffer.concat(frags.map((f) => Buffer.from(f.data, 'base64'))).toString()
		expect(Buffer.byteLength(json)).toBe(first.bytes)
		expect(JSON.parse(json)).toEqual({ type: 'template.set', template: big })
		expect(rest.at(-1)).toEqual(snapshot({}))
		dev.send({ type: 'frag.ack', id: first.id, ok: true }) // solo se registra
		await dev.nothingMore()
		dev.ws.close()
	})
})

describe('/ws/device REST → dispositivo', () => {
	it('PUT/PATCH /data, PUT /template y comandos llegan al dispositivo; sin conexión → 409', async () => {
		const { agent, d, path, tok } = await setup()
		await agent
			.post(api(`${path}/commands`))
			.send({ type: 'display.refresh' })
			.expect(409)

		const dev = await device(tok.token)
		await synced(dev, d.deviceId)

		await agent
			.put(api(`${path}/data`))
			.send(goalData)
			.expect(200)
		expect(await dev.take()).toEqual([snapshot(goalData)])

		await agent
			.patch(api(`${path}/data`))
			.send({ progress: 7.5, daysText: null })
			.expect(200)
		expect(await dev.take()).toEqual([
			{ type: 'data.update', templateVersion: 1, strategy: 'patch', values: { progress: 7.5, daysText: null } },
		])

		await agent
			.put(api(`${path}/template`))
			.send(goal)
			.expect(200)
		expect(await dev.take(2)).toEqual([
			{ type: 'template.set', template: goal },
			snapshot({ ...goalData, progress: 7.5, daysText: null }),
		])

		await agent
			.post(api(`${path}/commands`))
			.send({ type: 'display.brightness', percent: 30 })
			.expect(202)
		expect(await dev.take()).toEqual([{ type: 'display.brightness', percent: 30 }])
		await dev.nothingMore()
		dev.ws.close()
	})
})

describe('/ws/device toques', () => {
	it('navegación screen.status.v1 a los dos sockets, ui.result al que tocó; el mismo eventId no se reprocesa', async () => {
		const { agent, d, path, tok } = await setup()
		await agent
			.put(api(`${path}/data`))
			.send(goalData)
			.expect(200)
		await agent
			.put(api(`${path}/templates/${status.id}`))
			.send(status)
			.expect(200)
		await agent
			.put(api(`${path}/template`))
			.send(goal)
			.expect(200)
		const a = await device(tok.token)
		const b = await device(tok.token)
		await synced(a, d.deviceId, goal, 1)
		await synced(b, d.deviceId, goal, 1)

		const go = tap(d.deviceId, 'go-status', goal)
		a.send(go)
		const nav = [{ type: 'template.set', template: status }, snapshot(goalData, status.version)]
		const ok = uiResult(go.eventId, 'ok', 'Pantalla cambiada')
		// ui.result va directo al socket y la navegación por display-out: entre ellos el orden puede variar.
		const got = await a.take(3)
		expect(got.filter((m) => m.type !== 'ui.result')).toEqual(nav)
		expect(got.find((m) => m.type === 'ui.result')).toEqual(ok)
		expect(await b.take(2)).toEqual(nav)

		a.send(go) // reintento del firmware: misma respuesta, sin volver a navegar
		expect(await a.take()).toEqual([ok])
		await a.nothingMore()
		await b.nothingMore()
		await expect.poll(async () => (await events(agent, path)).length).toBe(1)
		expect((await events(agent, path))[0]).toMatchObject({
			eventId: go.eventId,
			actionId: 'go-status',
			templateId: goal.id,
			templateVersion: goal.version,
			status: 'ok',
			toast: 'Pantalla cambiada',
		})
		expect(DisplayDetail.parse((await agent.get(api(path)).expect(200)).body).activeTemplateId).toBe(status.id)

		// Pendiente: otro socket con el mismo eventId mientras se procesa recibe event.ack.
		await s.c.redis.set(`dedup:${d.id}:en-curso`, 'pending', { EX: 60 })
		b.send(tap(d.deviceId, 'go-back', status, 'en-curso'))
		expect(await b.take()).toEqual([{ type: 'event.ack', eventId: 'en-curso' }])
		a.ws.close()
		b.ws.close()
	})

	it('data.refresh: snapshot solo a ese socket; local, versión vieja, otra plantilla o acción inexistente → rejected; screen.noexiste → error', async () => {
		const { agent, d, path, tok } = await setup()
		const extra = (id: string, mode: 'local' | 'remote', event?: string) => ({
			id,
			trigger: 'tap' as const,
			x: 0,
			y: 0,
			w: 10,
			h: 10,
			mode,
			event,
			...(mode === 'local' ? { local: { kind: 'feedback' as const, message: 'Hola' } } : {}),
		})
		const t: DisplayTemplate = {
			...goal,
			actions: [
				...goal.actions,
				extra('solo-local', 'local'),
				extra('a-ninguna', 'remote', 'screen.noexiste'),
				extra('otro', 'remote', 'pedido.crear'),
			],
		}
		await agent
			.put(api(`${path}/data`))
			.send(goalData)
			.expect(200)
		await agent
			.put(api(`${path}/template`))
			.send(t)
			.expect(200)
		const a = await device(tok.token)
		const b = await device(tok.token)
		await synced(a, d.deviceId, t, 1)
		await synced(b, d.deviceId, t, 1)

		const refresh = tap(d.deviceId, 'refresh', t)
		a.send(refresh)
		expect(await a.take(2)).toEqual([snapshot(goalData), uiResult(refresh.eventId, 'ok', 'Datos actualizados')])
		await b.nothingMore()

		const cases: [ReturnType<typeof tap>, string, string][] = [
			[tap(d.deviceId, 'solo-local', t), 'rejected', 'Accion desactualizada'],
			[tap(d.deviceId, 'refresh', { id: t.id, version: 0 }), 'rejected', 'Accion desactualizada'],
			[tap(d.deviceId, 'refresh', { id: 'status.v1', version: 1 }), 'rejected', 'Accion desactualizada'],
			[tap(d.deviceId, 'no-existe', t), 'rejected', 'Accion desactualizada'],
			[tap(d.deviceId, 'a-ninguna', t), 'error', 'Pantalla no existe'],
			[tap(d.deviceId, 'otro', t), 'ok', 'Accion recibida'],
		]
		// Seguidos, sin esperar: la cola por conexión los responde en orden.
		for (const [m] of cases) a.send(m)
		expect(await a.take(cases.length)).toEqual(cases.map(([m, st, toast]) => uiResult(m.eventId, st, toast)))
		await a.nothingMore()
		await b.nothingMore()
		await expect.poll(async () => (await events(agent, path)).length).toBe(cases.length + 1)
		expect(DisplayDetail.parse((await agent.get(api(path)).expect(200)).body).activeTemplateId).toBe(t.id)
		a.ws.close()
		b.ws.close()
	})

	it('botón físico con data.set: patch a los dos sockets, ui.result Datos cambiados y el evento con source/button/press', async () => {
		const { agent, d, path, tok } = await setup()
		const button = (id: string, press: 'short' | 'long', payload: Record<string, unknown>) => ({
			id,
			trigger: 'button' as const,
			button: 0,
			press,
			mode: 'remote' as const,
			event: 'data.set',
			payload,
		})
		const t = {
			...goal,
			id: 'botones',
			version: 1,
			actions: [...goal.actions, button('pulsar', 'long', { estado: 'PULSADO' })],
		} as DisplayTemplate
		await agent
			.put(api(`${path}/template`))
			.send(t)
			.expect(200)
		const a = await device(tok.token)
		const b = await device(tok.token)
		await synced(a, d.deviceId, t, 1)
		await synced(b, d.deviceId, t, 1)

		const press = { ...tap(d.deviceId, 'pulsar', t), source: 'button', button: 0, press: 'long', x: 0, y: 0 }
		a.send(press)
		const patch = { type: 'data.update', templateVersion: 1, strategy: 'patch', values: { estado: 'PULSADO' } }
		// El patch va por display-out y el ui.result directo: entre ellos el orden puede variar.
		const got = await a.take(2)
		expect(got).toContainEqual(patch)
		expect(got).toContainEqual({ ...uiResult(press.eventId, 'ok', 'Datos cambiados'), patch: { estado: 'PULSADO' } })
		expect(await b.take()).toEqual([patch])

		await b.nothingMore()

		expect(DisplayDetail.parse((await agent.get(api(path)).expect(200)).body).values).toEqual({ estado: 'PULSADO' })
		await expect.poll(async () => (await events(agent, path)).length).toBe(1)
		expect((await events(agent, path)).at(-1)).toMatchObject({
			actionId: 'pulsar',
			status: 'ok',
			toast: 'Datos cambiados',
			source: 'button',
			button: 0,
			press: 'long',
		})
		a.ws.close()
		b.ws.close()
	})

	it('DELETE /displays/:id cierra el socket con 1008', async () => {
		const { agent, d, path, tok } = await setup()
		const dev = await device(tok.token)
		await synced(dev, d.deviceId)
		await agent.delete(api(path)).expect(204)
		expect(await dev.closeCode()).toBe(1008)
		await expect.poll(() => s.c.redis.zCard(`dpres:${d.id}`)).toBe(0)
	})
})
