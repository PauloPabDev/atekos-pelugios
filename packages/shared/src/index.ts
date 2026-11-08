import { z } from 'zod'
import { decodeImage, IMAGE_ENCODINGS } from './image'
import { checkParams, withDefaults } from './render'

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

// ---------- OAuth del servidor MCP (docs/MCP.md) ----------

// Lo que puede conceder el consentimiento: nunca display:connect (token del dispositivo) ni telemetry:write.
export const OAUTH_SCOPES = ['devices:read', 'devices:write', 'displays:write'] as const satisfies readonly Scope[]

// GET /oauth/requests/:id: lo que la pantalla de consentimiento enseña antes de decidir
export const OAuthRequestInfo = z.object({
	clientName: z.string(),
	redirectHost: z.string(),
	scopes: z.array(Scope),
})
export type OAuthRequestInfo = z.infer<typeof OAuthRequestInfo>

// POST /oauth/requests/:id
export const OAuthDecisionInput = z.object({ approve: z.boolean() })
export type OAuthDecisionInput = z.infer<typeof OAuthDecisionInput>
export const OAuthDecision = z.object({ redirectTo: z.string() })
export type OAuthDecision = z.infer<typeof OAuthDecision>

// GET /oauth/grants: apps conectadas (sin tokens)
export const OAuthGrant = z.object({
	id: z.uuid(),
	clientName: z.string(),
	scopes: z.array(Scope),
	createdAt: z.string(),
	lastUsedAt: z.string().nullable(),
})
export type OAuthGrant = z.infer<typeof OAuthGrant>

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

// ---------- MetaDisplay (docs/metadisplay/DISENO.md y PLANTILLAS.md) ----------

export const DISPLAY_WIDTH = 172
export const DISPLAY_HEIGHT = 320
// Límite de trama de texto que acepta el firmware en ambos sentidos (CONTRATO §4). Lo que pase viaja en `frag`.
export const DISPLAY_MAX_FRAME = 8192
// Tope por defecto de una plantilla (y de cualquier mensaje reensamblado). La API lo cambia con DISPLAY_MAX_TEMPLATE_BYTES.
export const DISPLAY_MAX_TEMPLATE_BYTES = 1_048_576
// Botones físicos: índice lógico 0..15 (0 = BOOT); el firmware sabe a qué GPIO va cada uno.
export const DISPLAY_BUTTONS = 16

// Lienzo según `rotation`: 172×320 en vertical (0 y 180) y 320×172 en horizontal (90 y 270).
export const displaySize = (rotation = 0) =>
	rotation % 180 === 0
		? { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT }
		: { width: DISPLAY_HEIGHT, height: DISPLAY_WIDTH }

// md- + 12 hex; el prefijo queda en minúsculas y el hex en mayúsculas: md-34b7da01abcd → md-34B7DA01ABCD
export const DisplayHardwareId = z
	.string()
	.regex(/^md-[0-9a-fA-F]{12}$/)
	.transform((s) => `md-${s.slice(3).toUpperCase()}`)

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
// Hasta el lado largo (con 90/270 las x llegan a 319): que quepa en el lienzo lo comprueba DisplayTemplate.
const Coord = z
	.number()
	.int()
	.min(0)
	.max(DISPLAY_HEIGHT - 1)
const Size = z.number().int().min(1).max(DISPLAY_HEIGHT)
const Stroke = z.number().int().min(1).max(32) // grosor del trazo en px
const Angle = z.number().int().min(-360).max(360) // grados: 0 = las 3 en punto, en sentido horario
const Point = z.tuple([Coord, Coord])
const TextSize = z.number().int().min(1).max(4)
const ValueKey = z.string().min(1).max(40)
const Scalar = z.union([z.string().max(140), z.number(), z.boolean(), z.null()])

export const DisplayValues = z
	.record(ValueKey, Scalar)
	.refine((v) => Object.keys(v).length <= 64, { message: 'máximo 64 variables' })
export type DisplayValues = z.infer<typeof DisplayValues>

