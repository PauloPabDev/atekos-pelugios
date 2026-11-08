import { CreatedApiToken, Device, TelemetryReading, type Scope } from '@atekos/shared'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
	await agent
		.post(api('/auth/register'))
		.send({ email: `tel${n}@x.com`, username: `tel${n}`, password: 'clave-larga-123' })
		.expect(201)
	return agent
}

async function create(agent: request.Agent, body: Record<string, unknown> = {}) {
	n++
	const res = await agent
		.post(api('/devices'))
		.send({ slug: `s${n}`, name: 'Sensor', type: 'sensor', visibility: 'private', ...body })
		.expect(201)
	return Device.parse(res.body)
}

async function token(agent: request.Agent, scopes: Scope[], deviceId?: string) {
	const res = await agent.post(api('/tokens')).send({ name: 'esp', scopes, deviceId }).expect(201)
	return CreatedApiToken.parse(res.body)
}

// Hace 1 h: dentro de las últimas 24 h (rango por defecto) y lejos del TTL de 365 días.
const base = Date.now() - 60 * 60_000
const at = (i: number) => new Date(base + i * 1000).toISOString()

describe('telemetry', () => {
	it('60 POST con un token dan 201 y el 61.º 429; el GET por rango devuelve las 60 en orden ascendente', async () => {
		const owner = await registered()
		const d = await create(owner)
		const t = await token(owner, ['devices:read', 'telemetry:write'], d.id)
		// Ventana fija por minuto: si está a punto de cerrarse, se espera a la siguiente para que no se reparta.
		const msLeft = 60_000 - (Date.now() % 60_000)
		if (msLeft < 10_000) await new Promise((r) => setTimeout(r, msLeft))

		// Se envían de la más nueva a la más vieja: el GET tiene que ordenarlas por ts.
		const posted = await Promise.all(
			Array.from({ length: 60 }, (_, i) =>
				anon()
					.post(api(`/devices/${d.id}/telemetry`))
					.set(bearer(t.token))
					.send({ ts: at(59 - i), values: { temp: 59 - i, hum: 41 } })
					.expect(201),
			),
		)
		expect(posted[0]!.body).toEqual({ ts: at(59), deviceId: d.id, values: { temp: 59, hum: 41 } })
		await anon()
			.post(api(`/devices/${d.id}/telemetry`))
			.set(bearer(t.token))
			.send({ values: { temp: 1 } })
			.expect(429)
		// El límite es por token: la sesión del dueño sigue escribiendo.
		await owner
			.post(api(`/devices/${d.id}/telemetry`))
			.send({ ts: at(100), values: { temp: 100 } })
			.expect(201)

		const { body } = await owner
			.get(api(`/devices/${d.id}/telemetry`))
			.query({ from: at(0), to: at(59) })
			.expect(200)
		const readings = TelemetryReading.array().parse(body)
		expect(readings.map((r) => r.ts)).toEqual(Array.from({ length: 60 }, (_, i) => at(i)))
		expect(readings.map((r) => r.values.temp)).toEqual(Array.from({ length: 60 }, (_, i) => i))

		// En Mongo: `ts` como Date (timeField) y `deviceId` como string (metaField).
		const doc = await s.c.mongo.collection('telemetry').findOne({ deviceId: d.id, ts: new Date(at(0)) })
		expect(doc).toMatchObject({ ts: new Date(at(0)), deviceId: d.id, values: { temp: 0, hum: 41 } })
	})

	it('rango estrecho, limit, rango por defecto (24 h hasta ahora) y query inválida', async () => {
		const owner = await registered()
		const d = await create(owner)
		const post = (body: Record<string, unknown>) =>
			owner
				.post(api(`/devices/${d.id}/telemetry`))
				.send(body)
				.expect(201)
		await post({ ts: new Date(base - 25 * 60 * 60_000).toISOString(), values: { v: -1 } }) // fuera de 24 h
		for (let i = 0; i < 5; i++) await post({ ts: at(i), values: { v: i } })
		const before = Date.now()
		const { body: now } = await post({ values: { v: 99 } }) // sin ts: hora del servidor
		expect(Date.parse(now.ts)).toBeGreaterThanOrEqual(before)
		expect(Date.parse(now.ts)).toBeLessThanOrEqual(Date.now())

		const get = (query: Record<string, string | number>) => owner.get(api(`/devices/${d.id}/telemetry`)).query(query)
		const values = (r: request.Response) => (r.body as TelemetryReading[]).map((x) => x.values.v)

		expect(values(await get({}).expect(200))).toEqual([0, 1, 2, 3, 4, 99])
		expect(values(await get({ from: at(1), to: at(3) }).expect(200))).toEqual([1, 2, 3])
		expect(values(await get({ limit: 2 }).expect(200))).toEqual([0, 1])
		expect(values(await get({ to: at(2) }).expect(200))).toEqual([0, 1, 2]) // from = to − 24 h
		expect(values(await get({ from: at(4), to: at(4) }).expect(200))).toEqual([4])

		await get({ from: at(3), to: at(1) }).expect(400)
		await get({ from: new Date(Date.now() + 60_000).toISOString() }).expect(400) // from futuro > to = ahora
		await get({ limit: 1001 }).expect(400)
		await get({ limit: 0 }).expect(400)
		await get({ from: 'ayer' }).expect(400)
	})

	it('acceso: sin telemetry:write → 403; privado anónimo → 404; público: el anónimo lee pero no escribe', async () => {
		const owner = await registered()
		const other = await registered()
		const priv = await create(owner)
		const pub = await create(owner, { visibility: 'public' })
		const reading = { values: { temp: 22.5 } }

		const rw = await token(owner, ['devices:read', 'devices:write'])
		await anon()
			.post(api(`/devices/${priv.id}/telemetry`))
			.set(bearer(rw.token))
			.send(reading)
			.expect(403)

		for (const who of [anon(), other]) {
			await who
				.post(api(`/devices/${priv.id}/telemetry`))
				.send(reading)
				.expect(404)
			await who.get(api(`/devices/${priv.id}/telemetry`)).expect(404)
		}

		const { body: posted } = await owner
			.post(api(`/devices/${pub.id}/telemetry`))
			.send(reading)
			.expect(201)
		await anon()
			.get(api(`/devices/${pub.id}/telemetry`))
			.expect(200, [posted])
		for (const who of [anon(), other])
			await who
				.post(api(`/devices/${pub.id}/telemetry`))
				.send(reading)
				.expect(403)
	})

	it('cuerpo inválido → 400; id inválido → 404', async () => {
		const owner = await registered()
		const d = await create(owner)
		for (const body of [{ values: { temp: 'alta' } }, {}, { values: { t: 1 }, ts: 'ayer' }])
			await owner
				.post(api(`/devices/${d.id}/telemetry`))
				.send(body)
				.expect(400)
		await owner
			.post(api('/devices/no-es-uuid/telemetry'))
			.send({ values: { t: 1 } })
			.expect(404)
		await owner.get(api('/devices/no-es-uuid/telemetry')).expect(404)
	})
})
