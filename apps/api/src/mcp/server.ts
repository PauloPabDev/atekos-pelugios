import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z, ZodError } from 'zod'
import {
	CreateDeviceInput,
	CreateDisplayInput,
	DISPLAY_HEIGHT,
	DISPLAY_WIDTH,
	DisplayCommand,
	DisplayHardwareId,
	DisplayTemplate,
	DisplayTemplateShape,
	DisplayValues,
	PatchDataInput,
	PatchDisplayInput,
	templateVariables,
} from '@atekos/shared'
import { CONTRACT_FILES, contractJson } from '../contract'
import type { Container } from '../container'
import type { Actor } from '../modules/devices/domain/policy'
import { findAdmin } from '../modules/displays/application/access'
import { AppError, Unprocessable } from '../shared/errors'
import { fetchImage } from './fetch-image'
import { displayGuide, GUIDE_URI, MB } from './guide'
import {
	FITS,
	fitsCanvas,
	IMAGE_TTL_SEC,
	MAX_SOURCE_BYTES,
	resolveRefs,
	storeImage,
	toDisplayImage,
	withRefs,
} from './images'

const W = DISPLAY_WIDTH
const H = DISPLAY_HEIGHT

const INSTRUCTIONS = `Servidor de domótica atekos-pelugios: dispositivos (estado on/off y data libre) y pantallas MetaDisplay del usuario que autorizó la conexión.

Pantallas, modelo mental:
- Una pantalla (deviceId «md-» + 12 hex) guarda varias plantillas (id + version), tiene UNA activa (la que se ve) y UN conjunto de datos (values) que comparten todas.
- Plantilla = JSON con lo que se dibuja (elements, animation) y lo que hacen los toques y los botones físicos (actions). No declara parámetros: nombra variables en bind, binds, format ("Temp: {temp} C") y when.
- Datos = los valores de esas variables; es lo que el usuario llama «parámetros». Solo llegan con update_display_data. Para cambiar un número, un texto o un color ligado a una variable, NO toques la plantilla.

Flujo: list_displays → get_display (plantilla activa, versiones, valores y ficha de la placa) → [upload_display_image] → set_display_template → update_display_data.

Reglas de oro:
1. Antes de diseñar o cambiar una plantilla, lee una vez get_display_guide: todos los campos, la lógica de las variables, recetas paso a paso y la checklist.
2. Al guardar un id que ya existe, version tiene que ser MAYOR que la guardada (get_display.templates); si no, 409 version_not_incremented.
3. Lienzo: rotation 0/180 = ${W}×${H} (vertical); 90/270 = ${H}×${W} (horizontal). Origen arriba a la izquierda, enteros, y nada puede salirse.
4. Imágenes: upload_display_image (url https o base64 de un PNG/JPEG) devuelve un elemento con data "ref:…": cópialo en elements cambiando solo x/y. Nunca escribas ni inventes base64 de píxeles. Al leer, las imágenes ya vienen como "ref:…" y se reenvían tal cual.
5. Una imagen de fondo va la PRIMERA en elements: lo que va después se dibuja encima.
6. Textos en ASCII sin tildes ni ñ (fuente de 6×8 px escalada por size).
7. Los errores vuelven con isError y { error, message, issues }: corrige lo que dicen los issues y reintenta.
- No puedes borrar pantallas ni crear tokens: la placa se conecta con un token display:connect que el usuario crea en la web.`

const DeviceId = z.uuid().describe('id (uuid) del dispositivo')
const HardwareId = DisplayHardwareId.describe('deviceId de la pantalla: «md-» + 12 hex, p. ej. md-34B7DA01ABCD')
const TemplateId = z.string().min(1).max(64).describe('id de una plantilla guardada (get_display.templates)')
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/)

const ok = (v: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(v) }] })
const fail = (v: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(v) }], isError: true })
const read = { readOnlyHint: true, openWorldHint: false }
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