const Box = { x: Coord, y: Coord, w: Size, h: Size }
const Content = { value: Scalar.optional(), bind: ValueKey.optional() }
const Format = { format: z.string().max(140).optional() } // "Temp: {temp} C"
const Shape = {
	filled: z.boolean().optional(),
	fillColor: Color.optional(),
	color: Color.optional(),
	stroke: Stroke.optional(),
}
const Visible = { visible: z.boolean().optional() }

// Propiedades de cada tipo de elemento, sin la capa dinámica (binds/when): cada `when.set` se valida contra ellas.
const SHAPES = {
	text: z.object({
		type: z.literal('text'),
		x: Coord,
		y: Coord,
		size: TextSize.optional(),
		color: Color.optional(),
		...Content,
		...Format,
		...Visible,
	}),
	rect: z.object({
		type: z.literal('rect'),
		...Box,
		radius: z.number().int().min(0).max(10).optional(),
		...Shape,
		...Visible,
	}),
	line: z.object({
		type: z.literal('line'),
		x: Coord,
		y: Coord,
		x2: Coord,
		y2: Coord,
		color: Color.optional(),
		stroke: Stroke.optional(),
		...Visible,
	}),
	progress: z.object({
		type: z.literal('progress'),
		...Box,
		color: Color.optional(),
		fillColor: Color.optional(),
		...Content,
		...Visible,
	}),
	button: z.object({
		type: z.literal('button'),
		...Box,
		size: TextSize.optional(),
		fillColor: Color.optional(),
		color: Color.optional(),
		...Content,
		...Format,
		...Visible,
	}),
	circle: z.object({ type: z.literal('circle'), x: Coord, y: Coord, r: Size, ...Shape, ...Visible }),
	ellipse: z.object({ type: z.literal('ellipse'), x: Coord, y: Coord, rx: Size, ry: Size, ...Shape, ...Visible }),
	// closed: false = polilínea abierta
	polygon: z.object({
		type: z.literal('polygon'),
		points: z.array(Point).min(2).max(64),
		closed: z.boolean().optional(),
		...Shape,
		...Visible,
	}),
	arc: z.object({
		type: z.literal('arc'),
		x: Coord,
		y: Coord,
		r: Size,
		start: Angle,
		end: Angle,
		color: Color.optional(),
		stroke: Stroke.optional(),
		...Visible,
	}),
	// 3 puntos = Bézier cuadrática (inicio, control, fin); 4 = cúbica (inicio, control 1, control 2, fin)
	curve: z.object({
		type: z.literal('curve'),
		points: z.array(Point).min(3).max(4),
		color: Color.optional(),
		stroke: Stroke.optional(),
		...Visible,
	}),
	// Píxeles RGB565 en base64 (image.ts): rgb565 sin comprimir o rgb565-rle
	image: z.object({
		type: z.literal('image'),
		...Box,
		encoding: z.enum(IMAGE_ENCODINGS),
		data: z.string(),
		...Visible,
	}),
}
type ElementType = keyof typeof SHAPES

// Ni el tipo ni la estructura se cambian en vivo; en una imagen, tampoco w/h (data va ligada a ellos).
const FIXED = new Set(['type', 'bind', 'points', 'encoding', 'data'])
const BINDABLE = Object.fromEntries(
	Object.entries(SHAPES).map(([type, s]) => [
		type,
		Object.keys(s.shape).filter((k) => !FIXED.has(k) && !(type === 'image' && (k === 'w' || k === 'h'))),
	]),
) as Record<ElementType, string[]>

// Regla condicional: si la variable `key` cumple `op` frente a `value`, se aplican las propiedades de `set`.
export const DisplayRule = z
	.object({
		key: ValueKey,
		op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'truthy', 'falsy']),
		value: Scalar.optional(),
		set: z.record(z.string(), z.unknown()),
	})
	.refine((r) => r.op === 'truthy' || r.op === 'falsy' || r.value !== undefined, {
		message: 'esta op exige value',
		path: ['value'],
	})
export type DisplayRule = z.infer<typeof DisplayRule>

