import { useState } from 'react'
import { DISPLAY_MAX_TEMPLATE_BYTES } from '@atekos/shared'
import type { DisplayValues } from '@atekos/shared'
import * as api from '../../api'

// Lo que comparten las pestañas de la pantalla
export const fmt = (v: unknown) => JSON.stringify(v, null, 2)

// Errores de /displays (DISENO §3) que el usuario puede entender y corregir desde aquí
export const EXPLAIN: Record<string, string> = {
	// La web ya sube la versión sola: un 409 solo llega si otra pestaña o un script guardó a la vez
	version_not_incremented:
		'Se guardó otra versión de esta plantilla mientras editabas: vuelve a guardar y se usará la siguiente.',
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

// La pantalla cachea por id y versión: guardar un id que ya existe exige una versión mayor que la guardada
export const nextVersion = (draft: number, saved: number | undefined) =>
	saved === undefined ? draft : Math.max(draft, saved + 1)

type Scalar = DisplayValues[string]
export type Kind = 'text' | 'number' | 'bool'
export const KIND: Record<Kind, string> = { text: 'Texto', number: 'Número', bool: 'Sí/No' }

// Control de una variable según su valor guardado; sin valor (o null), texto
export const kindOf = (v: Scalar | undefined): Kind =>
	typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : 'text'

// Valor guardado → lo que enseña su control. Los números van como texto para poder teclear «21,» a medias.
export const toField = (v: Scalar | undefined): string | boolean =>
	typeof v === 'boolean' ? v : v === null || v === undefined ? '' : String(v)

// Lo tecleado → el valor que se envía, o por qué no vale. Acepta la coma decimal.
export function parseField(kind: Kind, raw: string | boolean): { value: Scalar } | { error: string } {
	if (kind === 'bool') return { value: raw === true }
	if (kind === 'text') return { value: String(raw) }
	const s = String(raw).trim().replace(',', '.')
	const n = Number(s)
	return s === '' || !Number.isFinite(n) ? { error: 'No es un número.' } : { value: n }
}

// Marca de agua de una lista que llega por polling (de la más reciente a la más antigua): el ts más nuevo al
// cargar. Lo posterior llegó en vivo y destella; lo que ya estaba al entrar, no.
export function useArrived(newest: string | undefined, loaded: boolean) {
	const [since, setSince] = useState<string>()
	if (since === undefined && loaded) setSince(newest ?? '')
	return (ts: string) => since !== undefined && ts > since
}
