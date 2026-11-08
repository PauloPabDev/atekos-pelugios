import type { Scope } from '@atekos/shared'
import { expect, it } from 'vitest'
import type { Actor } from '../src/modules/devices/domain/policy'
import { canAdminDisplay } from '../src/modules/displays/domain/policy'

const owner = 'u-owner'
const display = { id: 'p1', ownerId: owner }
// displayId undefined = token emitido antes de que existiera la columna (campo ausente)
const token = (scopes: Scope[], displayId?: string | null, userId = owner): Actor => ({
	kind: 'token',
	userId,
	tokenId: 't1',
	scopes,
	deviceId: null,
	...(displayId !== undefined && { displayId }),
})

it.each<[string, Actor, boolean]>([
	['anónimo', { kind: 'anonymous' }, false],
	['dueño con sesión', { kind: 'user', userId: owner }, true],
	['otro usuario con sesión', { kind: 'user', userId: 'u-otro' }, false],
	['token del dueño con displays:write sin displayId', token(['displays:write']), true],
	['token del dueño con displays:write y displayId null', token(['displays:write'], null), true],
	['token con displays:write ligado a esta pantalla', token(['displays:write'], 'p1'), true],
	['token con displays:write ligado a otra pantalla', token(['displays:write'], 'p2'), false],
	['token del dispositivo (display:connect) de esta pantalla', token(['display:connect'], 'p1'), false],
	['display:connect y displays:write a la vez', token(['display:connect', 'displays:write'], 'p1'), false],
	['token del dueño solo con scopes de devices', token(['devices:read', 'devices:write']), false],
	['token de otro usuario con displays:write', token(['displays:write'], null, 'u-otro'), false],
])('%s', (_name, actor, expected) => {
	expect(canAdminDisplay(actor, display)).toBe(expected)
})