// Capa dinámica (render.ts): binds = propiedad ← variable; when = reglas en orden.
const Dynamic = {
	binds: z.record(z.string(), ValueKey).optional(),
	when: z.array(DisplayRule).max(16).optional(),
}

const ElementUnion = z.discriminatedUnion('type', [
	SHAPES.text.extend(Dynamic),
	SHAPES.rect.extend(Dynamic),
	SHAPES.line.extend(Dynamic),
	SHAPES.progress.extend(Dynamic),
	SHAPES.button.extend(Dynamic),
	SHAPES.circle.extend(Dynamic),
	SHAPES.ellipse.extend(Dynamic),
	SHAPES.polygon.extend(Dynamic),
	SHAPES.arc.extend(Dynamic),
	SHAPES.curve.extend(Dynamic),
	SHAPES.image.extend(Dynamic),
])

// Las variantes de un elemento que pueden dibujarse: la base y la base con cada `set` válido.
const variants = (e: z.infer<typeof ElementUnion>) => [
	e,
	...(e.when ?? [])
		.map((r) => ({ ...e, ...r.set }) as typeof e)
		.filter((v) => (SHAPES[e.type] as z.ZodType).safeParse(v).success),
]

function checkElement(e: z.infer<typeof ElementUnion>, ctx: z.RefinementCtx): void {
	const issue = (message: string, path: PropertyKey[] = []) => ctx.addIssue({ code: 'custom', message, path })
	if (
		(e.type === 'text' || e.type === 'progress' || e.type === 'button') &&
		e.value === undefined &&
		!e.bind &&
		!e.binds?.value &&
		!('format' in e && e.format)
	)
		issue(`${e.type} exige value, bind o format`)
	if (e.type === 'image' && !decodeImage(e.encoding, e.data, e.w, e.h))
		issue(`data no da exactamente ${e.w}×${e.h} píxeles ${e.encoding} en base64`, ['data'])
	const props = BINDABLE[e.type]
	for (const k of Object.keys(e.binds ?? {}))
		if (!props.includes(k)) issue(`${e.type} no admite binds.${k}`, ['binds', k])
	e.when?.forEach((r, i) => {
		const bad = Object.keys(r.set).filter((k) => !props.includes(k))
		if (bad.length) return issue(`${e.type} no admite set.${bad.join(', set.')}`, ['when', i, 'set'])
		const merged = (SHAPES[e.type] as z.ZodType).safeParse({ ...e, ...r.set })
		if (!merged.success)
			issue(`set inválido: ${merged.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`, [
				'when',
				i,
				'set',
			])
	})
}

export const DisplayElement = ElementUnion.superRefine(checkElement)
export type DisplayElement = z.infer<typeof DisplayElement>

// Caja que ocupa un elemento: [x0, y0, x1, y1) con x1/y1 exclusivos.
function extent(e: DisplayElement): [number, number, number, number] {
	switch (e.type) {
		case 'text':
			return [e.x, e.y, e.x + 1, e.y + 1]
		case 'line':
			return [Math.min(e.x, e.x2), Math.min(e.y, e.y2), Math.max(e.x, e.x2) + 1, Math.max(e.y, e.y2) + 1]
		case 'circle':
		case 'arc':
			return [e.x - e.r, e.y - e.r, e.x + e.r + 1, e.y + e.r + 1]
		case 'ellipse':
			return [e.x - e.rx, e.y - e.ry, e.x + e.rx + 1, e.y + e.ry + 1]
		case 'polygon':
		case 'curve': {
			const xs = e.points.map((p) => p[0])
			const ys = e.points.map((p) => p[1])
			return [Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1]
		}
		default:
			return [e.x, e.y, e.x + e.w, e.y + e.h]
	}
}

const LocalAction = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('feedback'), message: z.string().max(24) }),
	z.object({ kind: z.literal('set_value'), key: ValueKey, value: Scalar }),
])
const ActionBase = {
	id: z.string().min(1).max(48),
	mode: z.enum(['local', 'remote', 'hybrid']),
	event: z.string().max(64).optional(),
	local: LocalAction.optional(),
	// La información concreta de la acción; con event "data.set" el servidor la fusiona en los valores.
	payload: DisplayValues.optional(),
}

