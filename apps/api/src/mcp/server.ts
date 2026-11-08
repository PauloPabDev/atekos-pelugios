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
import type { Container } from '../container'
import type { Actor } from '../modules/devices/domain/policy'
import { AppError } from '../shared/errors'

const INSTRUCTIONS = `Servidor de domótica atekos-pelugios. Gestiona los dispositivos y las pantallas MetaDisplay del usuario que autorizó la conexión.
- Dispositivos: tienen un estado on/off (state) y un objeto data libre; update_device_data hace merge superficial sobre data.
- Pantallas MetaDisplay: ${DISPLAY_WIDTH}×${DISPLAY_HEIGHT} px, identificadas por su deviceId «md-» + 12 hex. Flujo: create_display → set_display_template (guarda y activa la plantilla) → update_display_data (rellena las variables que la plantilla usa con bind).
- La pantalla física se conecta con un token display:connect que el usuario crea en la web (Tokens); este servidor no crea tokens ni borra nada.
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
			description: `Guarda una plantilla y la activa (si la pantalla está conectada, la recibe al momento). Lienzo de ${DISPLAY_WIDTH}×${DISPLAY_HEIGHT} px con origen arriba a la izquierda; ningún elemento puede salirse. Elementos: text, rect, line, progress (value 0–100) y button. text, progress y button llevan value fijo o bind a una variable que se rellena con update_display_data. Hasta 45 elementos y 24 acciones táctiles. Sube version al cambiar una plantilla con el mismo id.`,
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
				'Merge de las variables de la pantalla (las que usan los bind de la plantilla). Valores: texto (≤ 140), número, booleano o null. Máximo 64 variables.',
			inputSchema: { deviceId: HardwareId, values: DisplayValues },
			annotations: { ...write, idempotentHint: true },
		},
		({ deviceId, values }) => run(() => s.patchData.execute(actor, deviceId, values)),
	)

	return server
}
