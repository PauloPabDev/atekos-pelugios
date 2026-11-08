import { z } from 'zod'
import { NotFound } from './errors'

const Uuid = z.uuid()

// Un id que no es uuid haría fallar el cast de PG (500); para el cliente es un recurso que no existe.
export function parseId(value: string | undefined, what: string) {
	const r = Uuid.safeParse(value)
	if (!r.success) throw NotFound(what)
	return r.data
}
