import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z, ZodError } from 'zod'
import {
	CreateDeviceInput,
	CreateDisplayInput,
	DISPLAY_HEIGHT,
	DISPLAY_WIDTH,
	DisplayHardwareId,
	DisplayTemplate,
	DisplayValues,
	PatchDataInput,
} from '@atekos/shared'
import { CONTRACT_FILES, contractJson } from '../contract'
import type { Container } from '../container'
import type { Actor } from '../modules/devices/domain/policy'
import { AppError } from '../shared/errors'

const INSTRUCTIONS = `Servidor de domótica atekos-pelugios. Gestiona los dispositivos y las pantallas MetaDisplay del usuario que autorizó la conexión.
- Dispositivos: tienen un estado on/off (state) y un objeto data libre; update_device_data hace merge superficial sobre data.
- Pantallas MetaDisplay: lienzo de ${DISPLAY_WIDTH}×${DISPLAY_HEIGHT} px en vertical o ${DISPLAY_HEIGHT}×${DISPLAY_WIDTH} con rotation 90/270, identificadas por su deviceId «md-» + 12 hex. Flujo: create_display → set_display_template (guarda y activa la plantilla, que nombra sus variables en bind, binds, format y when) → update_display_data (envía los valores de esas variables; es la única vía por la que llegan).
- La pantalla física se conecta con un token display:connect que el usuario crea en la web (Tokens); este servidor no crea tokens ni borra nada.
- El contrato oficial de las pantallas (mensajes del WSS /ws/device, plantillas, límites y la REST) está en get_display_contract y en los recursos atekos://contract/*: consúltalo antes de diseñar plantillas o features.
- Los errores vuelven como resultado con isError y un JSON { error, message, issues }: corrige con los issues y reintenta.`

const DeviceId = z.uuid().describe('id (uuid) del dispositivo')
const HardwareId = DisplayHardwareId.describe('deviceId de la pantalla: «md-» + 12 hex, p. ej. md-34B7DA01ABCD')

const ok = (v: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(v) }] })
const fail = (v: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(v) }], isError: true })
const read = { readOnlyHint: true, openWorldHint: false }
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

