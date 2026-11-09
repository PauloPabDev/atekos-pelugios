import { readFileSync } from 'node:fs'
import { DisplayClientMessage, DisplayServerMessage } from '@atekos/shared'
import { METADISPLAY_CONTRACT, metaDisplayAsyncApi, metaDisplayOpenApi } from '@atekos/shared/contract'
import { describe, expect, it } from 'vitest'

const doc = (path: string) => readFileSync(new URL(`../../../docs/metadisplay/${path}`, import.meta.url), 'utf8')
const generated = (name: string) => JSON.parse(doc(`generado/${name}`))

// Tipos de mensaje del protocolo oficial (CONTRATO.md §4–§6).
const OFFICIAL = [
	'device.hello',
	'template.set',
	'template.ack',
	'data.update',
	'data.ack',
	'touch.tap',
	'ui.result',
	'event.ack',
	'display.refresh',
	'display.brightness',
	'trust.stage',
	'trust.ack',
	'trust.activate',
	'ota.install',
	'ota.ack',
]
// Los que el servidor aún no envía (DISENO §1: hasta homologar el hardware).
const NOT_YET = ['trust.stage', 'trust.activate', 'ota.install']
// Extensiones propias (DISENO §1 ≠): mensajes troceados (1.1) y ficha de la placa (1.3).
const EXTENSIONS = ['device.info', 'display.info', 'frag', 'frag.ack']

describe('contrato MetaDisplay', () => {
	it('docs/metadisplay/generado/ está al día con los esquemas (si no: pnpm contract)', () => {
		const openapi = generated('openapi.json')
		const origin = openapi.servers[0].url.replace(/\/api\/v1$/, '')
		expect(openapi).toEqual(metaDisplayOpenApi(origin))
		expect(generated('asyncapi.json')).toEqual(metaDisplayAsyncApi(origin))
		expect(openapi.info).toMatchObject({
			version: METADISPLAY_CONTRACT.version,
			'x-updated': METADISPLAY_CONTRACT.updatedAt,
		})
	})

	it('cubre los mensajes del protocolo oficial salvo los comandos pendientes de homologar, más las extensiones propias', () => {
		const { components } = metaDisplayAsyncApi('https://x.example') as { components: { messages: object } }
		const messages = Object.keys(components.messages)
		expect(OFFICIAL.filter((t) => !messages.includes(t))).toEqual(NOT_YET)
		expect(messages.filter((t) => !OFFICIAL.includes(t)).sort()).toEqual(EXTENSIONS)
	})

	it('los esquemas aceptan todos los ejemplos JSON del CONTRATO.md oficial', () => {
		// Bloques ```json y fragmentos `…{json}…` del documento oficial que llevan "type".
		const md = doc('CONTRATO.md')
		const snippets = [...md.matchAll(/```json\n([\s\S]*?)```/g), ...md.matchAll(/`[^`\n]*?(\{[^`\n]*\})`/g)].map(
			(m) => m[1]!,
		)
		const examples = snippets
			.map((s) => {
				try {
					return JSON.parse(s) as { type?: string }
				} catch {
					return null
				}
			})
			.filter((e): e is { type: string } => typeof e?.type === 'string')
		const types = examples.map((e) => e.type)
		expect(types).toEqual(
			expect.arrayContaining([
				'device.hello',
				'template.set',
				'template.ack',
				'data.update',
				'touch.tap',
				'ui.result',
				'event.ack',
			]),
		)
		for (const e of examples) {
			const r = (
				DisplayClientMessage.options.some((o) => o.shape.type.value === e.type)
					? DisplayClientMessage
					: DisplayServerMessage
			).safeParse(e)
			expect(r.success, `${e.type}: ${JSON.stringify(r.error?.issues)}`).toBe(true)
		}
	})
})
