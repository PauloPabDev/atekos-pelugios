import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, exchange, REDIRECT, registerClient, registeredUser, startAuthorize } from './oauth-helpers'
import { startStack } from './stack'

let s: Awaited<ReturnType<typeof startStack>>
beforeAll(async () => {
	s = await startStack()
})
afterAll(() => s?.stop())

const verify = (token: string) => s.c.oauth!.provider.verifyAccessToken(token)

describe('oauth', () => {
	it('publica los metadatos del servidor de autorización y del recurso MCP', async () => {
		const as = await request(s.url).get('/.well-known/oauth-authorization-server').expect(200)
		expect(as.body).toMatchObject({
			issuer: `${s.url}/`,
			authorization_endpoint: `${s.url}/api/oauth/authorize`,
			token_endpoint: `${s.url}/api/oauth/token`,
			registration_endpoint: `${s.url}/api/oauth/register`,
			revocation_endpoint: `${s.url}/api/oauth/revoke`,
			code_challenge_methods_supported: ['S256'],
			scopes_supported: ['devices:read', 'devices:write', 'displays:write'],
		})
		const prm = await request(s.url).get('/.well-known/oauth-protected-resource/api/v1/mcp').expect(200)
		expect(prm.body).toMatchObject({ resource: `${s.url}/api/v1/mcp`, authorization_servers: [`${s.url}/`] })
	})

	it('authorize → consentimiento → código de un solo uso → tokens que solo valen en el MCP', async () => {
		const { agent, user } = await registeredUser(s.url)
		const { client_id } = await registerClient(s.url)
		const { verifier, to, rid } = await startAuthorize(s.url, client_id)
		expect(to.href).toBe(`${s.url}/autorizar?req=${rid}`)

		await request(s.url).get(`/api/v1/oauth/requests/${rid}`).expect(401)
		const info = await agent.get(`/api/v1/oauth/requests/${rid}`).expect(200)
		expect(info.body).toEqual({
			clientName: 'Claude',
			redirectHost: 'localhost:9999',
			scopes: ['devices:read', 'devices:write', 'displays:write'],
		})

		const decision = await agent.post(`/api/v1/oauth/requests/${rid}`).send({ approve: true }).expect(200)
		const back = new URL(decision.body.redirectTo)
		expect(`${back.origin}${back.pathname}`).toBe(REDIRECT)
		expect(back.searchParams.get('state')).toBe('st-1')
		await agent.get(`/api/v1/oauth/requests/${rid}`).expect(404) // decidir la consume

		const form = {
			grant_type: 'authorization_code',
			code: back.searchParams.get('code')!,
			code_verifier: verifier,
			client_id,
			redirect_uri: REDIRECT,
		}
		const tok = await exchange(s.url, form).expect(200)
		expect(tok.body.access_token).toMatch(/^mcp_/)
		expect(tok.body.refresh_token).toMatch(/^mcr_/)
		expect(tok.body.scope).toBe('devices:read devices:write displays:write')
		expect((await exchange(s.url, form).expect(400)).body.error).toBe('invalid_grant')

		const auth = await verify(tok.body.access_token)
		expect(auth).toMatchObject({ clientId: client_id, extra: { userId: user.id } })
		expect(auth.resource?.href).toBe(`${s.url}/api/v1/mcp`)
		// La REST no acepta tokens OAuth.
		await request(s.url).get('/api/v1/devices').set('authorization', `Bearer ${tok.body.access_token}`).expect(401)
	})

	it('PKCE incorrecto, código de otro cliente o redirect_uri distinto → invalid_grant', async () => {
		const { agent } = await registeredUser(s.url)
		const { client_id } = await registerClient(s.url)
		const other = await registerClient(s.url, { redirect_uris: ['http://localhost:9999/otra'] })
		const { verifier, rid } = await startAuthorize(s.url, client_id)
		const decision = await agent.post(`/api/v1/oauth/requests/${rid}`).send({ approve: true }).expect(200)
		const code = new URL(decision.body.redirectTo).searchParams.get('code')!
		const base = { grant_type: 'authorization_code', code, client_id, redirect_uri: REDIRECT }

		const bad = [
			{ ...base, code_verifier: 'x'.repeat(43) },
			{ ...base, code_verifier: verifier, client_id: other.client_id },
			// Este ya pasa PKCE y consume el código: el canje correcto de después también falla.
			{ ...base, code_verifier: verifier, redirect_uri: 'http://localhost:9999/otra' },
			{ ...base, code_verifier: verifier },
		]
		for (const form of bad) expect((await exchange(s.url, form).expect(400)).body.error).toBe('invalid_grant')
	})

	it('scopes: se quedan los válidos; sin ninguno válido, los tres; resource ajeno → invalid_target', async () => {
		const { agent } = await registeredUser(s.url)
		const narrow = await connect(s.url, agent, { scope: 'devices:read offline_access' })
		expect(narrow.scope).toBe('devices:read')
		const all = await connect(s.url, agent, { scope: 'display:connect' })
		expect(all.scope).toBe('devices:read devices:write displays:write')

		const { client_id } = await registerClient(s.url)
		const { to } = await startAuthorize(s.url, client_id, { resource: 'https://otro.example/mcp' })
		expect(`${to.origin}${to.pathname}`).toBe(REDIRECT)
		expect(to.searchParams.get('error')).toBe('invalid_target')
	})

	it('denegar devuelve access_denied con el state', async () => {
		const { agent } = await registeredUser(s.url)
		const { client_id } = await registerClient(s.url)
		const { rid } = await startAuthorize(s.url, client_id)
		await agent.get('/api/v1/oauth/requests/no-existe').expect(404)
		const res = await agent.post(`/api/v1/oauth/requests/${rid}`).send({ approve: false }).expect(200)
		const back = new URL(res.body.redirectTo)
		expect(back.searchParams.get('error')).toBe('access_denied')
		expect(back.searchParams.get('state')).toBe('st-1')
		expect(back.searchParams.get('code')).toBeNull()
	})

	it('refresh rota: el par anterior deja de valer', async () => {
		const { agent } = await registeredUser(s.url)
		const t = await connect(s.url, agent)
		const form = { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.clientId }
		const next = await exchange(s.url, form).expect(200)
		expect(next.body.refresh_token).not.toBe(t.refresh_token)
		expect(next.body.scope).toBe(t.scope)
		await expect(verify(t.access_token)).rejects.toThrow()
		await verify(next.body.access_token)
		expect((await exchange(s.url, form).expect(400)).body.error).toBe('invalid_grant')
	})

	it('apps conectadas: se listan y revocarlas corta access y refresh; /revoke también', async () => {
		const a = await registeredUser(s.url)
		const b = await registeredUser(s.url)
		const t = await connect(s.url, a.agent)
		const list = await a.agent.get('/api/v1/oauth/grants').expect(200)
		expect(list.body).toHaveLength(1)
		expect(list.body[0]).toMatchObject({ clientName: 'Claude', scopes: t.scope.split(' ') })
		expect((await b.agent.get('/api/v1/oauth/grants').expect(200)).body).toEqual([])

		const id = list.body[0].id
		await b.agent.delete(`/api/v1/oauth/grants/${id}`).expect(404)
		await a.agent.delete(`/api/v1/oauth/grants/${id}`).expect(204)
		await a.agent.delete(`/api/v1/oauth/grants/${id}`).expect(404)
		await expect(verify(t.access_token)).rejects.toThrow()
		const refresh = { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.clientId }
		await exchange(s.url, refresh).expect(400)
		expect((await a.agent.get('/api/v1/oauth/grants').expect(200)).body).toEqual([])

		// RFC 7009: el cliente revoca su propio token.
		const u = await connect(s.url, a.agent)
		await request(s.url)
			.post('/api/oauth/revoke')
			.type('form')
			.send({ token: u.refresh_token, client_id: u.clientId })
			.expect(200)
		await expect(verify(u.access_token)).rejects.toThrow()
	})
})
