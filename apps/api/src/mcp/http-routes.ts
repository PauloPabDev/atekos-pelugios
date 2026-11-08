import { Router } from 'express'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Scope } from '@atekos/shared'
import type { Container } from '../container'
import type { Actor } from '../modules/devices/domain/policy'
import { MCP_PATH } from '../modules/oauth/application/provider'
import { rateLimit } from '../shared/rate-limit'
import { buildMcpServer } from './server'

type OAuth = NonNullable<Container['oauth']>

// El grant OAuth actúa como un token sin ligar: canRead/canWrite/canAdminDisplay/canCreate miran sus scopes.
const actorOf = (auth: AuthInfo): Extract<Actor, { kind: 'token' }> => {
	const { userId, grantId } = auth.extra as { userId: string; grantId: string }
	return { kind: 'token', userId, tokenId: grantId, scopes: auth.scopes as Scope[], deviceId: null, displayId: null }
}

// POST /api/v1/mcp (Streamable HTTP sin estado, docs/MCP.md). Va antes del router de la REST:
// su authenticate rechazaría el token OAuth, que aquí es el único que vale.
export function mcpRoutes(c: Container, oauth: OAuth) {
	const r = Router()
	const auth = requireBearerAuth({
		verifier: oauth.provider,
		// El 401 lleva WWW-Authenticate con resource_metadata: así descubre el cliente dónde autorizarse.
		resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(`${oauth.publicUrl}${MCP_PATH}`)),
	})

	r.post(
		'/',
		auth,
		(req, _res, next) => {
			req.actor = actorOf(req.auth!)
			next()
		},
		// El mismo límite que la REST: 300 por minuto por app conectada.
		rateLimit(c.redis, {
			name: 'mcp',
			windowSec: 60,
			max: 300,
			key: ({ actor }) => (actor.kind === 'token' ? actor.tokenId : 'anon'),
		}),
		async (req, res) => {
			const server = buildMcpServer(c, actorOf(req.auth!))
			const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
			res.on('close', () => {
				void transport.close()
				void server.close()
			})
			await server.connect(transport)
			await transport.handleRequest(req, res, req.body)
		},
	)

	// Sin sesiones no hay stream GET ni DELETE de sesión.
	r.all('/', (_req, res) => {
		res
			.status(405)
			.set('Allow', 'POST')
			.json({ jsonrpc: '2.0', error: { code: -32000, message: 'Método no permitido' }, id: null })
	})

	return r
}
