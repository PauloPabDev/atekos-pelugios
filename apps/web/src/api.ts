import { ApiError } from '@atekos/shared'
import type {
	ApiToken,
	CreateDeviceInput,
	CreatedApiToken,
	CreateTokenInput,
	Device,
	DeviceEvent,
	LoginInput,
	PatchDataInput,
	PatchDeviceInput,
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
