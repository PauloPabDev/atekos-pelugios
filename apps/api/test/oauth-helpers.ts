import { createHash, randomBytes } from 'node:crypto'
import request from 'supertest'
import { expect } from 'vitest'

export const REDIRECT = 'http://localhost:9999/callback'

let n = 0
export async function registeredUser(url: string) {
	n++
	const agent = request.agent(url)
	const res = await agent
		.post('/api/v1/auth/register')
		.send({ email: `oauth${n}-${Date.now()}@x.com`, username: `oauth${n}_${Date.now()}`, password: 'clave-larga-123' })
		.expect(201)
	return { agent, user: res.body as { id: string } }
}

export async function registerClient(url: string, body: Record<string, unknown> = {}) {
	const res = await request(url)
		.post('/api/oauth/register')
		.send({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', ...body })
		.expect(201)
	return res.body as { client_id: string; client_secret?: string }
}

// GET /authorize como lo haría el navegador; devuelve el id de la petición que espera consentimiento.
export async function startAuthorize(url: string, clientId: string, o: { scope?: string; resource?: string } = {}) {
	const verifier = randomBytes(32).toString('base64url')
	const q = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: REDIRECT,
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		code_challenge_method: 'S256',
		state: 'st-1',
		resource: o.resource ?? `${url}/api/v1/mcp`,
		...(o.scope !== undefined && { scope: o.scope }),
	})
	const res = await request(url).get(`/api/oauth/authorize?${q}`).expect(302)
	const to = new URL(res.headers.location!)
	return { verifier, to, rid: to.searchParams.get('req') }
}

export const exchange = (url: string, form: Record<string, string>) =>
	request(url).post('/api/oauth/token').type('form').send(form)

// Flujo completo: registro DCR → authorize → consentimiento con la sesión → canje del código.
export async function connect(url: string, agent: request.Agent, o: { scope?: string } = {}) {
	const { client_id } = await registerClient(url)
	const { verifier, rid } = await startAuthorize(url, client_id, o)
	const decision = await agent.post(`/api/v1/oauth/requests/${rid}`).send({ approve: true }).expect(200)
	const code = new URL(decision.body.redirectTo).searchParams.get('code')!
	const res = await exchange(url, {
		grant_type: 'authorization_code',
		code,
		code_verifier: verifier,
		client_id,
		redirect_uri: REDIRECT,
	}).expect(200)
	expect(res.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600 })
	return { clientId: client_id, ...(res.body as { access_token: string; refresh_token: string; scope: string }) }
}
