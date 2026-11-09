import { Device, Schedule } from '@atekos/shared'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { schedules } from '../src/db/schema'
import { startStack } from './stack'

let s: Awaited<ReturnType<typeof startStack>>
beforeAll(async () => {
	s = await startStack()
})
afterAll(() => s?.stop())

const api = (path: string) => `/api/v1${path}`
let n = 0
async function registered() {
	n++
	const agent = request.agent(s.url)
	await agent
		.post(api('/auth/register'))
		.send({ email: `prog${n}@x.com`, username: `prog${n}`, password: 'clave-larga-123' })
		.expect(201)
	return agent
}
async function device(agent: request.Agent) {
	const res = await agent
		.post(api('/devices'))
		.send({ slug: `luz${++n}`, name: 'Luz', type: 'light' })
		.expect(201)
	return Device.parse(res.body)
}
async function display(agent: request.Agent) {
	const id = `md-${String(++n).padStart(12, '0')}`
	await agent.post(api('/displays')).send({ deviceId: id, name: 'Cocina' }).expect(201)
	return id.toUpperCase().replace('MD-', 'md-')
}

const weekly = { repeat: 'weekly', days: [1, 2, 3, 4, 5], time: '19:00', timezone: 'Europe/Madrid' }
// Fuerza a que toque ya (hace `agoMs`), como si el reloj hubiese llegado
const makeDue = (id: string, agoMs = 1000) =>
	s.c.db
		.update(schedules)
		.set({ nextRunAt: new Date(Date.now() - agoMs) })
		.where(eq(schedules.id, id))

describe('programas', () => {
	it('crear, listar, pausar (sin perder el nombre) y reanudar', async () => {
		const a = await registered()
		const d = await device(a)
		const res = await a
			.post(api(`/devices/${d.id}/schedules`))
			.send({ name: 'Noche', when: weekly, action: { type: 'device.on' } })
			.expect(201)
		const p = Schedule.parse(res.body)
		expect(p).toMatchObject({ name: 'Noche', enabled: true, target: { kind: 'device', id: d.id }, lastResult: null })
		expect(new Date(p.nextRunAt!).getTime()).toBeGreaterThan(Date.now())

		const list = await a.get(api(`/devices/${d.id}/schedules`)).expect(200)
		expect(list.body.map((x: Schedule) => x.id)).toEqual([p.id])

		const paused = await a
			.patch(api(`/schedules/${p.id}`))
			.send({ enabled: false })
			.expect(200)
		expect(paused.body).toMatchObject({ name: 'Noche', enabled: false, nextRunAt: null })
		const resumed = await a
			.patch(api(`/schedules/${p.id}`))
			.send({ enabled: true })
			.expect(200)
		expect(resumed.body.nextRunAt).toBe(p.nextRunAt)

		expect((await a.get(api('/schedules')).expect(200)).body).toHaveLength(1)
		await a.delete(api(`/schedules/${p.id}`)).expect(204)
		expect((await a.get(api(`/devices/${d.id}/schedules`)).expect(200)).body).toEqual([])
	})

	it('validación: acción de otro destino, fecha pasada, sin sesión', async () => {
		const a = await registered()
		const d = await device(a)
		const path = api(`/devices/${d.id}/schedules`)
		const bad = await a
			.post(path)
			.send({ when: weekly, action: { type: 'display.refresh' } })
			.expect(422)
		expect(bad.body.error).toBe('invalid_action')
		const past = { repeat: 'once', date: '2020-01-01', time: '10:00', timezone: 'Europe/Madrid' }
		expect(
			(
				await a
					.post(path)
					.send({ when: past, action: { type: 'device.off' } })
					.expect(422)
			).body.error,
		).toBe('schedule_in_past')
		await request(s.url).get(path).expect(401)
	})

	it('los programas son del dueño: otro usuario recibe 404 en todo', async () => {
		const a = await registered()
		const b = await registered()
		const d = await device(a)
		const { body } = await a
			.post(api(`/devices/${d.id}/schedules`))
			.send({ when: weekly, action: { type: 'device.toggle' } })
			.expect(201)
		await b.get(api(`/devices/${d.id}/schedules`)).expect(404)
		await b
			.post(api(`/devices/${d.id}/schedules`))
			.send({ when: weekly, action: { type: 'device.on' } })
			.expect(404)
		await b
			.patch(api(`/schedules/${body.id}`))
			.send({ enabled: false })
			.expect(404)
		await b.delete(api(`/schedules/${body.id}`)).expect(404)
		expect((await b.get(api('/schedules')).expect(200)).body).toEqual([])
	})

	it('el ejecutor enciende el dispositivo, deja rastro «schedule» y apunta a la siguiente', async () => {
		const a = await registered()
		const d = await device(a)
		const { body } = await a
			.post(api(`/devices/${d.id}/schedules`))
			.send({ when: weekly, action: { type: 'device.on' } })
			.expect(201)
		await makeDue(body.id)
		expect(await s.c.schedules.runDue.execute()).toBeGreaterThanOrEqual(1)

		expect((await a.get(api(`/devices/${d.id}`)).expect(200)).body.state).toBe(true)
		const [ev] = (await a.get(api(`/devices/${d.id}/events`)).expect(200)).body
		expect(ev).toMatchObject({ type: 'state.changed', source: 'schedule', actor: { kind: 'user' } })
		const [after] = (await a.get(api(`/devices/${d.id}/schedules`)).expect(200)).body
		expect(after).toMatchObject({ lastResult: 'ok', enabled: true })
		expect(new Date(after.nextRunAt).getTime()).toBeGreaterThan(Date.now())
		expect(after.lastRunAt).not.toBeNull()
	})

	it('vencido hace mucho → «missed» sin actuar; una vez → queda pausado; pantalla sin conexión → «offline»', async () => {
		const a = await registered()
		const d = await device(a)
		const once = { repeat: 'once', date: '2099-01-01', time: '10:00', timezone: 'Europe/Madrid' }
		const late = (await a.post(api(`/devices/${d.id}/schedules`)).send({ when: once, action: { type: 'device.on' } }))
			.body
		await makeDue(late.id, 60 * 60_000)
		// Como si la fecha ya hubiera llegado (crear con fecha pasada da 422)
		await s.c.db
			.update(schedules)
			.set({ when: { ...once, date: '2026-01-01' } as never })
			.where(eq(schedules.id, late.id))

		const hw = await display(a)
		const cmd = (
			await a
				.post(api(`/displays/${hw}/schedules`))
				.send({ when: weekly, action: { type: 'display.brightness', percent: 10 } })
				.expect(201)
		).body
		expect(cmd.target).toEqual({ kind: 'display', id: hw })
		await makeDue(cmd.id)

		await s.c.schedules.runDue.execute()
		expect((await a.get(api(`/devices/${d.id}`)).expect(200)).body.state).toBe(false)
		const [l] = (await a.get(api(`/devices/${d.id}/schedules`))).body
		expect(l).toMatchObject({ lastResult: 'missed', enabled: false, nextRunAt: null })
		const [c] = (await a.get(api(`/displays/${hw}/schedules`)).expect(200)).body
		expect(c).toMatchObject({ lastResult: 'offline', enabled: true })
	})
})
