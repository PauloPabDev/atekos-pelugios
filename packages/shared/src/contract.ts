import { z } from 'zod'
import {
	ApiError,
	CreateDisplayInput,
	Display,
	DISPLAY_HEIGHT,
	DISPLAY_MAX_FRAME,
	DISPLAY_MAX_TEMPLATE_BYTES,
	DISPLAY_WIDTH,
	DisplayClientMessage,
	DisplayCommand,
	DisplayDetail,
	DisplayEvent,
	DisplayHardwareId,
	DisplayServerMessage,
	DisplayTemplate,
	DisplayValues,
	PatchDisplayInput,
} from './index'

// Contrato MetaDisplay de atekos, generado desde los esquemas de este paquete (fuente de verdad).
// Implementa el protocolo oficial (docs/metadisplay/CONTRATO.md, asyncapi.yaml, openapi.yaml) con las
// diferencias de docs/metadisplay/DISENO.md. Cualquier cambio en el contenido exige subir version y updatedAt:
// `pnpm contract` se niega a regenerar docs/metadisplay/generado/ si no.
export const METADISPLAY_CONTRACT = { version: '1.1.0', updatedAt: '2026-11-08', protocol: 1 } as const

type Json = Record<string, unknown>
type Target = 'draft-7' | 'draft-2020-12'

const schema = (s: z.ZodType, target: Target): Json => {
	const j: Json = z.toJSONSchema(s, {
		io: 'input',
		target,
		unrepresentable: 'any',
		// .int() emite ±MAX_SAFE_INTEGER como límites: no dicen nada y ensucian el contrato.
		override: ({ jsonSchema: n }) => {
			if (n.minimum === Number.MIN_SAFE_INTEGER) delete n.minimum
			if (n.maximum === Number.MAX_SAFE_INTEGER) delete n.maximum
		},
	})
	delete j.$schema // va dentro de otro documento (AsyncAPI u OpenAPI), no suelto
	return j
}

const SUMMARY: Record<string, string> = {
	'device.hello':
		'Primer mensaje tras conectar: identidad, firmware, pantalla y la plantilla en caché (id y version). El deviceId debe ser el de la pantalla a la que está ligado el token.',
	'template.ack': 'Confirma o rechaza (ok:false, reason) la plantilla recibida.',
	'data.ack': 'Confirma un data.update. Con otra templateVersion: ok:false, reason "version_mismatch".',
	'touch.tap':
		'Toque o pulsación de botón físico (source, button, press) sobre una acción remote o hybrid. El eventId es idempotente: el servidor deduplica y responde ui.result o event.ack.',
	'frag.ack':
		'Mensaje troceado reensamblado (ok:true) o descartado (ok:false, reason: too_large, incomplete…). El mensaje reensamblado se confirma además con su propio ack.',
	'trust.ack': 'Reservado: el servidor aún no envía trust.* (pendiente de homologar el hardware).',
	'ota.ack': 'Reservado: el servidor aún no envía ota.install (pendiente de homologar el hardware).',
	'template.set': 'Plantilla completa. Solo se envía si la del hello no coincide en id y version.',
	'data.update': 'snapshot sustituye todos los valores; patch actualiza solo las claves enviadas.',
	'ui.result': 'Resultado de un touch.tap: estado, toast opcional y patch de valores.',
	'event.ack': 'Confirma un touch.tap cuyo resultado llegará más tarde.',
	frag: 'Trozo de un mensaje de más de 8192 bytes. Los trozos de un mensaje llegan seguidos (seq 0..count-1); concatenando sus data decodificados (bytes en total) sale el JSON del mensaje original, que se procesa como si hubiera llegado entero.',
	'display.refresh': 'Fuerza un redibujado completo.',
	'display.brightness': 'Brillo en porcentaje, de 0 a 50.',
}

const typeOf = (o: z.ZodObject) => (o.shape.type as z.ZodLiteral<string>).value

