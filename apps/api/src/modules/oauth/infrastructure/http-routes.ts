import { Router, type Request } from 'express'
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js'
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js'
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js'
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js'
import { mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { OAuthMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import { OAUTH_SCOPES, OAuthDecisionInput } from '@atekos/shared'
import { requireUser } from '../../../shared/auth'
import { NotFound } from '../../../shared/errors'
import { parseId } from '../../../shared/params'
import type { OAuthConsent } from '../application/consent'
import { MCP_PATH } from '../application/provider'

// Servidor de autorización (RFC 8414) y metadatos del recurso MCP (RFC 9728). Va en la raíz de la app,
// antes del filtro CSRF: /token y /revoke son form-urlencoded por especificación y no usan cookies.
// No se usa mcpAuthRouter del SDK porque monta /register en la raíz, que es una ruta de la web.
export function oauthServerRoutes({ publicUrl, provider }: { publicUrl: string; provider: OAuthServerProvider }) {
	const url = (path: string) => new URL(path, publicUrl).href
	const metadata: OAuthMetadata = {
		issuer: url('/'),
		authorization_endpoint: url('/api/oauth/authorize'),
		token_endpoint: url('/api/oauth/token'),
		registration_endpoint: url('/api/oauth/register'),
		revocation_endpoint: url('/api/oauth/revoke'),
		response_types_supported: ['code'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		code_challenge_methods_supported: ['S256'],
		token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
		revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
		scopes_supported: [...OAUTH_SCOPES],
	}
	const r = Router()
	r.use(
		mcpAuthMetadataRouter({
			oauthMetadata: metadata,
			resourceServerUrl: new URL(url(MCP_PATH)),
			scopesSupported: [...OAUTH_SCOPES],
			resourceName: 'atekos-pelugios',
		}),
	)
	r.use('/api/oauth/authorize', authorizationHandler({ provider }))
	r.use('/api/oauth/token', tokenHandler({ provider }))
	// 0 = el client_secret de un cliente confidencial no caduca (el SDK pone 30 días y el cliente dejaría de funcionar).
	r.use(
		'/api/oauth/register',
		clientRegistrationHandler({ clientsStore: provider.clientsStore, clientSecretExpirySeconds: 0 }),
	)
	r.use('/api/oauth/revoke', revocationHandler({ provider }))
	return r
}

// El id de petición son 16 bytes en base64url; otra cosa es una petición que no existe.
const requestId = (req: Request<{ id: string }>) => {
	if (!/^[\w-]{22}$/.test(req.params.id)) throw NotFound('Solicitud de autorización')
	return req.params.id
}

// Consentimiento y apps conectadas: solo con la sesión web (va detrás de authenticate y del filtro CSRF).
export function oauthConsentRoutes(consent: OAuthConsent) {
	const r = Router()

	r.get('/requests/:id', async (req, res) => {
		requireUser(req.actor)
		res.json(await consent.getRequest(requestId(req)))
	})

	r.post('/requests/:id', async (req, res) => {
		const { userId } = requireUser(req.actor)
		const { approve } = OAuthDecisionInput.parse(req.body)
		res.json(await consent.decide(userId, requestId(req), approve))
	})

	r.get('/grants', async (req, res) => {
		res.json(await consent.listGrants(requireUser(req.actor).userId))
	})

	r.delete('/grants/:id', async (req, res) => {
		const { userId } = requireUser(req.actor)
		await consent.revokeGrant(userId, parseId(req.params.id, 'App conectada'))
		res.status(204).end()
	})

	return r
}
