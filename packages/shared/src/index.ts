import { z } from 'zod'

// ---------- Scopes ----------

export const SCOPES = ['devices:read', 'devices:write', 'telemetry:write'] as const
export const Scope = z.enum(SCOPES)
export type Scope = z.infer<typeof Scope>

// ---------- Dispositivos ----------

export const DEVICE_TYPES = ['light', 'switch', 'sensor', 'generic'] as const
export const DeviceType = z.enum(DEVICE_TYPES)
export type DeviceType = z.infer<typeof DeviceType>

export const Visibility = z.enum(['public', 'private'])
export type Visibility = z.infer<typeof Visibility>

export const DeviceStatus = z.enum(['active', 'inactive'])
export type DeviceStatus = z.infer<typeof DeviceStatus>

export const Slug = z.string().regex(/^[a-z0-9-]{1,40}$/)

export const Device = z.object({
	id: z.uuid(),
	ownerId: z.uuid(),
	slug: Slug,
	name: z.string().min(1).max(80),
	description: z.string().max(500),
	type: DeviceType,
	state: z.boolean(),
	data: z.record(z.string(), z.unknown()),
	visibility: Visibility,
	status: DeviceStatus,
	createdAt: z.string(),
	updatedAt: z.string(),
})
export type Device = z.infer<typeof Device>

// POST /devices
export const CreateDeviceInput = z.object({
	slug: Slug,
	name: z.string().min(1).max(80),
	type: DeviceType.default('generic'),
	visibility: Visibility.default('private'),
	description: z.string().max(500).optional(),
	data: z.record(z.string(), z.unknown()).optional(),
})
export type CreateDeviceInput = z.input<typeof CreateDeviceInput>

// PATCH /devices/:id
export const PatchDeviceInput = z
	.object({
		name: z.string().min(1).max(80),
		description: z.string().max(500),
		type: DeviceType,
		visibility: Visibility,
		status: DeviceStatus,
	})
	.partial()
export type PatchDeviceInput = z.infer<typeof PatchDeviceInput>

// PUT /devices/:id/state
export const SetStateInput = z.object({ state: z.boolean() })
export type SetStateInput = z.infer<typeof SetStateInput>

// PATCH /devices/:id/data: merge superficial sobre `data`
export const PatchDataInput = z.record(z.string(), z.unknown())
export type PatchDataInput = z.infer<typeof PatchDataInput>

// GET /devices/:id/events
export const DEVICE_EVENT_TYPES = [
	'device.created',
	'device.updated',
	'state.changed',
	'data.changed',
	'device.deleted',
] as const
export const DeviceEventType = z.enum(DEVICE_EVENT_TYPES)
export type DeviceEventType = z.infer<typeof DeviceEventType>

export const DeviceEvent = z.object({
	ts: z.string(),
	deviceId: z.uuid(),
	ownerId: z.uuid(),
	type: DeviceEventType,
	before: Device.nullable(),
	after: Device.nullable(),
	actor: z.object({ kind: z.enum(['anonymous', 'user', 'token']), id: z.string().nullable() }),
	source: z.enum(['http', 'ws']),
})
export type DeviceEvent = z.infer<typeof DeviceEvent>

// ---------- Telemetría ----------

// POST /devices/:id/telemetry
export const TelemetryInput = z.object({
	values: z.record(z.string(), z.number()),
	ts: z.iso.datetime().optional(),
})
export type TelemetryInput = z.infer<typeof TelemetryInput>

export const TelemetryReading = z.object({
	ts: z.string(),
	deviceId: z.uuid(),
	values: z.record(z.string(), z.number()),
})
export type TelemetryReading = z.infer<typeof TelemetryReading>

// ---------- Auth ----------

export const Email = z.email().max(254).toLowerCase()
export const Password = z.string().min(10).max(200)

// POST /auth/register
export const RegisterInput = z.object({
	email: Email,
	username: z
		.string()
		.min(1)
		.max(40)
		.regex(/^[a-zA-Z0-9_-]+$/),
	password: Password,
})
export type RegisterInput = z.infer<typeof RegisterInput>

// POST /auth/login
export const LoginInput = z.object({ email: Email, password: z.string().min(1).max(200) })
export type LoginInput = z.infer<typeof LoginInput>

// GET /auth/me
export const User = z.object({ id: z.uuid(), email: z.string(), username: z.string() })
export type User = z.infer<typeof User>

// ---------- Tokens de API ----------

// POST /tokens
export const CreateTokenInput = z.object({
	name: z.string().min(1).max(80),
	scopes: z.array(Scope).min(1),
	deviceId: z.uuid().optional(),
	expiresInDays: z.number().int().min(1).max(3650).optional(),
})
export type CreateTokenInput = z.infer<typeof CreateTokenInput>

// GET /tokens: nunca incluye el valor del token
export const ApiToken = z.object({
	id: z.uuid(),
	name: z.string(),
	prefix: z.string(),
	scopes: z.array(Scope),
	deviceId: z.uuid().nullable(),
	expiresAt: z.string().nullable(),
	lastUsedAt: z.string().nullable(),
	revokedAt: z.string().nullable(),
	createdAt: z.string(),
})
export type ApiToken = z.infer<typeof ApiToken>

// Respuesta 201 de POST /tokens: el token en claro se devuelve solo esta vez
export const CreatedApiToken = ApiToken.extend({ token: z.string() })
export type CreatedApiToken = z.infer<typeof CreatedApiToken>

// ---------- Errores HTTP ----------

export const ApiError = z.object({ error: z.string(), message: z.string().optional(), issues: z.unknown().optional() })
export type ApiError = z.infer<typeof ApiError>

// ---------- WebSocket ----------

export const WsClientMessage = z.discriminatedUnion('type', [
	z.object({ type: z.literal('subscribe'), deviceId: z.uuid() }),
	z.object({ type: z.literal('unsubscribe'), deviceId: z.uuid() }),
	z.object({ type: z.literal('toggle'), deviceId: z.uuid() }),
	z.object({ type: z.literal('set'), deviceId: z.uuid(), state: z.boolean() }),
	z.object({ type: z.literal('ping') }),
])
export type WsClientMessage = z.infer<typeof WsClientMessage>

export const WsServerMessage = z.discriminatedUnion('type', [
	z.object({ type: z.literal('device.updated'), device: Device }),
	z.object({ type: z.literal('subscribed'), deviceId: z.uuid() }),
	z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
	z.object({ type: z.literal('pong') }),
])
export type WsServerMessage = z.infer<typeof WsServerMessage>
