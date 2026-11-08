import type { Device } from '@atekos/shared'
import { describe, expect, it, vi } from 'vitest'
import { GetState } from '../src/modules/devices/application/get-state'
import { makeOnDeviceChanged, type DeviceChange } from '../src/modules/devices/application/on-device-changed'
import { ToggleState } from '../src/modules/devices/application/toggle-state'
import type { Actor } from '../src/modules/devices/domain/policy'
import type { DeviceCache, DeviceRepository } from '../src/modules/devices/domain/ports'
import { AppError } from '../src/shared/errors'

// Sin Docker: fakes en memoria de los puertos.
const owner = 'u-owner'
const device = (over: Partial<Device> = {}): Device => ({
	id: 'd1',
	ownerId: owner,
	slug: 'luz',
	name: 'Luz',
	description: '',
	type: 'light',
	state: false,
	data: {},
	visibility: 'private',
	status: 'active',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	...over,
})

function fakeRepo(...initial: Device[]) {
	const rows = new Map(initial.map((d) => [d.id, d]))
	const fake = {
		findById: vi.fn(async (id: string) => rows.get(id) ?? null),
		toggleState: vi.fn(async (id: string) => {
			const d = { ...rows.get(id)!, state: !rows.get(id)!.state }
			rows.set(id, d)
			return d
		}),
	}
	return { fake, repo: fake as unknown as DeviceRepository }
}

function fakeCache(...initial: Device[]) {
	const rows = new Map(initial.map((d) => [d.id, d]))
	return {
		get: vi.fn(async (id: string) => rows.get(id) ?? null),
		set: vi.fn(async (d: Device) => void rows.set(d.id, d)),
		delete: vi.fn(async (id: string) => void rows.delete(id)),
	} satisfies DeviceCache
}

const status = (p: Promise<unknown>) =>
	p.then(
		() => 'ok',
		(err: AppError) => err.status,
	)

describe('ToggleState', () => {
	const ownerActor: Actor = { kind: 'user', userId: owner }

	it('un privado ajeno → NotFound, sin tocar el estado', async () => {
		const { fake, repo } = fakeRepo(device())
		const toggle = new ToggleState({ repo, onChanged: vi.fn() })
		expect(await status(toggle.execute({ kind: 'user', userId: 'u-otro' }, 'd1', 'http'))).toBe(404)
		expect(await status(toggle.execute({ kind: 'anonymous' }, 'd1', 'http'))).toBe(404)
		expect(await status(toggle.execute(ownerActor, 'no-existe', 'http'))).toBe(404)
		expect(fake.toggleState).not.toHaveBeenCalled()
	})

	it('un token solo con devices:read → Forbidden', async () => {
		const { fake, repo } = fakeRepo(device())
		const toggle = new ToggleState({ repo, onChanged: vi.fn() })
		const reader: Actor = { kind: 'token', userId: owner, tokenId: 't1', scopes: ['devices:read'], deviceId: null }
		expect(await status(toggle.execute(reader, 'd1', 'ws'))).toBe(403)
		expect(fake.toggleState).not.toHaveBeenCalled()
	})

	it('si todo va bien, llama a onChanged con before y after', async () => {
		const before = device()
		const { repo } = fakeRepo(before)
		const onChanged = vi.fn(async () => {})
		const after = await new ToggleState({ repo, onChanged }).execute(ownerActor, 'd1', 'ws')
		expect(after.state).toBe(true)
		expect(onChanged).toHaveBeenCalledExactlyOnceWith({
			type: 'state.changed',
			before,
			after,
			actor: ownerActor,
			source: 'ws',
		})
	})
})

describe('GetState', () => {
	it('si está en caché no toca el repositorio', async () => {
		const { fake, repo } = fakeRepo(device({ state: false }))
		const cache = fakeCache(device({ state: true }))
		expect(await new GetState({ repo, cache }).execute({ kind: 'user', userId: owner }, 'd1')).toBe(true)
		expect(fake.findById).not.toHaveBeenCalled()
	})

	it('si no está, lo lee del repositorio y lo guarda en caché', async () => {
		const d = device({ state: true, visibility: 'public' })
		const { fake, repo } = fakeRepo(d)
		const cache = fakeCache()
		expect(await new GetState({ repo, cache }).execute({ kind: 'anonymous' }, 'd1')).toBe(true)
		expect(fake.findById).toHaveBeenCalledOnce()
		expect(cache.set).toHaveBeenCalledExactlyOnceWith(d)
	})

	it('privado y sin permiso → NotFound, aunque venga de la caché', async () => {
		const { repo } = fakeRepo()
		expect(await status(new GetState({ repo, cache: fakeCache(device()) }).execute({ kind: 'anonymous' }, 'd1'))).toBe(
			404,
		)
	})
})

describe('onDeviceChanged', () => {
	const change: DeviceChange = {
		type: 'state.changed',
		before: device(),
		after: device({ state: true }),
		actor: { kind: 'token', userId: owner, tokenId: 't1', scopes: ['devices:write'], deviceId: 'd1' },
		source: 'http',
	}

	it('caché → publicación → historial; si falla el historial, no lanza y lo registra', async () => {
		const calls: string[] = []
		const logger = { error: vi.fn() }
		const onChanged = makeOnDeviceChanged({
			cache: { ...fakeCache(), set: async () => void calls.push('cache') },
			bus: { publish: async () => void calls.push('bus'), subscribe: async () => {} },
			eventLog: {
				append: async (e) => {
					calls.push('log')
					expect(e).toMatchObject({ deviceId: 'd1', ownerId: owner, actor: { kind: 'token', id: 't1' } })
					throw new Error('mongo caído')
				},
				list: async () => [],
			},
			logger,
		})
		await expect(onChanged(change)).resolves.toBeUndefined()
		expect(calls).toEqual(['cache', 'bus', 'log'])
		expect(logger.error).toHaveBeenCalledOnce()
	})
})
