import { useEffect, useState } from 'react'

const PREFIX = 'draft:'

function read<T>(key: string): T | undefined {
	try {
		const s = sessionStorage.getItem(PREFIX + key)
		return s === null ? undefined : (JSON.parse(s) as T)
	} catch {
		return undefined
	}
}

// Igual al valor de partida: entonces no hay borrador
const same = (a: unknown, b: unknown) => a === b || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b))

// Borrador que sobrevive al cambio de pestaña (el Outlet desmonta) y a recargar. Sin cambios, el valor sigue a
// `initial`, así que un cambio que llega en vivo se ve; con cambios, se queda el tuyo. La clave empieza por la URL
// de la pestaña («/devices/<id>/datos…»): así hasDraft() marca la pestaña. La clave no cambia en vida del componente
// (remóntalo con key si cambia la entidad).
export function useDraft<T>(key: string, initial: T) {
	const [edited, setEdited] = useState(() => read<T>(key))
	useEffect(() => {
		try {
			if (edited === undefined) sessionStorage.removeItem(PREFIX + key)
			else sessionStorage.setItem(PREFIX + key, JSON.stringify(edited))
		} catch {
			// Sin sitio (una plantilla puede pesar 1 MB) o sin storage: el borrador vive solo en memoria,
			// y se quita la copia vieja para no recuperarla al recargar
			try {
				sessionStorage.removeItem(PREFIX + key)
			} catch {
				// sin storage
			}
		}
	}, [key, edited])

	const set = (v: T) => setEdited(same(v, initial) ? undefined : v)
	const reset = () => setEdited(undefined)
	return [edited === undefined ? initial : edited, set, { dirty: edited !== undefined, reset }] as const
}

// ¿Hay algún borrador guardado bajo esta URL? Para el punto «sin guardar» de las pestañas.
// shortcut: no ve los borradores que solo viven en memoria (sessionStorage lleno); si molesta, un Map compartido
export function hasDraft(prefix: string) {
	try {
		for (let i = 0; i < sessionStorage.length; i++) if (sessionStorage.key(i)?.startsWith(PREFIX + prefix)) return true
	} catch {
		// sin storage
	}
	return false
}
