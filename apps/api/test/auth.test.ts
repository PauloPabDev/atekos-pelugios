import { ApiToken, CreatedApiToken, type Scope } from '@atekos/shared'
import { sql } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiTokens, devices } from '../src/db/schema'
import { makeTokenHasher } from '../src/shared/crypto'
import { startStack } from './stack'

let s: Awaited<ReturnType<typeof startStack>>
beforeAll(async () => {
	s = await startStack()
})
afterAll(() => s?.stop())

const api = (path: string) => `/api/v1${path}`
const password = 'clave-larga-123'

// Emails únicos por test: el rate limit de login va por IP + email.
let n = 0
const newUser = () => {
	n++
	return { email: `user${n}@x.com`, username: `user${n}`, password }
}

const sidOf = (res: request.Response) => res.get('Set-Cookie')![0]!.split(';')[0]!

// Registra un usuario nuevo; el agente guarda la cookie de sesión.
async function registered() {
	const agent = request.agent(s.url)
	const res = await agent.post(api('/auth/register')).send(newUser()).expect(201)
	return { agent, user: res.body as { id: string; email: string; username: string }, sid: sidOf(res) }
}

describe('auth', () => {
	it('register: 201 con el User y la cookie de sesión; /auth/me la acepta', async () => {
		const u = newUser()
		const res = await request(s.url)
			.post(api('/auth/register'))
			.send({ ...u, email: u.email.toUpperCase() })
			.expect(201)
		expect(res.body).toEqual({ id: expect.any(String), email: u.email, username: u.username })
		const cookie = res.get('Set-Cookie')![0]!
		expect(cookie).toMatch(/^sid=[\w-]{43};/)
		expect(cookie).toContain('Max-Age=604800')
		expect(cookie).toContain('Path=/')
		expect(cookie).toContain('HttpOnly')
		expect(cookie).toContain('SameSite=Lax')
		expect(cookie).not.toContain('Secure') // solo en producción
		await request(s.url).get(api('/auth/me')).set('cookie', sidOf(res)).expect(200, res.body)
	})

	it('email o username repetidos → 409', async () => {
		const u = newUser()
		await request(s.url).post(api('/auth/register')).send(u).expect(201)
		const dupEmail = await request(s.url)
			.post(api('/auth/register'))
			.send({ ...u, username: `${u.username}b` })
			.expect(409)
		expect(dupEmail.body.error).toBe('conflict')
		await request(s.url)
			.post(api('/auth/register'))
			.send({ ...u, email: `b${u.email}` })
			.expect(409)
	})

	it('login correcto: 200 con el User y una sesión nueva', async () => {
		const { user } = await registered()
		const agent = request.agent(s.url)
		const res = await agent.post(api('/auth/login')).send({ email: user.email, password }).expect(200)
		expect(res.body).toEqual(user)
		await agent.get(api('/auth/me')).expect(200, user)
	})

	it('contraseña mala y email inexistente → 401 con el mismo mensaje', async () => {
		const { user } = await registered()
		const bad = await request(s.url)
			.post(api('/auth/login'))
			.send({ email: user.email, password: 'no-es-esta' })
			.expect(401)
		const ghost = await request(s.url)
			.post(api('/auth/login'))
			.send({ email: 'nadie@x.com', password: 'no-es-esta' })
			.expect(401)
		expect(bad.body).toEqual(ghost.body)
		expect(bad.headers['set-cookie']).toBeUndefined()
	})

	it('login malo 6 veces → la 6.ª da 429', async () => {
		const { user } = await registered()
		// La ventana es fija por minuto: si está a punto de cerrarse, se espera a la siguiente para que no se reparta.
		const msLeft = 60_000 - (Date.now() % 60_000)
		if (msLeft < 5_000) await new Promise((r) => setTimeout(r, msLeft))
		const login = () => request(s.url).post(api('/auth/login')).send({ email: user.email, password: 'no-es-esta' })
		for (let i = 0; i < 5; i++) await login().expect(401)
		await login().expect(429)
		// También con la contraseña buena: el límite va antes de comprobar credenciales.
		await request(s.url).post(api('/auth/login')).send({ email: user.email, password }).expect(429)
	})

	it('logout: 204, limpia la cookie y la vieja deja de valer', async () => {
		const { agent, sid } = await registered()
		const res = await agent.post(api('/auth/logout')).expect(204)
		expect(res.get('Set-Cookie')![0]).toMatch(/^sid=;.*Expires=Thu, 01 Jan 1970/)
		await request(s.url).get(api('/auth/me')).set('cookie', sid).expect(401)
		await request(s.url).post(api('/auth/logout')).set('cookie', sid).expect(401)
	})

	it('sin sesión ni token, /auth/me → 401', async () => {
		await request(s.url).get(api('/auth/me')).expect(401)
	})
})

