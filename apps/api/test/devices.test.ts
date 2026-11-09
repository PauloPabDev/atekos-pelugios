import { CreatedApiToken, Device, DeviceEvent, type Scope } from '@atekos/shared'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { devices } from '../src/db/schema'
import { makeRedisDeviceCache } from '../src/modules/devices/infrastructure/redis-device-cache'
import { makeTokenHasher } from '../src/shared/crypto'
import { startStack } from './stack'

let s: Awaited<ReturnType<typeof startStack>>
beforeAll(async () => {
	s = await startStack()
})
afterAll(() => s?.stop())

const api = (path: string) => `/api/v1${path}`
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
const anon = () => request(s.url)

let n = 0
async function registered() {
	n++
	const agent = request.agent(s.url)
	const res = await agent
		.post(api('/auth/register'))
		.send({ email: `dev${n}@x.com`, username: `dev${n}`, password: 'clave-larga-123' })
		.expect(201)
	return { agent, user: res.body as { id: string } }
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
	return CreatedApiToken.parse(res.body)
}

describe('devices', () => {
	it('crear y listar: los míos frente a los públicos; slug repetido del mismo dueño → 409', async () => {
		const a = await registered()
		const b = await registered()
		const luz = await create(a.agent, { slug: 'luz', data: { brillo: 80 } })
		const sensor = await create(a.agent, { slug: 'sensor', type: 'sensor', visibility: 'public' })
		await create(b.agent, { slug: 'luz' }) // el slug es único por dueño, no global
		expect(luz).toMatchObject({
			ownerId: a.user.id,
			state: false,
			status: 'active',
			description: '',
			data: { brillo: 80 },
		})

		const conflict = await a.agent.post(api('/devices')).send({ slug: 'luz', name: 'Otra' }).expect(409)
		expect(conflict.body.error).toBe('conflict')

		await a.agent.get(api('/devices')).expect(200, [luz, sensor])
		const pub = await anon().get(api('/public/devices?limit=100')).expect(200)
		const ids = pub.body.map((d: Device) => d.id)
		expect(ids).toContain(sensor.id)
		expect(ids).not.toContain(luz.id)
		expect(pub.body.every((d: Device) => d.visibility === 'public')).toBe(true)
		await anon().get(api('/public/devices?limit=101')).expect(400)

		await anon().post(api('/devices')).send({ slug: 'x', name: 'X' }).expect(401)
		await anon().get(api('/devices')).expect(401)
		const t = await token(a.agent, ['devices:read', 'devices:write'])
		await anon().post(api('/devices')).set(bearer(t.token)).send({ slug: 'x', name: 'X' }).expect(401)
		await anon().get(api('/devices')).set(bearer(t.token)).expect(200, [luz, sensor])
		const writer = await token(a.agent, ['devices:write'])
		await anon().get(api('/devices')).set(bearer(writer.token)).expect(403)
	})

	it('/public/devices pagina con page y limit', async () => {
		const { agent } = await registered()
		for (let i = 0; i < 3; i++) await create(agent, { visibility: 'public' })
		const all = (await anon().get(api('/public/devices?limit=100')).expect(200)).body as Device[]
		const page2 = (await anon().get(api('/public/devices?page=2&limit=2')).expect(200)).body as Device[]
		expect(page2).toEqual(all.slice(2, 4))
	})

	it('privado: 404 al anónimo y a otro usuario, también al escribir', async () => {
		const a = await registered()
		const b = await registered()
		const d = await create(a.agent, { data: { k: 1 } })
		for (const who of [anon(), b.agent]) {
			await who.get(api(`/devices/${d.id}`)).expect(404)
			await who.get(api(`/devices/${d.id}/state`)).expect(404)
			await who.get(api(`/devices/${d.id}/data/k`)).expect(404)
			await who.get(api(`/devices/${d.id}/events`)).expect(404)
			await who.post(api(`/devices/${d.id}/toggle`)).expect(404)
			await who
				.put(api(`/devices/${d.id}/state`))
				.send({ state: true })
				.expect(404)
			await who
				.patch(api(`/devices/${d.id}/data`))
				.send({ k: 2 })
				.expect(404)
		}
		await b.agent
			.patch(api(`/devices/${d.id}`))
			.send({ name: 'Mía' })
			.expect(404)
		await b.agent.delete(api(`/devices/${d.id}`)).expect(404)
		await a.agent.get(api(`/devices/${d.id}`)).expect(200, d)
	})

	it('público: lo lee el anónimo, pero ni él ni otro usuario pueden escribir (403)', async () => {
		const a = await registered()
		const b = await registered()
		const d = await create(a.agent, { visibility: 'public' })
		await anon()
			.get(api(`/devices/${d.id}`))
			.expect(200, d)
		await anon()
			.get(api(`/devices/${d.id}/state`))
			.expect(200, 'false')
		for (const who of [anon(), b.agent]) {
			await who.post(api(`/devices/${d.id}/toggle`)).expect(403)
			await who
				.put(api(`/devices/${d.id}/state`))
				.send({ state: true })
				.expect(403)
			await who
				.patch(api(`/devices/${d.id}/data`))
				.send({ k: 2 })
				.expect(403)
		}
		await b.agent
			.patch(api(`/devices/${d.id}`))
			.send({ name: 'Mía' })
			.expect(403)
		await b.agent.delete(api(`/devices/${d.id}`)).expect(403)
		// Las acciones de administración exigen sesión: anónimo o token → 401.
		await anon()
			.patch(api(`/devices/${d.id}`))
			.send({ name: 'Mía' })
			.expect(401)
		const t = await token(a.agent, ['devices:read', 'devices:write'])
		await anon()
			.delete(api(`/devices/${d.id}`))
			.set(bearer(t.token))
			.expect(401)
		await anon()
			.get(api(`/devices/${d.id}/state`))
			.expect(200, 'false')
	})

	it('GET /state devuelve exactamente true/false y queda en Redis; PUT /state lo cambia', async () => {
		const { agent } = await registered()
		const d = await create(agent)
		await s.c.redis.del(`device:${d.id}`)
		const res = await agent.get(api(`/devices/${d.id}/state`)).expect(200)
		expect(res.type).toBe('application/json')
		expect(res.text).toBe('false')
		expect(JSON.parse((await s.c.redis.get(`device:${d.id}`))!)).toEqual(d)
		const ttl = await s.c.redis.ttl(`device:${d.id}`)
		expect(ttl).toBeGreaterThan(3500)
		expect(ttl).toBeLessThanOrEqual(3600)

		const put = await agent
			.put(api(`/devices/${d.id}/state`))
			.send({ state: true })
			.expect(200)
		expect(Device.parse(put.body).state).toBe(true)
		expect((await agent.get(api(`/devices/${d.id}/state`)).expect(200)).text).toBe('true')
		await agent
			.put(api(`/devices/${d.id}/state`))
			.send({ state: 'si' })
			.expect(400)
	})

	it('toggle atómico: 10 concurrentes dejan el estado esperado y 10 eventos state.changed', async () => {
		const { agent } = await registered()
		const d = await create(agent)
		const results = await Promise.all(
			Array.from({ length: 10 }, () => agent.post(api(`/devices/${d.id}/toggle`)).expect(200)),
		)
		const [row] = await s.c.db.select({ state: devices.state }).from(devices).where(eq(devices.id, d.id))
		expect(row!.state).toBe(false)
		// Cada toggle vio un estado distinto: 5 acabaron en true y 5 en false.
		expect(results.filter((r) => r.body.state).length).toBe(5)
		const events = s.c.mongo.collection('device_events')
		expect(await events.countDocuments({ deviceId: d.id, type: 'state.changed' })).toBe(10)
		// La caché (lo que lee el ESP) termina igual que PG aunque los SET lleguen desordenados.
		expect(JSON.parse((await s.c.redis.get(`device:${d.id}`))!)).toMatchObject({ state: false })
	})

	it('caché: un SET con updatedAt más viejo no pisa uno más nuevo', async () => {
		const { agent } = await registered()
		const d = await create(agent)
		const { body: newer } = await agent.post(api(`/devices/${d.id}/toggle`)).expect(200)
		await makeRedisDeviceCache(s.c.redis).set({ ...newer, state: false, updatedAt: d.updatedAt })
		expect(JSON.parse((await s.c.redis.get(`device:${d.id}`))!)).toMatchObject({ state: true })
	})

	it('data: merge, GET de una clave y 404 si no existe', async () => {
		const { agent } = await registered()
		const d = await create(agent, { data: { brillo: 80, modo: 'dia' } })
		const res = await agent
			.patch(api(`/devices/${d.id}/data`))
			.send({ modo: 'noche', rgb: { r: 1 } })
			.expect(200)
		expect(res.body.data).toEqual({ brillo: 80, modo: 'noche', rgb: { r: 1 } })
		expect((await agent.get(api(`/devices/${d.id}/data/brillo`)).expect(200)).text).toBe('80')
		await agent.get(api(`/devices/${d.id}/data/modo`)).expect(200, '"noche"')
		await agent.get(api(`/devices/${d.id}/data/rgb`)).expect(200, { r: 1 })
		await agent.get(api(`/devices/${d.id}/data/nada`)).expect(404)
		await agent.get(api(`/devices/${d.id}/data/constructor`)).expect(404)
		await agent
			.patch(api(`/devices/${d.id}/data`))
			.send([1, 2])
			.expect(400)

		// Quitar una clave: PATCH no puede (solo mezcla)
		const del = await agent.delete(api(`/devices/${d.id}/data/rgb`)).expect(200)
		expect(del.body.data).toEqual({ brillo: 80, modo: 'noche' })
		await agent.delete(api(`/devices/${d.id}/data/rgb`)).expect(404)
		await agent.delete(api(`/devices/${d.id}/data/constructor`)).expect(404)
		await anon()
			.delete(api(`/devices/${d.id}/data/brillo`))
			.expect(404)
		const [ev] = (await agent.get(api(`/devices/${d.id}/events`)).expect(200)).body
		expect(ev).toMatchObject({ type: 'data.changed', after: { data: { brillo: 80, modo: 'noche' } } })
	})

	it('PATCH de metadatos; eventos del más reciente al más antiguo', async () => {
		const { agent, user } = await registered()
		const d = await create(agent)
		const patched = await agent
			.patch(api(`/devices/${d.id}`))
			.send({ name: 'Lámpara', visibility: 'public', status: 'inactive' })
			.expect(200)
		expect(patched.body).toMatchObject({ name: 'Lámpara', visibility: 'public', status: 'inactive', slug: d.slug })
		await anon()
			.get(api(`/devices/${d.id}`))
			.expect(200, patched.body) // ya es público
		await agent
			.patch(api(`/devices/${d.id}`))
			.send({ slug: 'otro' })
			.expect(200) // slug no es editable: se ignora
		const t = await token(agent, ['devices:write'], d.id)
		await anon()
			.post(api(`/devices/${d.id}/toggle`))
			.set(bearer(t.token))
			.expect(200)
		await agent
			.patch(api(`/devices/${d.id}/data`))
			.send({ a: 1 })
			.expect(200)

		const { body } = await anon()
			.get(api(`/devices/${d.id}/events`))
			.expect(200)
		const events = DeviceEvent.array().parse(body)
		expect(events.map((e) => e.type)).toEqual([
			'data.changed',
			'state.changed',
			'device.updated',
			'device.updated',
			'device.created',
		])
		const ts = events.map((e) => Date.parse(e.ts))
		expect(ts).toEqual([...ts].sort((x, y) => y - x))
		expect(events[0]!.ts).toBe(new Date(ts[0]!).toISOString())
		expect(events[1]).toMatchObject({ actor: { kind: 'token', id: t.id }, source: 'http' })
		expect(events[1]!.after!.state).toBe(true)
		expect(events[4]).toMatchObject({ before: null, after: d, actor: { kind: 'user', id: user.id } })

		await anon()
			.get(api(`/devices/${d.id}/events?limit=2`))
			.expect(200)
			.expect((r) => expect(r.body).toHaveLength(2))
		await anon()
			.get(api(`/devices/${d.id}/events?limit=201`))
			.expect(400)
	})

	it('un token ligado al dispositivo A no puede hacer toggle de B; GET /devices le devuelve solo A', async () => {
		const { agent } = await registered()
		const devA = await create(agent)
		const devB = await create(agent)
		const pubB = await create(agent, { visibility: 'public' })
		const t = await token(agent, ['devices:read', 'devices:write'], devA.id)
		await anon()
			.post(api(`/devices/${devA.id}/toggle`))
			.set(bearer(t.token))
			.expect(200)
		await anon()
			.post(api(`/devices/${devB.id}/toggle`))
			.set(bearer(t.token))
			.expect(404)
		await anon()
			.post(api(`/devices/${pubB.id}/toggle`))
			.set(bearer(t.token))
			.expect(403)
		const { body } = await anon().get(api('/devices')).set(bearer(t.token)).expect(200)
		expect(body.map((x: Device) => x.id)).toEqual([devA.id])
		const reader = await token(agent, ['devices:read'], devA.id)
		await anon()
			.post(api(`/devices/${devA.id}/toggle`))
			.set(bearer(reader.token))
			.expect(403)
	})

	it('DELETE → 204; el token ligado da 401 al instante, desaparece device: y GET da 404', async () => {
		const { agent } = await registered()
		const d = await create(agent)
		const t = await token(agent, ['devices:read'], d.id)
		const hash = makeTokenHasher(s.c.env.TOKEN_PEPPER).hash(t.token)
		await anon()
			.get(api(`/devices/${d.id}/state`))
			.set(bearer(t.token))
			.expect(200, 'false')
		expect(await s.c.redis.exists([`tok:${hash}`, `device:${d.id}`])).toBe(2)

		const res = await agent.delete(api(`/devices/${d.id}`)).expect(204)
		expect(res.text).toBe('')
		expect(await s.c.redis.exists([`tok:${hash}`, `device:${d.id}`])).toBe(0)
		await anon().get(api('/auth/me')).set(bearer(t.token)).expect(401)
		await agent.get(api(`/devices/${d.id}`)).expect(404)
		await agent.delete(api(`/devices/${d.id}`)).expect(404)
		const ev = await s.c.mongo.collection('device_events').findOne({ deviceId: d.id, type: 'device.deleted' })
		expect(ev).toMatchObject({ before: d, after: null })
	})

	it('id inválido → 404', async () => {
		const { agent } = await registered()
		for (const [method, path] of [
			['get', ''],
			['patch', ''],
			['delete', ''],
			['get', '/state'],
			['put', '/state'],
			['post', '/toggle'],
			['get', '/data/k'],
			['patch', '/data'],
			['get', '/events'],
		] as const)
			await agent[method](api(`/devices/no-es-uuid${path}`))
				.send(path === '/state' && method === 'put' ? { state: true } : {})
				.expect(404)
	})
})