// Un servidor por petición (el transporte es sin estado), con el actor del token OAuth ya resuelto.
// Llama a los mismos casos de uso que la REST: permisos, validación, caché y eventos son los mismos.
export function buildMcpServer(c: Container, actor: Extract<Actor, { kind: 'token' }>) {
	const server = new McpServer({ name: 'atekos-pelugios', version: '1.0.0' }, { instructions: INSTRUCTIONS })
	const d = c.devices
	const s = c.displays

	// Los errores del dominio (404, 403, 409, 422 con issues…) son un resultado de la herramienta, no un fallo del protocolo.
	const run = async (fn: () => Promise<unknown>) => {
		try {
			return ok(await fn())
		} catch (err) {
			if (err instanceof AppError) return fail({ error: err.code, message: err.message, issues: err.issues })
			if (err instanceof ZodError) return fail({ error: 'validation', issues: err.issues })
			c.logger.error({ err }, 'mcp: error no controlado')
			return fail({ error: 'internal', message: 'Error interno' })
		}
	}

	server.registerTool(
		'list_devices',
		{ title: 'Listar dispositivos', description: 'Lista los dispositivos del usuario.', annotations: read },
		() => run(() => d.list.execute(actor)),
	)
	server.registerTool(
		'get_device',
		{
			title: 'Ver dispositivo',
			description: 'Devuelve un dispositivo con su estado y sus datos.',
			inputSchema: { id: DeviceId },
			annotations: read,
		},
		({ id }) => run(() => d.get.execute(actor, id)),
	)
	server.registerTool(
		'create_device',
		{
			title: 'Crear dispositivo',
			description:
				'Crea un dispositivo. slug: minúsculas, números y guiones (único por usuario). type: light, switch, sensor o generic. Privado por defecto.',
			inputSchema: CreateDeviceInput.shape,
			annotations: write,
		},
		(input) => run(() => d.create.execute(actor, input)),
	)
	server.registerTool(
		'set_device_state',
		{
			title: 'Encender o apagar',
			description: 'Fija el estado on/off (state) de un dispositivo.',
			inputSchema: { id: DeviceId, state: z.boolean() },
			annotations: { ...write, idempotentHint: true },
		},
		({ id, state }) => run(() => d.setState.execute(actor, id, state, 'http')),
	)
	server.registerTool(
		'update_device_data',
		{
			title: 'Actualizar datos del dispositivo',
			description:
				'Merge superficial sobre data: las claves enviadas se sustituyen y las demás se conservan. Ej.: { "brillo": 80 }.',
			inputSchema: { id: DeviceId, data: PatchDataInput },
			annotations: { ...write, idempotentHint: true },
		},
		({ id, data }) => run(() => d.patchData.execute(actor, id, data)),
	)

	server.registerTool(
		'list_displays',
		{ title: 'Listar pantallas', description: 'Lista las pantallas MetaDisplay del usuario.', annotations: read },
		() => run(() => s.list.execute(actor)),
	)
	server.registerTool(
		'get_display',
		{
			title: 'Ver pantalla',
			description: 'Devuelve la pantalla con su plantilla activa, la lista de plantillas y los valores actuales.',
			inputSchema: { deviceId: HardwareId },
			annotations: read,
		},
		({ deviceId }) => run(() => s.get.execute(actor, deviceId)),
	)
	server.registerTool(
		'create_display',
		{
			title: 'Crear pantalla',
			description:
				'Da de alta una pantalla MetaDisplay con su deviceId físico. Empieza con la plantilla «inicio», que muestra el nombre y la variable «mensaje».',
			inputSchema: CreateDisplayInput.shape,
			annotations: write,
		},
		(input) => run(() => s.create.execute(actor, input)),
	)
	server.registerTool(
		'set_display_template',
		{
			title: 'Diseñar pantalla',
			description: [
				'Guarda una plantilla y la activa (si la pantalla está conectada, la recibe al momento). Sube version al cambiar una plantilla con el mismo id.',
				`Lienzo: rotation 0/180 = ${DISPLAY_WIDTH}×${DISPLAY_HEIGHT} px (vertical), 90/270 = ${DISPLAY_HEIGHT}×${DISPLAY_WIDTH} (horizontal); origen arriba a la izquierda y ningún elemento puede salirse.`,
				'Elementos: text, rect, line, progress (value 0–100), button, circle {x,y,r}, ellipse {x,y,rx,ry}, polygon {points:[[x,y],…], closed}, arc {x,y,r,start,end en grados, 0 = las 3, horario}, curve {points: 3 = Bézier cuadrática, 4 = cúbica} e image {x,y,w,h, encoding rgb565|rgb565-rle, data base64}. stroke = grosor (1–32); colores #RRGGBB; filled/fillColor en las formas.',
				'Variables: la plantilla no las declara, las nombra; sus valores llegan solo por los datos (update_display_data) y una variable sin valor deja el texto vacío o la propiedad tal cual. text/progress/button llevan value, bind o format ("Temp: {temp} C"); binds liga cualquier propiedad a una variable ({ "x": "posX", "color": "estado" }); when = reglas en orden [{ key, op: eq|ne|gt|gte|lt|lte|truthy|falsy, value, set: {…} }]; visible:false oculta.',
				'animation: { frames: [{ ms, elements }], repeat (0 = siempre) } se dibuja encima de elements.',
				'actions: trigger tap (zona x,y,w,h) o button (botón físico 0..15, press short|long, zona opcional que se resalta), mode local|remote|hybrid, event screen.<templateId> | data.refresh | data.set (fusiona payload en los valores).',
				'El MCP acepta cuerpos de 32 KB: las imágenes grandes van por la REST (PUT /api/v1/displays/{deviceId}/template).',
			].join(' '),
			inputSchema: { deviceId: HardwareId, template: DisplayTemplate },
			annotations: { ...write, idempotentHint: true },
		},
		({ deviceId, template }) => run(() => s.putTemplate.execute(actor, deviceId, template)),
	)
	server.registerTool(
		'update_display_data',
		{
			title: 'Actualizar datos de la pantalla',
			description:
				'Merge de las variables de la pantalla: los valores que usa la plantilla activa (get_display la devuelve) en bind, binds, format y when. Valores: texto (≤ 140), número, booleano o null; máximo 64 claves.',
			inputSchema: { deviceId: HardwareId, values: DisplayValues },
			annotations: { ...write, idempotentHint: true },
		},
		({ deviceId, values }) => run(() => s.patchData.execute(actor, deviceId, values)),
	)

	// Contrato MetaDisplay (docs/metadisplay/README.md): el mismo JSON que GET /api/v1/contract/*.
	const origin = c.env.PUBLIC_URL!
	server.registerTool(
		'get_display_contract',
		{
			title: 'Contrato de las pantallas',
			description:
				'Contrato MetaDisplay vigente con su versión y fecha (info.version, info["x-updated"]). asyncapi: lo que intercambian la pantalla y el servidor por WSS /ws/device. openapi: la REST de pantallas.',
			inputSchema: { part: z.enum(['asyncapi', 'openapi']).default('asyncapi') },
			annotations: read,
		},
		({ part }) => ({
			content: [{ type: 'text', text: contractJson(`${part}.json`, origin, c.env.DISPLAY_MAX_TEMPLATE_BYTES) }],
		}),
	)
	for (const file of CONTRACT_FILES)
		server.registerResource(
			`contrato-${file}`,
			`atekos://contract/${file}`,
			{
				title: `Contrato MetaDisplay (${file})`,
				description: file.startsWith('async') ? 'Protocolo WSS /ws/device' : 'REST /api/v1/displays',
				mimeType: 'application/json',
			},
			(uri) => ({
				contents: [
					{
						uri: uri.href,
						mimeType: 'application/json',
						text: contractJson(file, origin, c.env.DISPLAY_MAX_TEMPLATE_BYTES),
					},
				],
			}),
		)

	return server
}
