import type { Device } from '@atekos/shared'
import { describe, expect, it, vi } from 'vitest'
import type { GetDevice } from '../src/modules/devices/application/get-device'
import type { Actor } from '../src/modules/devices/domain/policy'
import { IngestTelemetry } from '../src/modules/telemetry/application/ingest-telemetry'
import type { AppError } from '../src/shared/errors'

// Sin Docker: el dispositivo ya leído y un repositorio en memoria.
const owner = 'u-owner'
const device = { id: 'd1', ownerId: owner, visibility: 'private' } as Device
const get = { execute: vi.fn(async () => device) } as unknown as GetDevice

describe('IngestTelemetry', () => {
	it('un token del dueño sin telemetry:write → Forbidden, sin guardar nada', async () => {
		const repo = { append: vi.fn(async () => {}), list: vi.fn() }
		const ingest = new IngestTelemetry({ get, repo })
		const actor: Actor = {
			kind: 'token',
			userId: owner,
			tokenId: 't1',
			scopes: ['devices:read', 'devices:write'],
			deviceId: null,
		}
		const err = await ingest.execute(actor, 'd1', { values: { temp: 1 } }).catch((e: AppError) => e)
		expect(err).toMatchObject({ status: 403 })
		expect(repo.append).not.toHaveBeenCalled()
	})
})