// tap = zona táctil; button = botón físico (0..15) con pulsación corta o larga. La caja de un botón es opcional:
// es la zona que la pantalla resalta para ese botón.
export const DisplayTouchAction = z
	.discriminatedUnion('trigger', [
		z.object({ trigger: z.literal('tap'), ...ActionBase, ...Box }),
		z.object({
			trigger: z.literal('button'),
			...ActionBase,
			button: z
				.number()
				.int()
				.min(0)
				.max(DISPLAY_BUTTONS - 1),
			press: z.enum(['short', 'long']).optional(), // por defecto short
			x: Coord.optional(),
			y: Coord.optional(),
			w: Size.optional(),
			h: Size.optional(),
		}),
	])
	.refine((a) => new Set([a.x, a.y, a.w, a.h].map((v) => v === undefined)).size === 1, {
		message: 'la zona lleva x, y, w y h juntos',
	})
export type DisplayTouchAction = z.infer<typeof DisplayTouchAction>

// Firma de la plantilla: qué variables espera, de qué tipo y con qué valor por defecto.
export const DisplayParam = z
	.object({
		type: z.enum(['number', 'string', 'boolean']),
		default: Scalar.optional(),
		description: z.string().max(140).optional(),
		min: z.number().optional(),
		max: z.number().optional(),
	})
	.refine((p) => p.min === undefined || p.max === undefined || p.min <= p.max, { message: 'min > max' })
export type DisplayParam = z.infer<typeof DisplayParam>

// Fotograma: se dibuja encima de los `elements` de la plantilla durante `ms`.
const DisplayFrame = z.object({ ms: z.number().int().min(20).max(60_000), elements: z.array(DisplayElement) })

export const DisplayTemplate = z
	.object({
		id: z.string().min(1).max(64),
		version: z.number().int().min(0).max(2_147_483_647), // integer en PG: más allá, el INSERT daría un 500
		rotation: z.literal([0, 90, 180, 270]).optional(),
		background: Color.optional(),
		params: z
			.record(ValueKey, DisplayParam)
			.refine((p) => Object.keys(p).length <= 64, { message: 'máximo 64 parámetros' })
			.optional(),
		elements: z.array(DisplayElement),
		// repeat 0 (o ausente) = siempre; al acabar las vueltas se queda en el último fotograma
		animation: z
			.object({ frames: z.array(DisplayFrame).min(1), repeat: z.number().int().min(0).optional() })
			.optional(),
		actions: z.array(DisplayTouchAction),
	})
	.superRefine((t, ctx) => {
		const { width, height } = displaySize(t.rotation)
		const issue = (message: string, path: PropertyKey[]) => ctx.addIssue({ code: 'custom', message, path })
		const fits = ([x0, y0, x1, y1]: number[]) => x0! >= 0 && y0! >= 0 && x1! <= width && y1! <= height
		const out = `se sale de ${width}×${height}`
		const check = (elements: DisplayElement[], path: PropertyKey[]) =>
			elements.forEach((e, i) => {
				if (!variants(e).every((v) => fits(extent(v)))) issue(`el elemento ${out}`, [...path, i])
			})
		check(t.elements, ['elements'])
		t.animation?.frames.forEach((f, i) => check(f.elements, ['animation', 'frames', i, 'elements']))
		t.actions.forEach((a, i) => {
			if (a.x !== undefined && !fits([a.x, a.y!, a.x + a.w!, a.y! + a.h!]))
				issue(`la zona de la acción ${out}`, ['actions', i])
		})
		if (new Set(t.actions.map((a) => a.id)).size !== t.actions.length) issue('ids de acción repetidos', ['actions'])
		const presses = t.actions.flatMap((a) => (a.trigger === 'button' ? [`${a.button}:${a.press ?? 'short'}`] : []))
		if (new Set(presses).size !== presses.length) issue('dos acciones para el mismo botón y pulsación', ['actions'])
		for (const p of checkParams(t.params, withDefaults(t, {})))
			issue(`default inválido: ${p.message}`, ['params', ...p.path])
	})
