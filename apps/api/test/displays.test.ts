import { readFileSync } from 'node:fs'
import { CreatedApiToken, Display, DisplayDetail, DisplayEvent, type DisplayTemplate, type Scope } from '@atekos/shared'
import { eq } from 'drizzle-orm'
import { createClient } from 'redis'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { displayTemplates } from '../src/db/schema'
import { makeTokenHasher } from '../src/shared/crypto'
import { startStack } from './stack'

const example = (name: string) =>
	JSON.parse(readFileSync(new URL(`../../../docs/metadisplay/examples/${name}`, import.meta.url), 'utf8'))
const goal: DisplayTemplate = example('goal-template.json')
const status: DisplayTemplate = example('status-template.json')
const goalData = example('goal-data.json')

type Msg = { type: string } & Record<string, unknown>
let s: Awaited<ReturnType<typeof startStack>>
// Conexión propia suscrita a display-out: así se ve lo mismo que recibirá /ws/device en cualquier instancia.
let sub: ReturnType<typeof createClient> | undefined
const published: { displayId: string; message: Msg }[] = []

beforeAll(async () => {
	s = await startStack()
	sub = createClient({ url: s.c.env.REDIS_URL })
	await sub.connect()
	await sub.subscribe('display-out', (raw) => published.push(JSON.parse(raw)))
})
afterAll(async () => {
	await sub?.close()
	await s?.stop()
})

const api = (path: string) => `/api/v1${path}`
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
const anon = () => request(s.url)

let n = 0
async function registered() {
	n++
	const agent = request.agent(s.url)
	const res = await agent
		.post(api('/auth/register'))
		.send({ email: `pan${n}@x.com`, username: `pan${n}`, password: 'clave-larga-123' })
		.expect(201)
	return { agent, user: res.body as { id: string } }
}

// md- + 12 hex con letras, para comprobar que se normaliza a mayúsculas.
const hw = () => `md-ABCD${String(++n).padStart(8, '0')}`

async function createDisplay(agent: request.Agent) {
	const res = await agent.post(api('/displays')).send({ deviceId: hw().toLowerCase(), name: 'Sala' }).expect(201)
	const display = Display.parse(res.body)
	return { ...display, path: `/displays/${display.deviceId}` }
}

async function token(agent: request.Agent, scopes: Scope[], displayId?: string) {
	const res = await agent.post(api('/tokens')).send({ name: 'pantalla', scopes, displayId }).expect(201)
	return CreatedApiToken.parse(res.body)
}

// Lo publicado para la pantalla desde la última llamada. Publica una marca y la espera: Redis entrega en orden
// lo publicado por una misma conexión, así que todo lo anterior a la marca ya ha llegado.
const cursor = new Map<string, number>()
async function drain(displayId: string) {
	const mark = { type: 'event.ack', eventId: `marca-${++n}` } as const
	await s.c.displays.outbox.publish(displayId, mark)
	const mine = () => published.filter((p) => p.displayId === displayId).map((p) => p.message)
	await vi.waitFor(() => expect(mine().at(-1)).toEqual(mark))
	const all = mine()
	const from = cursor.get(displayId) ?? 0
	cursor.set(displayId, all.length)
	return all.slice(from, -1)
}