// Un servidor por petición (el transporte es sin estado), con el actor del token OAuth ya resuelto.
// Llama a los mismos casos de uso que la REST: permisos, validación, caché y eventos son los mismos.
export function buildMcpServer(c: Container, actor: Extract<Actor, { kind: 'token' }>) {
	const server = new McpServer({ name: 'atekos-pelugios', version: '1.1.0' }, { instructions: INSTRUCTIONS })
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
	const guide = displayGuide(c.env.DISPLAY_MAX_TEMPLATE_BYTES)
	// Las plantillas salen con las imágenes por referencia (la IA no copia el base64) y con las variables que nombran.
	const detail = <T extends { template: DisplayTemplate }>(v: T) => ({
		...v,
		template: withRefs(v.template),
		variables: templateVariables(v.template),
	})

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

	// ---------- Pantallas MetaDisplay (docs/MCP.md y la guía de guide.ts) ----------

	server.registerTool(
		'get_display_guide',
		{
			title: 'Guía de las pantallas',
			description:
				'Guía completa (Markdown) para diseñar y controlar las pantallas: lienzo, cada elemento con sus campos y rangos, variables (bind, binds, format, when), animación, acciones y botones, imágenes por referencia, comandos, eventos, límites, errores y recetas paso a paso con el JSON exacto. Léela una vez antes de crear o cambiar plantillas.',
			annotations: read,
		},
		() => ({ content: [{ type: 'text', text: guide }] }),
	)
	server.registerResource(
		'guia-pantallas',
		GUIDE_URI,
		{
			title: 'Guía de las pantallas MetaDisplay',
			description: 'La misma guía que get_display_guide',
			mimeType: 'text/markdown',
		},
		(uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: guide }] }),
	)

	server.registerTool(
		'list_displays',
		{
			title: 'Listar pantallas',
			description:
				'Lista las pantallas MetaDisplay del usuario: deviceId, name, activeTemplateId, online y lastSeenAt (último contacto de la placa). Úsala para saber qué deviceId pasar al resto de herramientas.',
			annotations: read,
		},
		() => run(() => s.list.execute(actor)),
	)
	server.registerTool(
		'get_display',
		{
			title: 'Ver pantalla',
			description: [
				'Estado completo de una pantalla. Léela antes de cambiar nada.',
				'Devuelve: template (la plantilla activa, con cada imagen como data "ref:…"), variables (las que nombra la plantilla activa), templates (las guardadas: [{ id, version }], para saber qué version subir), values (los datos actuales: las variables), online, lastSeenAt (último contacto) e info (ficha de la placa o null: info.buttons = botones físicos { button, name, gpio }, info.display = { width, height, touch, buttons, driver }, firmware, board, capabilities).',
			].join(' '),
			inputSchema: { deviceId: HardwareId },
			annotations: read,
		},
		({ deviceId }) => run(async () => detail(await s.get.execute(actor, deviceId))),
	)
	server.registerTool(
		'get_display_template',
		{
			title: 'Ver plantilla',
			description:
				'Devuelve una plantilla completa de la pantalla: la activa si no pasas templateId, o la guardada con ese id. Las imágenes vienen como data "ref:…", que set_display_template acepta tal cual: para modificar una plantilla, léela, cambia lo necesario, sube version y guárdala.',
			inputSchema: { deviceId: HardwareId, templateId: TemplateId.optional() },
			annotations: read,
		},
		({ deviceId, templateId }) =>
			run(async () => {
				const { template } = await s.get.execute(actor, deviceId)
				const t =
					templateId === undefined || templateId === template.id
						? template
						: (await s.listTemplates.execute(actor, deviceId)).find((x) => x.id === templateId)
				if (!t) throw new AppError(404, 'not_found', `No existe la plantilla ${templateId}`)
				return withRefs(t)
			}),
	)
	server.registerTool(
		'create_display',
		{
			title: 'Crear pantalla',
			description:
				'Da de alta una pantalla MetaDisplay con su deviceId físico. Empieza con la plantilla «inicio» (v1), que muestra el nombre y la variable «mensaje».',
			inputSchema: CreateDisplayInput.shape,
			annotations: write,
		},
		(input) => run(() => s.create.execute(actor, input)),
	)
	server.registerTool(
		'set_display_template',
		{
			title: 'Guardar plantilla',
			description: [
				'Guarda una plantilla en la pantalla. activate:true (por defecto) la activa y, si la pantalla está conectada, la recibe al momento. activate:false la guarda sin activar: para las pantallas destino de una acción screen.<id> o para dejarla preparada (actívala luego con update_display).',
				'Mismo id que una guardada → version mayor (si no, 409 version_not_incremented).',
				`Lienzo: rotation 0/180 = ${W}×${H} px, 90/270 = ${H}×${W}; nada puede salirse.`,
				'Elementos: text, rect, line, progress, button, circle, ellipse, polygon, arc, curve e image. Variables: bind, binds, format "{var}" y when; sus valores llegan solo por update_display_data.',
				'Imágenes: data "ref:…" de upload_display_image o de get_display/get_display_template (w y h los de la imagen); un base64 rgb565 válido también vale.',
				'Si la plantilla no es válida devuelve invalid_template con issues (ruta y motivo). Detalle de cada campo y recetas: get_display_guide.',
				'Ej.: { "deviceId": "md-34B7DA01ABCD", "template": { "id": "temp.v1", "version": 1, "background": "#000000", "elements": [ { "type": "text", "x": 10, "y": 20, "size": 3, "format": "{temp} C" } ], "actions": [] } }',
			].join(' '),
			inputSchema: {
				deviceId: HardwareId,
				template: DisplayTemplateShape,
				activate: z.boolean().default(true).describe('false = guardar sin activar'),
			},
			annotations: { ...write, idempotentHint: true },
		},
		({ deviceId, template, activate }) =>
			run(async () => {
				const display = await findAdmin(s.repo, actor, deviceId)
				const resolved = await resolveRefs(template, { redis: c.redis, repo: s.repo, displayId: display.id })
				const r = DisplayTemplate.safeParse(resolved)
				if (!r.success) throw Unprocessable('invalid_template', 'Plantilla inválida', r.error.issues)
				return detail(
					activate
						? await s.putTemplate.execute(actor, deviceId, r.data)
						: await s.putTemplateById.execute(actor, deviceId, r.data.id, r.data),
				)
			}),
	)
	server.registerTool(
		'update_display',
		{
			title: 'Renombrar o cambiar de plantilla',
			description:
				'Cambia el nombre de la pantalla y/o activa una plantilla ya guardada (activeTemplateId); la pantalla conectada la recibe con sus datos al momento. Una plantilla que no existe → 422 template_not_found. Ej.: { "deviceId": "md-34B7DA01ABCD", "activeTemplateId": "noche.v1" }',
			inputSchema: { deviceId: HardwareId, ...PatchDisplayInput.shape },
			annotations: { ...write, idempotentHint: true },
		},
		({ deviceId, ...patch }) => run(() => s.patch.execute(actor, deviceId, patch)),
	)
	server.registerTool(
		'delete_display_template',
		{
			title: 'Borrar plantilla',
			description:
				'Borra una plantilla guardada de la pantalla. La activa no se puede borrar (409 conflict): activa antes otra con update_display. No borra la pantalla ni sus datos.',
			inputSchema: { deviceId: HardwareId, templateId: TemplateId },
			annotations: { ...write, destructiveHint: true, idempotentHint: true },
		},
		({ deviceId, templateId }) =>
			run(async () => {
				await s.deleteTemplate.execute(actor, deviceId, templateId)
				return { ok: true }
			}),
	)
	server.registerTool(
		'update_display_data',
		{
			title: 'Cambiar los datos de la pantalla',
			description: [
				'Envía valores a las variables de la pantalla (las que la plantilla nombra en bind, binds, format y when): es la única vía por la que llegan y la pantalla redibuja al momento. Los datos son de la pantalla y los comparten todas sus plantillas.',
				'Por defecto hace merge: solo cambian las claves enviadas. replace:true sustituye TODOS los valores por los enviados: es la forma de quitar variables.',
				'Valores: texto (≤ 140, en ASCII), número, booleano o null; claves de ≤ 40 caracteres y como mucho 64 en total.',
				'Ej.: { "deviceId": "md-34B7DA01ABCD", "values": { "temp": 31.5, "alarma": true } }',
			].join(' '),
			inputSchema: {
				deviceId: HardwareId,
				values: DisplayValues,
				replace: z.boolean().default(false).describe('true = sustituir todos los valores'),
			},
			annotations: { ...write, idempotentHint: true },
		},
		({ deviceId, values, replace }) =>
			run(() => (replace ? s.putData.execute(actor, deviceId, values) : s.patchData.execute(actor, deviceId, values))),
	)
	server.registerTool(
		'send_display_command',
		{
			title: 'Enviar comando a la pantalla',
			description:
				'Comando a la placa conectada: { "type": "display.refresh" } redibuja todo; { "type": "display.brightness", "percent": 0–50 } fija el brillo; { "type": "display.info" } pide la ficha de la placa (llega a get_display.info en unos segundos). Sin conexión → 409 device_offline. Queda auditado.',
			inputSchema: { deviceId: HardwareId, command: DisplayCommand },
			annotations: write,
		},
		({ deviceId, command }) =>
			run(async () => {
				await s.sendCommand.execute(actor, deviceId, command)
				return { ok: true }
			}),
	)
	server.registerTool(
		'list_display_events',
		{
			title: 'Ver toques y botones',
			description:
				'Historial de toques y pulsaciones de botones físicos, del más reciente al más antiguo: actionId, source (touch | button), button, press (short | long), x, y, templateId, status (ok | rejected | error) y toast. Sirve para comprobar que una acción funciona.',
			inputSchema: { deviceId: HardwareId, limit: z.number().int().min(1).max(200).default(20) },
			annotations: read,
		},
		({ deviceId, limit }) => run(() => s.listEvents.execute(actor, deviceId, limit)),
	)
	server.registerTool(
		'upload_display_image',
		{
			title: 'Subir imagen',
			description: [
				`Convierte un PNG o JPEG en una imagen de la pantalla y la deja lista para usar durante ${IMAGE_TTL_SEC / 3600} h.`,
				`Pasa exactamente uno de url (https pública) o base64 (el archivo PNG/JPEG en base64, con o sin prefijo data:). width × height: el tamaño final en px, que tiene que caber en el lienzo (hasta ${W}×${H} o ${H}×${W}).`,
				'fit: contain (entera, con bandas del color background), cover (llena la caja y recorta el centro) o fill (estira). background: color de las bandas y de las zonas transparentes.',
				`Devuelve { ref, element, bytes }: copia element en los elements de set_display_template cambiando solo x/y (data es la referencia "ref:…"). bytes = lo que ocupará en la plantilla (tope total ${MB(c.env.DISPLAY_MAX_TEMPLATE_BYTES)}).`,
				`Para un fondo a pantalla completa: width ${W}, height ${H} (o ${H}×${W} con rotation 90/270), fit cover, y el elemento el primero de la lista.`,
			].join(' '),
			inputSchema: {
				deviceId: HardwareId,
				url: z
					.url()
					.optional()
					.describe(`URL https de un PNG o JPEG (≤ ${MB(MAX_SOURCE_BYTES)})`),
				base64: z.string().optional().describe('El archivo PNG o JPEG en base64'),
				width: z.number().int().min(1).max(H).describe('ancho final en px'),
				height: z.number().int().min(1).max(H).describe('alto final en px'),
				fit: z.enum(FITS).default('contain'),
				background: Color.default('#000000'),
			},
			annotations: { ...write, idempotentHint: true, openWorldHint: true },
		},
		({ deviceId, url, base64, width, height, fit, background }) =>
			run(async () => {
				if ((url === undefined) === (base64 === undefined))
					throw Unprocessable('invalid_input', 'Pasa exactamente uno de url o base64')
				if (!fitsCanvas(width, height))
					throw Unprocessable('invalid_size', `${width}×${height} no cabe en el lienzo: ${W}×${H} o ${H}×${W}`)
				const display = await findAdmin(s.repo, actor, deviceId)
				const file = url ? await fetchImage(url) : Buffer.from(base64!.replace(/^data:[^,]*,/, ''), 'base64')
				const img = toDisplayImage(file, width, height, fit, background)
				const ref = await storeImage(c.redis, display.id, img)
				const element = { type: 'image', x: 0, y: 0, w: width, h: height, encoding: img.encoding, data: ref }
				return { ref, element, bytes: img.data.length }
			}),
	)
	// Contrato MetaDisplay (docs/metadisplay/README.md): el mismo JSON que GET /api/v1/contract/*.
	const origin = c.env.PUBLIC_URL!
	server.registerTool(
		'get_display_contract',
		{
			title: 'Contrato de las pantallas',
			description:
				'Contrato MetaDisplay vigente con su versión y fecha (info.version, info["x-updated"]). asyncapi: lo que intercambian la pantalla y el servidor por WSS /ws/device. openapi: la REST de pantallas. Para diseñar plantillas basta get_display_guide.',
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
