import { DISPLAY_MAX_TEMPLATE_BYTES, DisplayTemplate, DisplayTemplateShape } from '@atekos/shared'
import { describe, expect, it } from 'vitest'
import { displayGuide } from '../src/mcp/guide'

const guide = displayGuide(DISPLAY_MAX_TEMPLATE_BYTES)
const blocks = [...guide.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]!) as unknown)

// Las imágenes de la guía van por referencia: esas solo se comprueban en su forma (el servidor las resuelve).
const check = (t: unknown) => {
	const r = (JSON.stringify(t).includes('"ref:') ? DisplayTemplateShape : DisplayTemplate).safeParse(t)
	expect(r.error?.issues ?? [], JSON.stringify(t).slice(0, 80)).toEqual([])
}

describe('guía del MCP', () => {
	it('cada plantilla y cada elemento de ejemplo es válido', () => {
		expect(blocks.length).toBeGreaterThan(8)
		let templates = 0
		for (const b of blocks) {
			if (Array.isArray(b)) for (const e of b) check({ id: 'x', version: 1, elements: [e], actions: [] })
			const o = b as Record<string, unknown>
			const t = o.template ?? (o.elements && o.actions ? o : undefined)
			if (t) {
				check(t)
				templates++
			}
		}
		expect(templates).toBeGreaterThanOrEqual(8)
	})
})