// AsyncAPI 3.0 del WSS /ws/device, desde el punto de vista del servidor atekos.
export function metaDisplayAsyncApi(origin: string, maxBytes: number = DISPLAY_MAX_TEMPLATE_BYTES): Json {
	const [scheme, host] = origin.split('://') // shared no tiene URL (sin lib DOM ni tipos de Node)
	const msgs = (union: { options: readonly z.ZodObject[] }, from: 'device' | 'server') =>
		union.options.map((o) => {
			const type = typeOf(o)
			const payload = schema(o, 'draft-7')
			return [type, { name: type, title: type, summary: SUMMARY[type], 'x-from': from, payload }] as const
		})
	const client = msgs(DisplayClientMessage, 'device')
	const server = msgs(DisplayServerMessage, 'server')
	const refs = (list: typeof client) => list.map(([t]) => ({ $ref: `#/channels/device/messages/${t}` }))
	return {
		asyncapi: '3.0.0',
		info: {
			title: 'MetaDisplay en atekos-pelugios',
			version: METADISPLAY_CONTRACT.version,
			description: `Protocolo MetaDisplay ${METADISPLAY_CONTRACT.protocol} sobre WSS: JSON UTF-8 en tramas de texto de hasta ${DISPLAY_MAX_FRAME} bytes; un mensaje mayor (hasta ${maxBytes} bytes) llega troceado en frag. Lienzo de ${DISPLAY_WIDTH}×${DISPLAY_HEIGHT} en vertical o ${DISPLAY_HEIGHT}×${DISPLAY_WIDTH} con template.rotation 90/270. El token va solo en la cabecera Authorization del upgrade (nunca en la query). Guía de plantillas: docs/metadisplay/PLANTILLAS.md.`,
			'x-updated': METADISPLAY_CONTRACT.updatedAt,
			'x-protocol': METADISPLAY_CONTRACT.protocol,
			'x-max-frame-bytes': DISPLAY_MAX_FRAME,
			'x-max-message-bytes': maxBytes,
		},
		defaultContentType: 'application/json',
		servers: {
			atekos: {
				host,
				protocol: scheme === 'https' ? 'wss' : 'ws',
				pathname: '/ws/device',
				security: [{ $ref: '#/components/securitySchemes/deviceToken' }],
			},
		},
		channels: {
			device: {
				address: '/ws/device',
				messages: Object.fromEntries([...client, ...server].map(([t]) => [t, { $ref: `#/components/messages/${t}` }])),
			},
		},
		operations: {
			recibirDelDispositivo: { action: 'receive', channel: { $ref: '#/channels/device' }, messages: refs(client) },
			enviarAlDispositivo: { action: 'send', channel: { $ref: '#/channels/device' }, messages: refs(server) },
		},
		components: {
			securitySchemes: {
				deviceToken: {
					type: 'http',
					scheme: 'bearer',
					description:
						'Token dmt_ con el scope display:connect, ligado a la pantalla. Lo crea su dueño en la web (Tokens).',
				},
			},
			messages: Object.fromEntries([...client, ...server]),
		},
	}
}