describe('displays', () => {
	it('crear: 201 con la plantilla inicio activa; id repetido → 409; ajena → 404; formato inválido → 404', async () => {
		const a = await registered()
		const b = await registered()
		const id = hw()
		const res = await a.agent.post(api('/displays')).send({ deviceId: id.toLowerCase(), name: 'Sala' }).expect(201)
		const row = (await s.c.displays.repo.findByHardwareId(id))!
		expect(Display.parse(res.body)).toMatchObject({
			id: row.id, // el uuid que piden los tokens ligados
			deviceId: id,
			name: 'Sala',
			activeTemplateId: 'inicio',
			online: false,
		})

		const detail = DisplayDetail.parse((await a.agent.get(api(`/displays/${id.toLowerCase()}`)).expect(200)).body)
		expect(detail).toMatchObject({ ...res.body, templates: [{ id: 'inicio', version: 1 }], values: {} })
		expect(detail.template).toMatchObject({ id: 'inicio', version: 1 })
		expect(JSON.stringify(detail.template)).toContain('"bind":"mensaje"')
		await a.agent.get(api('/displays')).expect(200, [res.body])

		const dup = await a.agent.post(api('/displays')).send({ deviceId: id, name: 'Otra' }).expect(409)
		expect(dup.body.error).toBe('conflict')
		await b.agent.post(api('/displays')).send({ deviceId: id, name: 'Otra' }).expect(409) // único global
		await b.agent.get(api(`/displays/${id}`)).expect(404)
		await b.agent
			.put(api(`/displays/${id}/data`))
			.send({ a: 1 })
			.expect(404)
		await b.agent.get(api('/displays')).expect(200, [])

		for (const path of ['/displays/md-123', '/displays/xx-ABCD00000001', '/displays/md-ZZZZ00000001/templates'])
			await a.agent.get(api(path)).expect(404)
		await a.agent.post(api('/displays')).send({ deviceId: 'md-123', name: 'X' }).expect(400)
		await anon().get(api('/displays')).expect(401)
		await anon()
			.get(api(`/displays/${id}`))
			.expect(401)
		await anon().post(api('/displays')).send({ deviceId: hw(), name: 'X' }).expect(401)
	})

	it('PUT /template guarda, activa y publica template.set + snapshot; misma versión → 409; mayor → 200', async () => {
		const { agent } = await registered()
		const d = await createDisplay(agent)
		await agent
			.put(api(`${d.path}/data`))
			.send(goalData)
			.expect(200)
		await drain(d.id)

		const put = await agent
			.put(api(`${d.path}/template`))
			.send(goal)
			.expect(200)
		// 200 DisplayDetail: la web refresca con una sola respuesta.
		expect(DisplayDetail.parse(put.body)).toMatchObject({
			id: d.id,
			deviceId: d.deviceId,
			activeTemplateId: 'goal.v1',
			template: goal,
			templates: [
				{ id: 'goal.v1', version: 1 },
				{ id: 'inicio', version: 1 },
			],
			values: goalData,
		})
		expect(await drain(d.id)).toEqual([
			{ type: 'template.set', template: goal },
			{ type: 'data.update', templateVersion: 1, strategy: 'snapshot', values: goalData },
		])

		const same = await agent
			.put(api(`${d.path}/template`))
			.send(goal)
			.expect(409)
		expect(same.body.error).toBe('version_not_incremented')
		await agent
			.put(api(`${d.path}/template`))
			.send({ ...goal, version: 0 })
			.expect(409)
		const v2 = { ...goal, version: 2 }
		await agent
			.put(api(`${d.path}/template`))
			.send(v2)
			.expect(200)
		expect(await drain(d.id)).toEqual([
			{ type: 'template.set', template: v2 },
			{ type: 'data.update', templateVersion: 2, strategy: 'snapshot', values: goalData },
		])

		const bad = await agent
			.put(api(`${d.path}/template`))
			.send({ ...goal, version: 3, elements: [{ type: 'image', x: 1, y: 1 }] })
			.expect(422)
		expect(bad.body.error).toBe('invalid_template')
		expect(bad.body.issues.length).toBeGreaterThan(0)
		await agent
			.put(api(`${d.path}/template`))
			.send({ ...goal, version: 2 ** 31 })
			.expect(422)
		const big = {
			id: 'grande',
			version: 1,
			elements: Array.from({ length: 45 }, () => ({ type: 'text', x: 0, y: 0, value: 'ñ'.repeat(140) })),
			actions: [],
		}
		const tooLarge = await agent
			.put(api(`${d.path}/template`))
			.send(big)
			.expect(413)
		expect(tooLarge.body.error).toBe('message_too_large')
		expect(await drain(d.id)).toEqual([])
		const detail = DisplayDetail.parse((await agent.get(api(d.path)).expect(200)).body)
		expect(detail.template).toEqual(v2)
		expect(detail.templates).toEqual([
			{ id: 'goal.v1', version: 2 },
			{ id: 'inicio', version: 1 },
		])
	})

	it('PUT /templates/:id no activa; PATCH activeTemplateId publica; la activa no se borra', async () => {
		const { agent } = await registered()
		const d = await createDisplay(agent)
		await drain(d.id)

		const saved = await agent
			.put(api(`${d.path}/templates/status.v1`))
			.send(status)
			.expect(200)
		expect(DisplayDetail.parse(saved.body)).toMatchObject({
			id: d.id,
			activeTemplateId: 'inicio',
			templates: [
				{ id: 'inicio', version: 1 },
				{ id: 'status.v1', version: 2 },
			],
		})
		expect(saved.body.template.id).toBe('inicio')
		expect(await drain(d.id)).toEqual([])
		await agent.get(api(d.path)).expect(200, saved.body)
		await agent
			.put(api(`${d.path}/templates/otro`))
			.send(status)
			.expect(422)

		const patched = await agent
			.patch(api(d.path))
			.send({ activeTemplateId: 'status.v1', name: 'Recepción' })
			.expect(200)
		expect(Display.parse(patched.body)).toMatchObject({ id: d.id, activeTemplateId: 'status.v1', name: 'Recepción' })
		expect(await drain(d.id)).toEqual([
			{ type: 'template.set', template: status },
			{ type: 'data.update', templateVersion: 2, strategy: 'snapshot', values: {} },
		])
		const missing = await agent.patch(api(d.path)).send({ activeTemplateId: 'no-existe' }).expect(422)
		expect(missing.body.error).toBe('template_not_found')
		await agent.patch(api(d.path)).send({ name: 'Solo nombre' }).expect(200)
		expect(await drain(d.id)).toEqual([]) // sin cambio de activa no se publica nada

		// Si es la activa, guardarla la publica.
		const v3 = { ...status, version: 3 }
		const savedActive = await agent
			.put(api(`${d.path}/templates/status.v1`))
			.send(v3)
			.expect(200)
		expect(DisplayDetail.parse(savedActive.body).template).toEqual(v3)
		expect(await drain(d.id)).toEqual([
			{ type: 'template.set', template: v3 },
			{ type: 'data.update', templateVersion: 3, strategy: 'snapshot', values: {} },
		])

		const active = await agent.delete(api(`${d.path}/templates/status.v1`)).expect(409)
		expect(active.body.error).toBe('conflict')
		await agent.delete(api(`${d.path}/templates/inicio`)).expect(204)
		await agent.delete(api(`${d.path}/templates/inicio`)).expect(404)
		await agent.get(api(`${d.path}/templates`)).expect(200, [v3])
	})

	it('datos: PUT → snapshot; PATCH → patch solo con lo recibido; 65 claves tras el merge → 422; texto de 141 → 422', async () => {
		const { agent } = await registered()
		const d = await createDisplay(agent)
		await drain(d.id)

		await agent
			.put(api(`${d.path}/data`))
			.send({ mensaje: 'hola', n: 1, k: true })
			.expect(200, { values: { mensaje: 'hola', n: 1, k: true } })
		expect(await drain(d.id)).toEqual([
			{ type: 'data.update', templateVersion: 1, strategy: 'snapshot', values: { mensaje: 'hola', n: 1, k: true } },
		])
		await agent
			.patch(api(`${d.path}/data`))
			.send({ n: 2, k: null })
			.expect(200, { values: { mensaje: 'hola', n: 2, k: null } })
		expect(await drain(d.id)).toEqual([
			{ type: 'data.update', templateVersion: 1, strategy: 'patch', values: { n: 2, k: null } },
		])

		// 3 + 61 = 64 claves: justo en el límite.
		const many = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`v${i}`, i]))
		await agent
			.patch(api(`${d.path}/data`))
			.send(many)
			.expect(200)
		await drain(d.id)
		const over = await agent
			.patch(api(`${d.path}/data`))
			.send({ otra: 1 })
			.expect(422)
		expect(over.body.error).toBe('invalid_data')
		const long = await agent
			.put(api(`${d.path}/data`))
			.send({ t: 'x'.repeat(141) })
			.expect(422)
		expect(long.body.error).toBe('invalid_data')
		expect(long.body.issues.length).toBeGreaterThan(0)
		await agent
			.patch(api(`${d.path}/data`))
			.send({ t: 'x'.repeat(141) })
			.expect(422)
		await agent
			.put(api(`${d.path}/data`))
			.send({ t: { anidado: 1 } })
			.expect(422)
		expect(await drain(d.id)).toEqual([])
		expect(Object.keys((await agent.get(api(d.path)).expect(200)).body.values)).toHaveLength(64)
	})

	it('comandos: offline → 409; trust.* y ota → 422; con presencia → 202, publicado y auditado', async () => {
		const { agent, user } = await registered()
		const d = await createDisplay(agent)
		await drain(d.id)
		const cmd = (body: object) => agent.post(api(`${d.path}/commands`)).send(body)

		expect((await cmd({ type: 'display.refresh' }).expect(409)).body.error).toBe('device_offline')
		for (const type of ['trust.stage', 'trust.activate', 'ota.install', 'display.reboot'])
			expect((await cmd({ type }).expect(422)).body.error).toBe('command_not_allowed')
		await cmd({ type: 'display.brightness', percent: 80 }).expect(400)

		// Una conexión caducada (score en el pasado) no cuenta como online.
		await s.c.redis.zAdd(`dpres:${d.id}`, { score: Date.now() - 1, value: 'vieja' })
		expect(await s.c.displays.presence.isOnline(d.id)).toBe(false)
		await s.c.displays.presence.add(d.id, 'conn-1')
		expect(await s.c.redis.zScore(`dpres:${d.id}`, 'vieja')).toBeNull() // add limpia las caducadas
		expect(await s.c.redis.ttl(`dpres:${d.id}`)).toBeGreaterThan(110)
		expect((await agent.get(api(d.path)).expect(200)).body.online).toBe(true)

		await cmd({ type: 'display.brightness', percent: 30 }).expect(202, { ok: true })
		expect(await drain(d.id)).toEqual([{ type: 'display.brightness', percent: 30 }])
		const audit = await s.c.mongo.collection('display_events').findOne({ displayId: d.id, kind: 'command' })
		expect(audit).toMatchObject({
			ownerId: user.id,
			command: { type: 'display.brightness', percent: 30 },
			actor: { kind: 'user', id: user.id },
		})

		await s.c.displays.presence.remove(d.id, 'conn-1')
		await cmd({ type: 'display.refresh' }).expect(409)
	})

	it('un token displays:write ligado a A administra A pero no B; el token del dispositivo no administra nada', async () => {
		const { agent } = await registered()
		const A = await createDisplay(agent)
		const B = await createDisplay(agent)
		const wA = await token(agent, ['displays:write'], A.id)
		await anon().get(api(A.path)).set(bearer(wA.token)).expect(200)
		await anon()
			.put(api(`${A.path}/data`))
			.set(bearer(wA.token))
			.send({ a: 1 })
			.expect(200)
		await anon().get(api(B.path)).set(bearer(wA.token)).expect(404)
		await anon()
			.put(api(`${B.path}/data`))
			.set(bearer(wA.token))
			.send({ a: 1 })
			.expect(404)
		const listA = await anon().get(api('/displays')).set(bearer(wA.token)).expect(200)
		expect(listA.body.map((x: Display) => x.deviceId)).toEqual([A.deviceId])

		const w = await token(agent, ['displays:write'])
		expect((await anon().get(api('/displays')).set(bearer(w.token)).expect(200)).body).toHaveLength(2)
		// POST y DELETE exigen sesión.
		await anon().post(api('/displays')).set(bearer(w.token)).send({ deviceId: hw(), name: 'X' }).expect(401)
		await anon().delete(api(A.path)).set(bearer(w.token)).expect(401)

		const dev = await token(agent, ['display:connect'], A.id)
		const other = await token(agent, ['devices:read', 'devices:write'])
		const routes: [string, string, object?][] = [
			['get', ''],
			['patch', '', { name: 'X' }],
			['delete', ''],
			['put', '/template', { ...goal, version: 9 }],
			['get', '/templates'],
			['put', '/templates/goal.v1', { ...goal, version: 9 }],
			['delete', '/templates/inicio'],
			['put', '/data', { a: 2 }],
			['patch', '/data', { a: 2 }],
			['get', '/events'],
			['post', '/commands', { type: 'display.refresh' }],
		]
		for (const t of [dev, other]) {
			await anon().get(api('/displays')).set(bearer(t.token)).expect(401)
			await anon().post(api('/displays')).set(bearer(t.token)).send({ deviceId: hw(), name: 'X' }).expect(401)
			for (const [method, path, body] of routes) {
				const req = anon()
					[method as 'get'](api(`${A.path}${path}`))
					.set(bearer(t.token))
				const res = await (body ? req.send(body) : req)
				expect([401, 404], `${method} ${path}`).toContain(res.status)
			}
		}
		// Nada de lo anterior cambió A.
		const detail = DisplayDetail.parse((await agent.get(api(A.path)).expect(200)).body)
		expect(detail).toMatchObject({ name: 'Sala', activeTemplateId: 'inicio', values: { a: 1 } })
	})

	it('el token se crea con displayId; con una pantalla ajena → 404', async () => {
		const a = await registered()
		const b = await registered()
		const d = await createDisplay(a.agent)
		const t = await token(a.agent, ['display:connect'], d.id)
		expect(t.displayId).toBe(d.id)
		expect(await s.c.tokens.verify.execute(t.token)).toMatchObject({ displayId: d.id, scopes: ['display:connect'] })
		await b.agent
			.post(api('/tokens'))
			.send({ name: 'x', scopes: ['displays:write'], displayId: d.id })
			.expect(404)
		await a.agent
			.post(api('/tokens'))
			.send({ name: 'x', scopes: ['display:connect'] })
			.expect(400)
	})

	it('DELETE → 204; los tokens ligados dan 401 al instante y se publica close', async () => {
		const { agent } = await registered()
		const d = await createDisplay(agent)
		await drain(d.id)
		const t = await token(agent, ['displays:write'], d.id)
		const hash = makeTokenHasher(s.c.env.TOKEN_PEPPER).hash(t.token)
		await anon().get(api(d.path)).set(bearer(t.token)).expect(200)
		expect(await s.c.redis.exists(`tok:${hash}`)).toBe(1)

		const res = await agent.delete(api(d.path)).expect(204)
		expect(res.text).toBe('')
		expect(await s.c.redis.exists(`tok:${hash}`)).toBe(0)
		await anon().get(api('/displays')).set(bearer(t.token)).expect(401)
		expect(await drain(d.id)).toEqual([{ type: 'close' }])
		await agent.get(api(d.path)).expect(404)
		await agent.delete(api(d.path)).expect(404)
		expect(await s.c.db.select().from(displayTemplates).where(eq(displayTemplates.displayId, d.id))).toEqual([])
		await agent.post(api('/displays')).send({ deviceId: d.deviceId, name: 'Otra vez' }).expect(201) // el id queda libre
	})

	it('eventos: solo toques, del más reciente al más antiguo', async () => {
		const { agent, user } = await registered()
		const d = await createDisplay(agent)
		const touch = (eventId: string, x: number) =>
			s.c.displays.eventLog.appendTouch({
				displayId: d.id,
				ownerId: user.id,
				eventId,
				actionId: 'refresh',
				name: 'data.refresh',
				x,
				y: 2,
				templateId: 'inicio',
				templateVersion: 1,
				status: 'ok',
				toast: 'Datos actualizados',
				source: 'button',
				button: 0,
				press: 'short',
			})
		await touch('e1', 1)
		await touch('e2', 2)
		await s.c.displays.eventLog.appendCommand({
			displayId: d.id,
			ownerId: user.id,
			command: { type: 'display.refresh' },
			actor: { kind: 'user', id: user.id },
		})

		const { body } = await agent.get(api(`${d.path}/events`)).expect(200)
		expect(
			DisplayEvent.array()
				.parse(body)
				.map((e) => e.eventId),
		).toEqual(['e2', 'e1'])
		expect(body[0]).toEqual({
			ts: expect.any(String),
			eventId: 'e2',
			actionId: 'refresh',
			name: 'data.refresh',
			x: 2,
			y: 2,
			templateId: 'inicio',
			templateVersion: 1,
			status: 'ok',
			toast: 'Datos actualizados',
			source: 'button',
			button: 0,
			press: 'short',
		})
		expect(body[0].ts).toBe(new Date(body[0].ts).toISOString())
		await agent
			.get(api(`${d.path}/events?limit=1`))
			.expect(200)
			.expect((r) => expect(r.body).toHaveLength(1))
		await agent.get(api(`${d.path}/events?limit=201`)).expect(400)
		await agent.get(api(`${d.path}/events?limit=0`)).expect(400)
	})
})