describe('tokens', () => {
	const hashOf = (plain: string) => makeTokenHasher(s.c.env.TOKEN_PEPPER).hash(plain)
	const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

	async function createToken(agent: request.Agent, body: { scopes?: Scope[]; [k: string]: unknown } = {}) {
		const res = await agent
			.post(api('/tokens'))
			.send({ name: 'esp', scopes: ['devices:read'], ...body })
			.expect(201)
		return CreatedApiToken.parse(res.body)
	}

	it('crear devuelve el token en claro una sola vez; GET /tokens nunca lo incluye ni el hash', async () => {
		const { agent } = await registered()
		const created = await createToken(agent, { scopes: ['devices:read', 'telemetry:write'], expiresInDays: 30 })
		expect(created.token).toMatch(/^dmt_[\w-]{43}$/)
		expect(created.prefix).toBe(created.token.slice(0, 10))
		expect(created.deviceId).toBeNull()
		const days = (Date.parse(created.expiresAt!) - Date.now()) / 86_400_000
		expect(days).toBeGreaterThan(29.9)
		expect(days).toBeLessThanOrEqual(30)

		const { body } = await agent.get(api('/tokens')).expect(200)
		expect(body).toHaveLength(1)
		expect(ApiToken.parse(body[0])).toEqual(body[0])
		expect(body[0]).not.toHaveProperty('token')
		expect(JSON.stringify(body)).not.toContain(created.token)
		expect(JSON.stringify(body)).not.toContain(hashOf(created.token))
	})

	it('/auth/me con Bearer funciona y marca el último uso; un Bearer inválido → 401', async () => {
		const { agent, user } = await registered()
		const { token } = await createToken(agent)
		await request(s.url).get(api('/auth/me')).set(bearer(token)).expect(200, user)
		const { body } = await agent.get(api('/tokens')).expect(200)
		expect(body[0].lastUsedAt).not.toBeNull()
		await request(s.url).get(api('/auth/me')).set(bearer('dmt_falso')).expect(401)
	})

	it('un token revocado recibe 401 de inmediato, aunque estuviera en caché', async () => {
		const { agent } = await registered()
		const t = await createToken(agent)
		await request(s.url).get(api('/auth/me')).set(bearer(t.token)).expect(200) // queda en tok:{hash}
		expect(await s.c.redis.exists(`tok:${hashOf(t.token)}`)).toBe(1)

		await agent.delete(api(`/tokens/${t.id}`)).expect(204)
		await request(s.url).get(api('/auth/me')).set(bearer(t.token)).expect(401)

		// Sigue en la lista, marcado como revocado, y la más reciente va primero.
		const newer = await createToken(agent)
		const { body } = await agent.get(api('/tokens')).expect(200)
		expect(body.map((x: ApiToken) => x.id)).toEqual([newer.id, t.id])
		expect(body[1].revokedAt).not.toBeNull()
	})

	it('revocar: un token de otro usuario, un id inexistente o un id no uuid → 404', async () => {
		const a = await registered()
		const b = await registered()
		const t = await createToken(a.agent)
		await b.agent.delete(api(`/tokens/${t.id}`)).expect(404)
		await a.agent.delete(api('/tokens/00000000-0000-4000-8000-000000000000')).expect(404)
		await a.agent.delete(api('/tokens/no-es-uuid')).expect(404)
		await request(s.url).get(api('/auth/me')).set(bearer(t.token)).expect(200)
	})

	it('un token vencido recibe 401 y su caché nunca dura más que él', async () => {
		const { agent } = await registered()
		const t = await createToken(agent, { expiresInDays: 1 })
		const hash = hashOf(t.token)
		const expireIn = (secs: number) =>
			s.c.db
				.update(apiTokens)
				.set({ expiresAt: sql`now() + make_interval(secs => ${secs})` })
				.where(sql`${apiTokens.id} = ${t.id}`)

		await expireIn(5)
		await request(s.url).get(api('/auth/me')).set(bearer(t.token)).expect(200)
		const ttl = await s.c.redis.ttl(`tok:${hash}`)
		expect(ttl).toBeGreaterThan(0)
		expect(ttl).toBeLessThanOrEqual(5)

		await expireIn(-1)
		await s.c.redis.del(`tok:${hash}`) // lo que habría hecho el TTL de arriba
		await request(s.url).get(api('/auth/me')).set(bearer(t.token)).expect(401)
	})

	it('un Bearer no puede crear, listar ni revocar tokens; sin sesión tampoco', async () => {
		const { agent } = await registered()
		const t = await createToken(agent, { scopes: ['devices:read', 'devices:write', 'telemetry:write'] })
		await request(s.url)
			.post(api('/tokens'))
			.set(bearer(t.token))
			.send({ name: 'otro', scopes: ['devices:read'] })
			.expect(401)
		await request(s.url).get(api('/tokens')).set(bearer(t.token)).expect(401)
		await request(s.url)
			.delete(api(`/tokens/${t.id}`))
			.set(bearer(t.token))
			.expect(401)
		await request(s.url).get(api('/tokens')).expect(401)
	})

	it('deviceId: propio → 201 ligado; de otro usuario o inexistente → 404', async () => {
		const a = await registered()
		const b = await registered()
		const [mine, theirs] = await s.c.db
			.insert(devices)
			.values([
				{ ownerId: a.user.id, slug: 'luz', name: 'Luz' },
				{ ownerId: b.user.id, slug: 'luz', name: 'Luz' },
			])
			.returning({ id: devices.id })
		expect((await createToken(a.agent, { deviceId: mine!.id })).deviceId).toBe(mine!.id)
		await a.agent
			.post(api('/tokens'))
			.send({ name: 'esp', scopes: ['devices:read'], deviceId: theirs!.id })
			.expect(404)
		await a.agent
			.post(api('/tokens'))
			.send({ name: 'esp', scopes: ['devices:read'], deviceId: '00000000-0000-4000-8000-000000000000' })
			.expect(404)
	})
})
