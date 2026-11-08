import { z } from 'zod'

// ---------- Scopes ----------

// display:connect = token del dispositivo MetaDisplay (/ws/device); displays:write = administración de pantallas
export const SCOPES = ['devices:read', 'devices:write', 'telemetry:write', 'display:connect', 'displays:write'] as const
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
const DISPLAY_SCOPES: readonly Scope[] = ['display:connect', 'displays:write']

export const CreateTokenInput = z
	.object({
		name: z.string().min(1).max(80),
		scopes: z.array(Scope).min(1),
		deviceId: z.uuid().optional(),
		displayId: z.uuid().optional(),
		expiresInDays: z.number().int().min(1).max(3650).optional(),
	})
	// Un token de dispositivo MetaDisplay nunca debe servir como token de administración (CONTRATO §7).
	.superRefine((t, ctx) => {
		const issue = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['scopes'] })
		if (t.scopes.includes('display:connect') && !t.displayId) issue('display:connect exige displayId')
		if (t.scopes.includes('display:connect') && t.scopes.includes('displays:write'))
			issue('display:connect y displays:write no pueden ir en el mismo token')
		if (t.displayId && t.deviceId) issue('un token no puede ligarse a un dispositivo y a una pantalla a la vez')
		if (t.deviceId && t.scopes.some((s) => DISPLAY_SCOPES.includes(s)))
			issue('un token ligado a un dispositivo no admite scopes de pantallas')
		if (t.displayId && t.scopes.some((s) => !DISPLAY_SCOPES.includes(s)))
			issue('un token ligado a una pantalla solo admite display:connect o displays:write')
	})
export type CreateTokenInput = z.infer<typeof CreateTokenInput>

