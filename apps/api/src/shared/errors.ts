export class AppError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly issues?: unknown, // detalle de validación (p. ej. 422 de MetaDisplay)
	) {
		super(message)
		this.name = 'AppError'
	}
}

export const NotFound = (what: string) => new AppError(404, 'not_found', `${what} no encontrado`)
export const Forbidden = () => new AppError(403, 'forbidden', 'No tienes permiso')
export const Unauthorized = (msg = 'No autenticado') => new AppError(401, 'unauthorized', msg)
export const TooManyRequests = () => new AppError(429, 'too_many_requests', 'Demasiadas peticiones')
export const BadRequest = (msg: string) => new AppError(400, 'bad_request', msg)
export const Conflict = (msg: string, code = 'conflict') => new AppError(409, code, msg)
export const Unprocessable = (code: string, msg: string, issues?: unknown) => new AppError(422, code, msg, issues)
export const UnsupportedMediaType = () => new AppError(415, 'unsupported_media_type', 'Solo se acepta application/json')
