import type { Scope } from '@atekos/shared'
import { expect, it } from 'vitest'
import { canRead, canWrite, type Actor } from '../src/modules/devices/domain/policy'

const owner = 'u-owner'
const pub = { id: 'd1', ownerId: owner, visibility: 'public' } as const
const priv = { id: 'd1', ownerId: owner, visibility: 'private' } as const
const token = (scopes: Scope[], deviceId: string | null = null, userId = owner): Actor => ({
	kind: 'token',
	userId,
	tokenId: 't1',
	scopes,
	deviceId,
})
const rw: Scope[] = ['devices:read', 'devices:write']

// [actor, leer público, leer privado, escribir público, escribir privado]
it.each<[string, Actor, boolean, boolean, boolean, boolean]>([
	['anónimo', { kind: 'anonymous' }, true, false, false, false],
	['dueño con sesión', { kind: 'user', userId: owner }, true, true, true, true],
	['otro usuario con sesión', { kind: 'user', userId: 'u-otro' }, true, false, false, false],
	['token del dueño con read y write', token(rw), true, true, true, true],
	['token del dueño solo con read', token(['devices:read']), true, true, false, false],
	['token del dueño sin scopes de devices', token(['telemetry:write']), true, false, false, false],
	['token ligado a este dispositivo', token(rw, 'd1'), true, true, true, true],
	['token ligado a otro dispositivo', token(rw, 'd2'), true, false, false, false],
	['token de otro usuario', token(rw, null, 'u-otro'), true, false, false, false],
])('%s', (_name, actor, readPub, readPriv, writePub, writePriv) => {
	expect(canRead(actor, pub)).toBe(readPub)
	expect(canRead(actor, priv)).toBe(readPriv)
	expect(canWrite(actor, pub, 'devices:write')).toBe(writePub)
	expect(canWrite(actor, priv, 'devices:write')).toBe(writePriv)
})