export type DisplayTemplate = z.infer<typeof DisplayTemplate>

// REST
export const CreateDisplayInput = z.object({ deviceId: DisplayHardwareId, name: z.string().min(1).max(80) })
export type CreateDisplayInput = z.input<typeof CreateDisplayInput>

export const PatchDisplayInput = z
	.object({ name: z.string().min(1).max(80), activeTemplateId: z.string().min(1).max(64) })
	.partial()
export type PatchDisplayInput = z.infer<typeof PatchDisplayInput>

export const Display = z.object({
	id: z.uuid(), // el que piden CreateTokenInput.displayId y ApiToken.displayId
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

const Source = z.enum(['touch', 'button'])
const Press = z.enum(['short', 'long'])

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
	// null: toque de un firmware que no dice el origen (o evento anterior a la 1.1)
	source: Source.nullable(),
	button: z.number().int().nullable(),
	press: Press.nullable(),
})
export type DisplayEvent = z.infer<typeof DisplayEvent>

// Solo display.* por ahora: trust.* y ota.install quedan fuera hasta homologar el hardware (DISENO §1)
export const DISPLAY_COMMANDS = ['display.refresh', 'display.brightness'] as const
const COMMANDS = [
	z.object({ type: z.literal('display.refresh') }),
	z.object({ type: z.literal('display.brightness'), percent: z.number().int().min(0).max(50) }),
] as const
export const DisplayCommand = z.discriminatedUnion('type', COMMANDS)
export type DisplayCommand = z.infer<typeof DisplayCommand>

// WSS /ws/device: dispositivo → servidor
const AckBase = { ok: z.boolean(), reason: z.string().max(100).optional() }
export const DisplayClientMessage = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('device.hello'),
		protocol: z.literal(1),
		deviceId: z.string().max(64),
		firmware: z.string().max(64).optional(),
		display: z
			.object({
				width: z.number(),
				height: z.number(),
				touch: z.boolean().optional(),
				buttons: z.number().int().min(0).max(DISPLAY_BUTTONS).optional(), // cuántos botones físicos tiene
			})
			.loose(),
		template: z.object({ id: z.string().max(64), version: z.number().int() }).optional(),
		capabilities: z.array(z.string().max(32)).max(64).optional(),
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
		source: Source.optional(),
		button: z
			.number()
			.int()
			.min(0)
			.max(DISPLAY_BUTTONS - 1)
			.optional(),
		press: Press.optional(),
	}),
	z.object({ type: z.literal('frag.ack'), id: z.string().max(64), ...AckBase }),
	z.object({ type: z.literal('trust.ack'), operation: z.string().max(16).optional(), ...AckBase }),
	z.object({ type: z.literal('ota.ack'), ...AckBase }),
])
export type DisplayClientMessage = z.infer<typeof DisplayClientMessage>

// WSS /ws/device: servidor → dispositivo. Esquema (no solo tipo) porque de aquí sale el contrato publicado.
export const DisplayServerMessage = z.discriminatedUnion('type', [
	z.object({ type: z.literal('template.set'), template: DisplayTemplate }),
	z.object({
		type: z.literal('data.update'),
		templateVersion: z.number().int(),
		strategy: z.enum(['snapshot', 'patch']),
		values: DisplayValues,
	}),
	z.object({
		type: z.literal('ui.result'),
		eventId: z.string(),
		status: z.enum(['ok', 'rejected', 'error']),
		toast: z.string().optional(),
		patch: DisplayValues.optional(),
	}),
	z.object({ type: z.literal('event.ack'), eventId: z.string() }),
	// Trozo seq (de 0 a count-1) de un mensaje de más de DISPLAY_MAX_FRAME bytes: data = sus bytes UTF-8 en base64.
	z.object({
		type: z.literal('frag'),
		id: z.string().max(64),
		seq: z.number().int().min(0),
		count: z.number().int().min(2),
		bytes: z.number().int().min(1),
		data: z.string(),
	}),
	...COMMANDS,
])
export type DisplayServerMessage = z.infer<typeof DisplayServerMessage>

export * from './image'
export * from './render'
