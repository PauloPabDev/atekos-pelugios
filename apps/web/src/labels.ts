import type { IconName } from './components/Icon'

// Etiquetas en español de los valores crudos de la API
export const DEVICE_TYPE: Record<string, string> = {
	light: 'Luz',
	switch: 'Interruptor',
	sensor: 'Sensor',
	generic: 'Genérico',
}

export const DEVICE_ICON: Record<string, IconName> = {
	light: 'bulb',
	switch: 'toggle',
	sensor: 'sensor',
	generic: 'cube',
}

export const EVENT: Record<string, string> = {
	'device.created': 'Creado',
	'device.updated': 'Ajustes cambiados',
	'state.changed': 'Cambio de estado',
	'data.changed': 'Datos cambiados',
	'device.deleted': 'Borrado',
}

export const ACTOR: Record<string, string> = { anonymous: 'Anónimo', user: 'Tú', token: 'Token' }

// http no es solo la web: también los tokens (un ESP por REST), así que no vale «App»
export const SOURCE: Record<string, string> = { http: 'Petición web', ws: 'Conexión en vivo', schedule: 'Programa' }

// El crudo como respaldo: la API puede traer un valor que la web aún no conoce
export const label = (map: Record<string, string>, raw: string) => map[raw] ?? raw

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 31_536_000],
	['month', 2_592_000],
	['week', 604_800],
	['day', 86_400],
	['hour', 3_600],
	['minute', 60],
]

// «hace 5 minutos», «ayer»…; por debajo del minuto, «ahora» (nadie repinta cada segundo)
export function ago(ts: string, now = Date.now()) {
	const s = (Date.parse(ts) - now) / 1000
	const step = STEPS.find(([, size]) => Math.abs(s) >= size)
	// trunc y no round: 59,6 min es «hace 59 minutos», no «hace 60 minutos»
	return step ? rtf.format(Math.trunc(s / step[1]), step[0]) : 'ahora'
}

export const fullDate = (ts: string) => new Date(ts).toLocaleString('es')

const weekday = new Intl.DateTimeFormat('es', { weekday: 'long' })
const month = new Intl.DateTimeFormat('es', { month: 'long' })
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

// Día local: «Hoy», «Ayer», «lunes 9 de noviembre» (y el año si no es el actual)
export function dayLabel(d: Date, now = new Date()) {
	const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
	if (dayKey(d) === dayKey(now)) return 'Hoy'
	if (dayKey(d) === dayKey(yesterday)) return 'Ayer'
	const year = d.getFullYear() === now.getFullYear() ? '' : ` de ${d.getFullYear()}`
	return `${weekday.format(d)} ${d.getDate()} de ${month.format(d)}${year}`
}

// Agrupa por día local respetando el orden de entrada (la API ya los da del más reciente al más antiguo)
export function groupByDay<T>(items: readonly T[], getDate: (item: T) => string | Date, now = new Date()) {
	const groups: { day: string; label: string; items: T[] }[] = []
	for (const item of items) {
		const d = new Date(getDate(item))
		const day = dayKey(d)
		const last = groups.at(-1)
		if (last?.day === day) last.items.push(item)
		else groups.push({ day, label: dayLabel(d, now), items: [item] })
	}
	return groups
}