// OpenAPI 3.1 de la REST de pantallas (/api/v1/displays) y del propio contrato.
export function metaDisplayOpenApi(origin: string, maxBytes: number = DISPLAY_MAX_TEMPLATE_BYTES): Json {
	const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
	const body = (s: Json) => ({ required: true, content: { 'application/json': { schema: s } } })
	const res = (description: string, s?: Json) =>
		s ? { description, content: { 'application/json': { schema: s } } } : { description }
	const err = (description: string) => res(description, ref('ApiError'))
	const admin = [{ session: [] }, { token: [] }]
	const session = [{ session: [] }]
	const deviceId = { name: 'deviceId', in: 'path', required: true, schema: schema(DisplayHardwareId, 'draft-2020-12') }
	const templateId = { name: 'templateId', in: 'path', required: true, schema: { type: 'string', maxLength: 64 } }
	const common = {
		'401': err('Sin sesión ni token válido'),
		'404': err('Pantalla ajena, inexistente o deviceId mal formado'),
	}
	const values = { type: 'object', properties: { values: ref('DisplayValues') }, required: ['values'] }
	const tooLarge = err(`El cuerpo o el mensaje resultante pasa de ${maxBytes} bytes (message_too_large)`)

	return {
		openapi: '3.1.0',
		info: {
			title: 'MetaDisplay en atekos-pelugios: API REST',
			version: METADISPLAY_CONTRACT.version,
			description:
				'Administración de pantallas, plantillas y datos. El dispositivo no la usa: habla solo por WSS /ws/device (ver asyncapi.json). Errores: { error, message?, issues? }.',
			'x-updated': METADISPLAY_CONTRACT.updatedAt,
			'x-max-message-bytes': maxBytes,
		},
		servers: [{ url: `${origin}/api/v1` }],
		security: admin,
		paths: {
			'/contract/asyncapi.json': {
				get: {
					summary: 'Contrato WSS del dispositivo (este documento en AsyncAPI)',
					security: [],
					responses: { '200': res('AsyncAPI 3.0') },
				},
			},
			'/contract/openapi.json': {
				get: { summary: 'Este documento', security: [], responses: { '200': res('OpenAPI 3.1') } },
			},
			'/displays': {
				get: {
					summary: 'Mis pantallas',
					responses: { '200': res('Pantallas', { type: 'array', items: ref('Display') }), ...common },
				},
				post: {
					summary: 'Dar de alta una pantalla por su id de hardware',
					security: session,
					requestBody: body(ref('CreateDisplayInput')),
					responses: {
						'201': res('Creada con la plantilla «inicio»', ref('Display')),
						'400': err('Cuerpo inválido'),
						'401': common['401'],
						'409': err('Ya existe una pantalla con ese deviceId'),
					},
				},
			},
			'/displays/{deviceId}': {
				parameters: [deviceId],
				get: {
					summary: 'Pantalla con su plantilla activa, plantillas y valores',
					responses: { '200': res('Detalle', ref('DisplayDetail')), ...common },
				},
				patch: {
					summary: 'Renombrar o cambiar la plantilla activa',
					requestBody: body(ref('PatchDisplayInput')),
					responses: {
						'200': res('Pantalla', ref('Display')),
						...common,
						'413': tooLarge,
						'422': err('La plantilla no existe (template_not_found)'),
					},
				},
				delete: {
					summary: 'Borrar la pantalla y sus tokens ligados',
					security: session,
					responses: { '204': res('Borrada'), ...common },
				},
			},
			'/displays/{deviceId}/template': {
				parameters: [deviceId],
				put: {
					summary: 'Guardar una plantilla y activarla (publica template.set y el snapshot)',
					requestBody: body(ref('DisplayTemplate')),
					responses: {
						'200': res('Detalle', ref('DisplayDetail')),
						...common,
						'409': err('Mismo id con version igual o menor (version_not_incremented)'),
						'413': tooLarge,
						'422': err('Plantilla inválida (invalid_template, con issues)'),
					},
				},
			},
			'/displays/{deviceId}/templates': {
				parameters: [deviceId],
				get: {
					summary: 'Plantillas guardadas',
					responses: { '200': res('Plantillas', { type: 'array', items: ref('DisplayTemplate') }), ...common },
				},
			},
			'/displays/{deviceId}/templates/{templateId}': {
				parameters: [deviceId, templateId],
				put: {
					summary: 'Guardar una plantilla sin activarla (si es la activa, se publica)',
					requestBody: body(ref('DisplayTemplate')),
					responses: {
						'200': res('Detalle', ref('DisplayDetail')),
						...common,
						'409': err('version_not_incremented'),
						'413': tooLarge,
						'422': err('Plantilla inválida o id distinto del de la ruta'),
					},
				},
				delete: {
					summary: 'Borrar una plantilla',
					responses: { '204': res('Borrada'), ...common, '409': err('Es la plantilla activa') },
				},
			},
			'/displays/{deviceId}/data': {
				parameters: [deviceId],
				put: {
					summary: 'Reemplazar los valores (publica data.update snapshot)',
					requestBody: body(ref('DisplayValues')),
					responses: {
						'200': res('Valores', values),
						...common,
						'413': tooLarge,
						'422': err('Valores inválidos o que no cumplen los params de la plantilla activa (invalid_data)'),
					},
				},
				patch: {
					summary: 'Merge de valores (publica data.update patch con las claves recibidas)',
					requestBody: body(ref('DisplayValues')),
					responses: {
						'200': res('Valores', values),
						...common,
						'413': tooLarge,
						'422': err('Valores inválidos, más de 64 claves o que no cumplen los params de la plantilla activa'),
					},
				},
			},
			'/displays/{deviceId}/events': {
				parameters: [
					deviceId,
					{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 } },
				],
				get: {
					summary: 'Toques recientes, del más nuevo al más antiguo',
					responses: { '200': res('Eventos', { type: 'array', items: ref('DisplayEvent') }), ...common },
				},
			},
			'/displays/{deviceId}/commands': {
				parameters: [deviceId],
				post: {
					summary: 'Enviar un comando a la pantalla conectada',
					requestBody: body(ref('DisplayCommand')),
					responses: {
						'202': res('Enviado', { type: 'object', properties: { ok: { const: true } } }),
						...common,
						'409': err('La pantalla no está conectada (device_offline)'),
						'422': err('Comando no permitido (command_not_allowed): trust.* y ota.install aún no'),
					},
				},
			},
		},
		components: {
			securitySchemes: {
				session: { type: 'apiKey', in: 'cookie', name: 'sid', description: 'Sesión de la web' },
				token: {
					type: 'http',
					scheme: 'bearer',
					description: 'Token dmt_ con displays:write (si está ligado, solo para su pantalla)',
				},
			},
			schemas: Object.fromEntries(
				Object.entries({
					ApiError,
					CreateDisplayInput,
					PatchDisplayInput,
					Display,
					DisplayDetail,
					DisplayTemplate,
					DisplayValues,
					DisplayEvent,
					DisplayCommand,
				}).map(([name, s]) => [name, schema(s, 'draft-2020-12')]),
			),
		},
	}
}
