import { ApiError } from '@atekos/shared'
import type {
	ApiToken,
	CreateDeviceInput,
	CreatedApiToken,
	CreateDisplayInput,
	CreateTokenInput,
	Device,
	DeviceEvent,
	Display,
	DisplayCommand,
	DisplayDetail,
	DisplayEvent,
	DisplayTemplate,
	DisplayValues,
	LoginInput,
	PatchDataInput,
	PatchDeviceInput,
	PatchDisplayInput,
	RegisterInput,
	User,
} from '@atekos/shared'

// Respuesta no-2xx de la API; `body` tiene la forma { error, message? } de §6
export class HttpError extends Error {
	status: number
	body: ApiError
	constructor(status: number, body: ApiError) {
		super(body.message ?? body.error)
		this.status = status
		this.body = body
	}
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`/api/v1${path}`, {
		method,
		credentials: 'same-origin',
		headers: body === undefined ? {} : { 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const text = await res.text()
	let json: unknown
	try {
		json = text ? JSON.parse(text) : undefined
	} catch {
		// cuerpo que no es JSON (p. ej. un 502 en HTML del proxy)
	}
	if (!res.ok) {
		const err = ApiError.safeParse(json)
		throw new HttpError(res.status, err.success ? err.data : { error: `http_${res.status}` })
	}
	return json as T
}

// Issues de zod (del cliente o de un 422 de la API), uno por línea: «elements.0.x: …»
export const issueLines = (issues: readonly { path?: readonly PropertyKey[]; message?: string }[]) =>
	issues.map((i) => (i.path?.length ? `${i.path.map(String).join('.')}: ` : '') + (i.message ?? ''))

// Líneas de un error para la UI: la explicación de su código (si hay), el código y los issues de la API
export function errorLines(e: Error | null, explain: Record<string, string> = {}): string[] {
	if (!e) return []
	if (!(e instanceof HttpError)) return [e.message]
	const { error, message, issues } = e.body
	return [
		`${explain[error] ?? message ?? error} (${e.status} ${error})`,
		...(Array.isArray(issues) ? issueLines(issues) : []),
	]
}

// El id viene de la URL: se codifica para que no pueda salirse de /devices/…
const dev = (id: string) => `/devices/${encodeURIComponent(id)}`

export const me = () => request<User>('GET', '/auth/me')
export const login = (input: LoginInput) => request<unknown>('POST', '/auth/login', input)
export const register = (input: RegisterInput) => request<unknown>('POST', '/auth/register', input)
export const logout = () => request<unknown>('POST', '/auth/logout')

export const listDevices = () => request<Device[]>('GET', '/devices')
export const createDevice = (input: CreateDeviceInput) => request<Device>('POST', '/devices', input)
export const getDevice = (id: string) => request<Device>('GET', dev(id))
export const patchDevice = (id: string, input: PatchDeviceInput) => request<Device>('PATCH', dev(id), input)
export const deleteDevice = (id: string) => request<unknown>('DELETE', dev(id))
export const toggleDevice = (id: string) => request<Device>('POST', `${dev(id)}/toggle`)
export const patchData = (id: string, data: PatchDataInput) => request<Device>('PATCH', `${dev(id)}/data`, data)
export const listEvents = (id: string) => request<DeviceEvent[]>('GET', `${dev(id)}/events?limit=50`)

export const listTokens = () => request<ApiToken[]>('GET', '/tokens')
export const createToken = (input: CreateTokenInput) => request<CreatedApiToken>('POST', '/tokens', input)
export const revokeToken = (id: string) => request<unknown>('DELETE', `/tokens/${encodeURIComponent(id)}`)

// ≠ contrato: CreateTokenInput.displayId y ApiToken.displayId son el uuid de la pantalla, pero Display no lo expone.
// shortcut: se usa `id` si la API lo envía; quitar el `& { id?: string }` cuando Display incluya el uuid
export type ListedDisplay = Display & { id?: string }

const disp = (deviceId: string) => `/displays/${encodeURIComponent(deviceId)}`

export const listDisplays = () => request<ListedDisplay[]>('GET', '/displays')
export const createDisplay = (input: CreateDisplayInput) => request<Display>('POST', '/displays', input)
export const getDisplay = (deviceId: string) => request<DisplayDetail>('GET', disp(deviceId))
export const patchDisplay = (deviceId: string, input: PatchDisplayInput) =>
	request<Display>('PATCH', disp(deviceId), input)
export const deleteDisplay = (deviceId: string) => request<unknown>('DELETE', disp(deviceId))
// Guarda la plantilla y la deja activa
export const putActiveTemplate = (deviceId: string, t: DisplayTemplate) =>
	request<Display>('PUT', `${disp(deviceId)}/template`, t)
export const listDisplayTemplates = (deviceId: string) =>
	request<DisplayTemplate[]>('GET', `${disp(deviceId)}/templates`)
// Guarda sin activar; el diseño no fija el cuerpo de la respuesta
export const putDisplayTemplate = (deviceId: string, t: DisplayTemplate) =>
	request<unknown>('PUT', `${disp(deviceId)}/templates/${encodeURIComponent(t.id)}`, t)
export const deleteDisplayTemplate = (deviceId: string, templateId: string) =>
	request<unknown>('DELETE', `${disp(deviceId)}/templates/${encodeURIComponent(templateId)}`)
export const putDisplayData = (deviceId: string, values: DisplayValues) =>
	request<{ values: DisplayValues }>('PUT', `${disp(deviceId)}/data`, values)
export const patchDisplayData = (deviceId: string, values: DisplayValues) =>
	request<{ values: DisplayValues }>('PATCH', `${disp(deviceId)}/data`, values)
export const listDisplayEvents = (deviceId: string) => request<DisplayEvent[]>('GET', `${disp(deviceId)}/events`)
export const sendDisplayCommand = (deviceId: string, command: DisplayCommand) =>
	request<{ ok: true }>('POST', `${disp(deviceId)}/commands`, command)