// GET /tokens: nunca incluye el valor del token
export const ApiToken = z.object({
	id: z.uuid(),
	name: z.string(),
	prefix: z.string(),
	scopes: z.array(Scope),
	deviceId: z.uuid().nullable(),
	displayId: z.uuid().nullable(),
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

// ---------- MetaDisplay (docs/metadisplay/DISENO.md) ----------

export const DISPLAY_WIDTH = 172
export const DISPLAY_HEIGHT = 320
// Límite de trama de texto que acepta el firmware en ambos sentidos (CONTRATO §4)
export const DISPLAY_MAX_FRAME = 8192

// md- + 12 hex; el prefijo queda en minúsculas y el hex en mayúsculas: md-34b7da01abcd → md-34B7DA01ABCD
export const DisplayHardwareId = z
	.string()
	.regex(/^md-[0-9a-fA-F]{12}$/)
	.transform((s) => `md-${s.slice(3).toUpperCase()}`)

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const X = z
	.number()
	.int()
	.min(0)
	.max(DISPLAY_WIDTH - 1)
const Y = z
	.number()
	.int()
	.min(0)
	.max(DISPLAY_HEIGHT - 1)
const W = z.number().int().min(1).max(DISPLAY_WIDTH)
const H = z.number().int().min(1).max(DISPLAY_HEIGHT)
const ValueKey = z.string().min(1).max(40)
const Scalar = z.union([z.string().max(140), z.number(), z.boolean(), z.null()])

const Box = { x: X, y: Y, w: W, h: H }
const Content = { value: Scalar.optional(), bind: ValueKey.optional() }

export const DisplayElement = z
	.discriminatedUnion('type', [
		z.object({
			type: z.literal('text'),
			x: X,
			y: Y,
			size: z.number().int().min(1).max(4).optional(),
			color: Color.optional(),
			...Content,
		}),
		z.object({
			type: z.literal('rect'),
			...Box,
			filled: z.boolean().optional(),
			radius: z.number().int().min(0).max(10).optional(),
			fillColor: Color.optional(),
			color: Color.optional(),
		}),
		z.object({ type: z.literal('line'), x: X, y: Y, x2: X, y2: Y, color: Color.optional() }),
		z.object({ type: z.literal('progress'), ...Box, color: Color.optional(), fillColor: Color.optional(), ...Content }),
		z.object({
			type: z.literal('button'),
			...Box,
			size: z.number().int().min(1).max(4).optional(),
			fillColor: Color.optional(),
			color: Color.optional(),
			...Content,
		}),
	])
	.superRefine((e, ctx) => {
		if ('w' in e && (e.x + e.w > DISPLAY_WIDTH || e.y + e.h > DISPLAY_HEIGHT))
			ctx.addIssue({ code: 'custom', message: `el elemento se sale de ${DISPLAY_WIDTH}×${DISPLAY_HEIGHT}` })
		if ((e.type === 'text' || e.type === 'progress' || e.type === 'button') && e.value === undefined && !e.bind)
			ctx.addIssue({ code: 'custom', message: `${e.type} exige value o bind` })
	})
export type DisplayElement = z.infer<typeof DisplayElement>

export const DisplayTouchAction = z
	.object({
		id: z.string().min(1).max(48),
		trigger: z.literal('tap'),
		mode: z.enum(['local', 'remote', 'hybrid']),
		event: z.string().max(64).optional(),
		...Box,
		local: z
			.discriminatedUnion('kind', [
				z.object({ kind: z.literal('feedback'), message: z.string().max(24) }),
				z.object({ kind: z.literal('set_value'), key: ValueKey, value: Scalar }),
			])
			.optional(),
	})
	.refine((a) => a.x + a.w <= DISPLAY_WIDTH && a.y + a.h <= DISPLAY_HEIGHT, {
		message: `la zona táctil se sale de ${DISPLAY_WIDTH}×${DISPLAY_HEIGHT}`,
	})
export type DisplayTouchAction = z.infer<typeof DisplayTouchAction>

export const DisplayTemplate = z
	.object({
		id: z.string().min(1).max(64),
		version: z.number().int().min(0),
		background: Color.optional(),
		elements: z.array(DisplayElement).max(45),
		actions: z.array(DisplayTouchAction).max(24),
	})
	.refine((t) => new Set(t.actions.map((a) => a.id)).size === t.actions.length, {
		message: 'ids de acción repetidos',
		path: ['actions'],
	})
export type DisplayTemplate = z.infer<typeof DisplayTemplate>

export const DisplayValues = z
	.record(ValueKey, Scalar)
	.refine((v) => Object.keys(v).length <= 64, { message: 'máximo 64 variables' })
export type DisplayValues = z.infer<typeof DisplayValues>

// REST
export const CreateDisplayInput = z.object({ deviceId: DisplayHardwareId, name: z.string().min(1).max(80) })
export type CreateDisplayInput = z.input<typeof CreateDisplayInput>

export const PatchDisplayInput = z
	.object({ name: z.string().min(1).max(80), activeTemplateId: z.string().min(1).max(64) })
	.partial()
export type PatchDisplayInput = z.infer<typeof PatchDisplayInput>

export const Display = z.object({
	deviceId: z.string(),
	name: z.string(),
	activeTemplateId: z.string(),
	online: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
})
export type Display = z.infer<typeof Display>

export const DisplayDetail = Display.extend({
	template: DisplayTemplate,
	templates: z.array(z.object({ id: z.string(), version: z.number().int() })),
	values: DisplayValues,
})
export type DisplayDetail = z.infer<typeof DisplayDetail>

export const DisplayEvent = z.object({
	ts: z.string(),
	eventId: z.string(),
	actionId: z.string(),
	name: z.string().nullable(),
	x: z.number().int(),
	y: z.number().int(),
	templateId: z.string(),
	templateVersion: z.number().int(),
	status: z.enum(['ok', 'rejected', 'error']),
	toast: z.string().nullable(),
})
export type DisplayEvent = z.infer<typeof DisplayEvent>

// Solo display.* por ahora: trust.* y ota.install quedan fuera hasta homologar el hardware (DISENO §1)
export const DISPLAY_COMMANDS = ['display.refresh', 'display.brightness'] as const
export const DisplayCommand = z.discriminatedUnion('type', [
	z.object({ type: z.literal('display.refresh') }),
	z.object({ type: z.literal('display.brightness'), percent: z.number().int().min(0).max(50) }),
])
export type DisplayCommand = z.infer<typeof DisplayCommand>

// WSS /ws/device: dispositivo → servidor
const AckBase = { ok: z.boolean(), reason: z.string().max(100).optional() }
export const DisplayClientMessage = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('device.hello'),
		protocol: z.literal(1),
		deviceId: z.string().max(64),
		firmware: z.string().max(64).optional(),
		display: z.object({ width: z.number(), height: z.number(), touch: z.boolean().optional() }).loose(),
		template: z.object({ id: z.string().max(64), version: z.number().int() }).optional(),
		capabilities: z.array(z.string().max(32)).max(32).optional(),
	}),
	z.object({
		type: z.literal('template.ack'),
		...AckBase,
		templateId: z.string().optional(),
		version: z.number().optional(),
	}),
	z.object({ type: z.literal('data.ack'), ...AckBase }),
	z.object({
		type: z.literal('touch.tap'),
		eventId: z.string().min(1).max(100),
		deviceId: z.string().max(64),
		actionId: z.string().max(48),
		name: z.string().max(64).optional(),
		x: z.number().int(),
		y: z.number().int(),
		templateId: z.string().max(64).optional(),
		templateVersion: z.number().int(),
		uptimeMs: z.number().optional(),
	}),
	z.object({ type: z.literal('trust.ack'), operation: z.string().max(16).optional(), ...AckBase }),
	z.object({ type: z.literal('ota.ack'), ...AckBase }),
])
export type DisplayClientMessage = z.infer<typeof DisplayClientMessage>

// WSS /ws/device: servidor → dispositivo
export type DisplayServerMessage =
	| { type: 'template.set'; template: DisplayTemplate }
	| { type: 'data.update'; templateVersion: number; strategy: 'snapshot' | 'patch'; values: DisplayValues }
	| { type: 'ui.result'; eventId: string; status: 'ok' | 'rejected' | 'error'; toast?: string; patch?: DisplayValues }
	| { type: 'event.ack'; eventId: string }
	| DisplayCommand
