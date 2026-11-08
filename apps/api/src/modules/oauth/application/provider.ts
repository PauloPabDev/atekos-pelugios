import { randomBytes } from 'node:crypto'
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import {
	InvalidGrantError,
	InvalidTargetError,
	InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { OAUTH_SCOPES, type Scope } from '@atekos/shared'
import type { TokenHasher } from '../../../shared/crypto'
import type { OAuthRepository, OAuthStore } from '../domain/ports'

export const MCP_PATH = '/api/v1/mcp'
const ACCESS_TTL = 60 * 60
const REFRESH_TTL = 30 * 24 * 60 * 60 // deslizante: cada refresco lo renueva
const REQUEST_TTL = 10 * 60

const isOAuthScope = (s: string): s is (typeof OAUTH_SCOPES)[number] => (OAUTH_SCOPES as readonly string[]).includes(s)
const noSlash = (u: URL | string) => String(u).replace(/\/+$/, '')

type Deps = { repo: OAuthRepository; store: OAuthStore; hasher: TokenHasher; publicUrl: string }

// Servidor de autorización OAuth 2.1 del MCP (docs/MCP.md). El SDK valida cliente, redirect_uri y PKCE;
// aquí se guardan peticiones, códigos y grants. Los tokens solo valen en MCP_PATH, nunca en la REST.
export function makeOAuthProvider({ repo, store, hasher, publicUrl }: Deps): OAuthServerProvider {
	const mcpUrl = `${publicUrl}${MCP_PATH}`
	// RFC 8707: si el cliente dice para qué recurso pide el token, tiene que ser este MCP.
	const checkResource = (resource?: URL) => {
		if (resource && noSlash(resource) !== mcpUrl) throw new InvalidTargetError(`resource debe ser ${mcpUrl}`)
	}
	const issue = (scopes: Scope[]) => {
		const access = `mcp_${randomBytes(32).toString('base64url')}`
		const refresh = `mcr_${randomBytes(32).toString('base64url')}`
		const now = Date.now()
		const pair = {
			accessHash: hasher.hash(access),
			accessExpiresAt: new Date(now + ACCESS_TTL * 1000),
			refreshHash: hasher.hash(refresh),
			refreshExpiresAt: new Date(now + REFRESH_TTL * 1000),
		}
		const tokens: OAuthTokens = {
			access_token: access,
			token_type: 'Bearer',
			expires_in: ACCESS_TTL,
			refresh_token: refresh,
			scope: scopes.join(' '),
		}
		return { pair, tokens }
	}
	const ownCode = async (client: OAuthClientInformationFull, code: string, take: boolean) => {
		const h = hasher.hash(code)
		const c = take ? await store.takeCode(h) : await store.getCode(h)
		if (!c || c.clientId !== client.client_id) throw new InvalidGrantError('Código inválido o caducado')
		return c
	}

	return {
		clientsStore: {
			getClient: (id) => repo.getClient(id),
			// El SDK ya ha puesto client_id y client_id_issued_at (clientIdGeneration por defecto).
			registerClient: (info) => repo.createClient(info as OAuthClientInformationFull),
		},

		// Guarda la petición y manda al navegador a la pantalla de consentimiento de la web (/autorizar).
		async authorize(client, params, res) {
			checkResource(params.resource)
			const asked = (params.scopes ?? []).filter(isOAuthScope)
			const id = randomBytes(16).toString('base64url')
			await store.putRequest(
				id,
				{
					clientId: client.client_id,
					clientName: client.client_name || client.client_id,
					redirectUri: params.redirectUri,
					codeChallenge: params.codeChallenge,
					state: params.state,
					scopes: asked.length ? asked : [...OAUTH_SCOPES],
				},
				REQUEST_TTL,
			)
			res.redirect(302, `${publicUrl}/autorizar?req=${id}`)
		},

		async challengeForAuthorizationCode(client, code) {
			return (await ownCode(client, code, false)).codeChallenge
		},

		// El SDK ya ha comprobado el verificador PKCE contra challengeForAuthorizationCode.
		async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
			const c = await ownCode(client, code, true)
			if (redirectUri !== undefined && redirectUri !== c.redirectUri)
				throw new InvalidGrantError('redirect_uri no coincide')
			checkResource(resource)
			const { pair, tokens } = issue(c.scopes)
			await repo.createGrant({ userId: c.userId, clientId: c.clientId, scopes: c.scopes, ...pair })
			return tokens
		},

		// Rotación (OAuth 2.1 para clientes públicos): el refresh y el access anteriores dejan de valer.
		// shortcut: reusar un refresh ya rotado solo da invalid_grant, no revoca el grant entero;
		// si hiciera falta, guardar el hash anterior y revocar el grant al verlo.
		async exchangeRefreshToken(client, refreshToken, _scopes, resource) {
			checkResource(resource)
			const { pair, tokens } = issue([])
			const g = await repo.rotate(hasher.hash(refreshToken), client.client_id, pair)
			if (!g) throw new InvalidGrantError('Refresh token inválido, caducado o revocado')
			return { ...tokens, scope: g.scopes.join(' ') }
		},

		async verifyAccessToken(token) {
			const g = await repo.findByAccess(hasher.hash(token))
			if (!g) throw new InvalidTokenError('Token inválido, caducado o revocado')
			return {
				token,
				clientId: g.clientId,
				scopes: g.scopes,
				expiresAt: Math.floor(g.accessExpiresAt.getTime() / 1000),
				resource: new URL(mcpUrl),
				extra: { userId: g.userId, grantId: g.id },
			}
		},

		async revokeToken(client, { token }) {
			await repo.revokeByToken(hasher.hash(token), client.client_id)
		},
	}
}
