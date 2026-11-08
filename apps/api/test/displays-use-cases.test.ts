import { DISPLAY_MAX_FRAME, DisplayTemplate, type DisplayValues } from '@atekos/shared'
import { describe, expect, it, vi } from 'vitest'
import { initialTemplate } from '../src/modules/displays/application/create-display'
import { PatchData } from '../src/modules/displays/application/patch-data'
import { PutTemplate } from '../src/modules/displays/application/put-template'
import type { Actor } from '../src/modules/devices/domain/policy'
import type { DisplayOutbox, DisplayRecord, DisplayRepository } from '../src/modules/displays/domain/ports'
import { AppError } from '../src/shared/errors'

// Sin Docker: fakes en memoria de los puertos.
const owner: Actor = { kind: 'user', userId: 'u-owner' }
const hw = 'md-34B7DA01ABCD'
const record: DisplayRecord = {
	id: 'p1',
	ownerId: 'u-owner',
	hardwareId: hw,
	name: 'Sala',
	activeTemplateId: 'inicio',
	values: { a: 1, b: 'x' },
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
}

function fakes() {
	const repo = {
		findByHardwareId: vi.fn(async (id: string) => (id === hw ? record : null)),
		findTemplate: vi.fn(async () => initialTemplate('Sala')),
		upsertTemplate: vi.fn(async () => {}),
		setActive: vi.fn(),
		mergeValues: vi.fn(async (_id: string, patch: DisplayValues) => ({
			...record,
			values: { ...record.values, ...patch },
		})),
	}
	const outbox = { publish: vi.fn(async () => {}), subscribe: vi.fn(async () => {}) } satisfies DisplayOutbox
	const presence = { add: vi.fn(), renew: vi.fn(), remove: vi.fn(), isOnline: vi.fn(async () => false) }
	return { repo, outbox, deps: { repo: repo as unknown as DisplayRepository, outbox, presence } }
}

describe('límite de trama', () => {
	it('una plantilla válida pero de más de 8192 bytes → 413 sin guardar ni publicar', async () => {
		// 45 textos de 140 «ñ»: menos de 8192 caracteres, pero más de 8192 bytes en UTF-8.
		const big = DisplayTemplate.parse({
			id: 'grande',
			version: 1,
			elements: Array.from({ length: 45 }, () => ({ type: 'text', x: 0, y: 0, value: 'ñ'.repeat(140) })),
			actions: [],
		})
		const frame = JSON.stringify({ type: 'template.set', template: big })
		expect(frame.length).toBeLessThan(DISPLAY_MAX_FRAME)
		expect(Buffer.byteLength(frame)).toBeGreaterThan(DISPLAY_MAX_FRAME)

		const { repo, outbox, deps } = fakes()
		const err = await new PutTemplate(deps).execute(owner, hw, big).catch((e: AppError) => e)
		expect(err).toMatchObject({ status: 413, code: 'message_too_large' })
		expect(repo.upsertTemplate).not.toHaveBeenCalled()
		expect(repo.setActive).not.toHaveBeenCalled()
		expect(outbox.publish).not.toHaveBeenCalled()
	})
})

describe('PatchData', () => {
	it('guarda el merge y publica un patch solo con las claves recibidas', async () => {
		const { repo, outbox, deps } = fakes()
		const res = await new PatchData(deps).execute(owner, hw, { b: 'y', c: null })
		expect(repo.mergeValues).toHaveBeenCalledWith('p1', { b: 'y', c: null })
		expect(res).toEqual({ values: { a: 1, b: 'y', c: null } })
		expect(outbox.publish).toHaveBeenCalledExactlyOnceWith('p1', {
			type: 'data.update',
			templateVersion: 1,
			strategy: 'patch',
			values: { b: 'y', c: null },
		})
	})

	it('una pantalla ajena → 404 sin escribir', async () => {
		const { repo, outbox, deps } = fakes()
		const other: Actor = { kind: 'user', userId: 'u-otro' }
		await expect(new PatchData(deps).execute(other, hw, { b: 'y' })).rejects.toMatchObject({ status: 404 })
		expect(repo.mergeValues).not.toHaveBeenCalled()
		expect(outbox.publish).not.toHaveBeenCalled()
	})
})

it('la plantilla inicial cumple el esquema', () => {
	expect(DisplayTemplate.safeParse(initialTemplate('x'.repeat(80))).success).toBe(true)
})