describe('bus', () => {
	it('publica el Device después de cada cambio por la conexión de suscripción', async () => {
		const { agent } = await registered()
		const d = await create(agent)
		let resolve!: (dev: Device) => void
		const received = new Promise<Device>((r) => (resolve = r))
		// subscribe() resuelve cuando Redis confirma el SUBSCRIBE: el toggle ya no se lo pierde.
		await s.c.devices.bus.subscribe((dev) => {
			if (dev.id === d.id) resolve(dev)
		})
		const { body } = await agent.post(api(`/devices/${d.id}/toggle`)).expect(200)
		expect(await received).toEqual(body)
		await s.c.redis.ping() // la conexión principal sigue aceptando comandos
	})
})

describe('rate limit general', () => {
	it('301 peticiones de un mismo actor en un minuto → 429; los demás siguen', async () => {
		const { agent } = await registered()
		// Ventana fija por minuto: si está a punto de cerrarse, se espera a la siguiente para que no se reparta.
		const msLeft = 60_000 - (Date.now() % 60_000)
		if (msLeft < 10_000) await new Promise((r) => setTimeout(r, msLeft))
		await Promise.all(Array.from({ length: 300 }, () => agent.get(api('/devices')).expect(200)))
		await agent.get(api('/devices')).expect(429)
		await anon().get(api('/public/devices')).expect(200)
	})
})
