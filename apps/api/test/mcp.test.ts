import { readFileSync } from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { METADISPLAY_CONTRACT } from '@atekos/shared/contract'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, registeredUser } from './oauth-helpers'
import { startStack } from './stack'

let s: Awaited<ReturnType<typeof startStack>>
beforeAll(async () => {
	s = await startStack()
})
afterAll(() => s?.stop())

const status = JSON.parse(
	readFileSync(new URL('../../../docs/metadisplay/examples/status-template.json', import.meta.url), 'utf8'),
)

async function mcp(token: string) {
	const client = new Client({ name: 'test', version: '1.0.0' })
	await client.connect(
		new StreamableHTTPClientTransport(new URL(`${s.url}/api/v1/mcp`), {
			requestInit: { headers: { authorization: `Bearer ${token}` } },
		}),
	)
	const call = async (name: string, args: Record<string, unknown> = {}) => {
		const r = (await client.callTool({ name, arguments: args })) as CallToolResult
		const text = r.content[0]?.type === 'text' ? r.content[0].text : ''
		let body: unknown = text
		try {
			body = JSON.parse(text)
		} catch {
			// errores de validación de entrada del SDK: texto plano
		}
		return { isError: r.isError === true, body: body as Record<string, unknown>, text }
	}
	return { client, call }
}

describe('mcp', () => {
	it('sin token → 401 con resource_metadata para descubrir OAuth; GET → 405', async () => {
		const res = await request(s.url).post('/api/v1/mcp').send({ jsonrpc: '2.0', id: 1, method: 'ping' }).expect(401)
		expect(res.headers['www-authenticate']).toContain(
			`resource_metadata="${s.url}/.well-known/oauth-protected-resource/api/v1/mcp"`,
		)
		// Un token de API normal tampoco vale aquí.
		await request(s.url).post('/api/v1/mcp').set('authorization', 'Bearer dmt_x').send({}).expect(401)
		const { agent } = await registeredUser(s.url)
		const t = await connect(s.url, agent)
		await request(s.url).get('/api/v1/mcp').set('authorization', `Bearer ${t.access_token}`).expect(405)
	})

	it('crea y actualiza dispositivos y pantallas con los mismos casos de uso que la REST', async () => {
		const { agent } = await registeredUser(s.url)
		const { client, call } = await mcp((await connect(s.url, agent)).access_token)

		const tools = (await client.listTools()).tools.map((t) => t.name).sort()
		expect(tools).toEqual([
			'create_device',
			'create_display',
			'get_device',
			'get_display',
			'get_display_contract',
			'list_devices',
			'list_displays',
			'set_device_state',
			'set_display_template',
			'update_device_data',
			'update_display_data',
		])

		// El contrato MetaDisplay, como herramienta y como recurso, con el origen de este despliegue.
		const contract = (await call('get_display_contract')).body as { info: { version: string }; servers: object }
		expect(contract.info.version).toBe(METADISPLAY_CONTRACT.version)
		expect(contract.servers).toEqual({ atekos: expect.objectContaining({ host: new URL(s.url).host, protocol: 'ws' }) })
		expect((await call('get_display_contract', { part: 'openapi' })).body.openapi).toBe('3.1.0')
		const resources = (await client.listResources()).resources.map((r) => r.uri).sort()
		expect(resources).toEqual(['atekos://contract/asyncapi.json', 'atekos://contract/openapi.json'])
		const res = await client.readResource({ uri: 'atekos://contract/asyncapi.json' })
		expect(JSON.parse((res.contents[0] as { text: string }).text).asyncapi).toBe('3.0.0')

		const created = await call('create_device', { slug: 'luz-salon', name: 'Luz del salón', type: 'light' })
		expect(created).toMatchObject({ isError: false, body: { slug: 'luz-salon', visibility: 'private', state: false } })
		const id = created.body.id
		expect((await call('set_device_state', { id, state: true })).body.state).toBe(true)
		expect((await call('update_device_data', { id, data: { brillo: 80 } })).body.data).toEqual({ brillo: 80 })
		const rest = await agent.get(`/api/v1/devices/${id}`).expect(200)
		expect(rest.body).toMatchObject({ state: true, data: { brillo: 80 } })
		expect((await call('list_devices')).body).toHaveLength(1)

		const dup = await call('create_device', { slug: 'luz-salon', name: 'Otra' })
		expect(dup).toMatchObject({ isError: true, body: { error: 'conflict' } })
		const missing = await call('get_device', { id: '00000000-0000-4000-8000-000000000000' })
		expect(missing).toMatchObject({ isError: true, body: { error: 'not_found' } })

		const display = await call('create_display', { deviceId: 'md-34b7da01abcd', name: 'Salón' })
		expect(display).toMatchObject({ isError: false, body: { deviceId: 'md-34B7DA01ABCD', activeTemplateId: 'inicio' } })

		const outside = { ...status, elements: [{ type: 'rect', x: 170, y: 0, w: 10, h: 10 }] }
		const bad = await call('set_display_template', { deviceId: 'md-34B7DA01ABCD', template: outside })
		expect(bad.isError).toBe(true)
		expect(bad.text).toContain('se sale de 172×320')

		const tpl = await call('set_display_template', { deviceId: 'md-34B7DA01ABCD', template: status })
		expect(tpl.body).toMatchObject({ activeTemplateId: 'status.v1', template: { version: 2 } })
		const values = { serverStatus: 'OK', daysText: 'hace 2 min' }
		expect((await call('update_display_data', { deviceId: 'md-34B7DA01ABCD', values })).body).toEqual({ values })
		const detail = await call('get_display', { deviceId: 'md-34b7da01abcd' })
		expect(detail.body).toMatchObject({ values, templates: [{ id: 'inicio' }, { id: 'status.v1' }] })
		expect((await agent.get('/api/v1/displays/md-34B7DA01ABCD').expect(200)).body.values).toEqual(values)
	})

	it('los scopes del consentimiento limitan las herramientas; revocar corta el acceso', async () => {
		const { agent } = await registeredUser(s.url)
		const { client, call } = await mcp((await connect(s.url, agent, { scope: 'devices:read' })).access_token)
		expect((await call('list_devices')).body).toEqual([])
		expect(await call('create_device', { slug: 'x', name: 'X' })).toMatchObject({
			isError: true,
			body: { error: 'forbidden' },
		})
		expect(await call('create_display', { deviceId: 'md-000000000001', name: 'X' })).toMatchObject({
			isError: true,
			body: { error: 'forbidden' },
		})
		expect((await call('list_displays')).isError).toBe(true)

		const [grant] = (await agent.get('/api/v1/oauth/grants').expect(200)).body
		await agent.delete(`/api/v1/oauth/grants/${grant.id}`).expect(204)
		await expect(client.listTools()).rejects.toThrow()
	})
})
