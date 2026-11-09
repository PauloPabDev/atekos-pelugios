import { DISPLAY_MAX_TEMPLATE_BYTES } from '@atekos/shared'
import * as api from '../../api'

// Lo que comparten las pestañas de la pantalla
export const fmt = (v: unknown) => JSON.stringify(v, null, 2)

// Errores de /displays (DISENO §3) que el usuario puede entender y corregir desde aquí
export const EXPLAIN: Record<string, string> = {
	version_not_incremented: 'Ya hay una plantilla con ese id y una versión igual o mayor: súbela con «version +1».',
	message_too_large: `La plantilla o los datos superan el tope de la API (DISPLAY_MAX_TEMPLATE_BYTES, ${DISPLAY_MAX_TEMPLATE_BYTES / 1_048_576} MB por defecto): reduce o comprime las imágenes, o quita elementos.`,
	invalid_template: 'La API rechazó la plantilla:',
	invalid_data: 'La API rechazó los datos:',
	device_offline: 'La pantalla no está conectada: el comando no se envió.',
	command_not_allowed: 'Ese comando no está permitido.',
}

type Issue = { path: readonly PropertyKey[]; message: string }

// Texto de un editor → valor validado con el esquema, o las líneas de error (JSON roto o issues de zod)
export function validate<T>(
	schema: { safeParse(v: unknown): { data?: T; error?: { issues: Issue[] } } },
	text: string,
) {
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch (e) {
		return { errors: [`No es JSON válido: ${(e as Error).message}`] }
	}
	const r = schema.safeParse(value)
	return r.error ? { errors: api.issueLines(r.error.issues) } : { data: r.data, errors: [] }
}
