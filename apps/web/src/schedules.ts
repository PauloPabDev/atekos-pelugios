import { nextRun, type Schedule, type ScheduleAction, type ScheduleResult, type ScheduleWhen } from '@atekos/shared'

// Frases y cálculos de los programas (§6.4–6.7). Días ISO: 1 = lunes … 7 = domingo.

export const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
export const DAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
export const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]
export const WORKDAYS = [1, 2, 3, 4, 5]
export const WEEKEND = [6, 7]

export type ScheduleTarget = Schedule['target']
type Describable = { when: ScheduleWhen; action: ScheduleAction }

export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
export const targetBase = (t: ScheduleTarget) => `/${t.kind === 'device' ? 'devices' : 'displays'}/${t.id}/programas`
// «Europe/Madrid» → «Madrid», «America/Argentina/Buenos_Aires» → «Buenos Aires»
export const zoneCity = (tz: string) => (tz.split('/').at(-1) ?? tz).replaceAll('_', ' ')

const sorted = (days: readonly number[]) => [...new Set(days)].sort((a, b) => a - b)
export const sameDays = (a: readonly number[], b: readonly number[]) => sorted(a).join() === sorted(b).join()
const isoDay = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay() || 7
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

// Fecha y hora de pared de un instante en una zona: { date: '2026-11-09', time: '19:00' }
export function wall(t: Date, tz: string) {
	const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
	const f = new Intl.DateTimeFormat('en-US', {
		timeZone: tz,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	})
	for (const x of f.formatToParts(t)) p[x.type] = x.value
	return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

export function daysPhrase(days: readonly number[]) {
	const d = sorted(days)
	if (d.length === 0) return 'Ningún día'
	if (d.length === 7) return 'Todos los días'
	if (sameDays(d, WEEKEND)) return 'Los fines de semana'
	if (d.length === 1) return `Cada ${DAYS[d[0]! - 1]}`
	if (d.length >= 3 && d.at(-1)! - d[0]! === d.length - 1) return `De ${DAYS[d[0]! - 1]} a ${DAYS[d.at(-1)! - 1]}`
	const names = d.map((x) => DAYS[x - 1]!)
	return cap(`${names.slice(0, -1).join(', ')} y ${names.at(-1)}`)
}

// 24 h y sin cero delante: «a las 19:00», «a la 1:30», «a las 0:15»
export function atTime(time: string) {
	if (!time) return 'a las --:--'
	const [h, m] = time.split(':')
	const hour = Number(h)
	return `${hour === 1 ? 'a la' : 'a las'} ${hour}:${m}`
}

const MONTH = new Intl.DateTimeFormat('es', { month: 'long', timeZone: 'UTC' })
const MONTH_SHORT = new Intl.DateTimeFormat('es', { month: 'short', timeZone: 'UTC' })

// Día de un «una vez», visto desde hoy en su zona: «Hoy», «Mañana» o «El martes 24 de noviembre»
export function onceDay(date: string, tz: string, now = new Date()) {
	if (!date) return 'Sin fecha'
	const today = wall(now, tz).date
	const diff = dayDiff(today, date)
	if (diff === 0) return 'Hoy'
	if (diff === 1) return 'Mañana'
	const d = new Date(`${date}T00:00:00Z`)
	const year = date.slice(0, 4) === today.slice(0, 4) ? '' : ` de ${d.getUTCFullYear()}`
	return `El ${DAYS[isoDay(date) - 1]} ${d.getUTCDate()} de ${MONTH.format(d)}${year}`
}

export const whenPhrase = (w: ScheduleWhen, now = new Date()) =>
	`${w.repeat === 'weekly' ? daysPhrase(w.days) : onceDay(w.date, w.timezone, now)} ${atTime(w.time)}`

// Los sensores no tienen «encendido»: su estado es «Activo»
export function actionLabel(a: ScheduleAction, deviceType?: string) {
	const sensor = deviceType === 'sensor'
	switch (a.type) {
		case 'device.on':
			return sensor ? 'Activar' : 'Encender'
		case 'device.off':
			return sensor ? 'Desactivar' : 'Apagar'
		case 'device.toggle':
			return 'Alternar'
		case 'display.refresh':
			return 'Refrescar'
		case 'display.brightness':
			return `Brillo al ${a.percent} %`
	}
}

/** «De lunes a viernes a las 19:00 → Encender» */
export const describeSchedule = (s: Describable, deviceType?: string, now = new Date()) =>
	`${whenPhrase(s.when, now)} → ${actionLabel(s.action, deviceType)}`

/** «hoy a las 19:00», «mañana a las 7:00», «el viernes a las 19:00», «el 24 nov a las 7:00» (+ zona si no es la tuya) */
export function nextRunLabel(at: string | Date, tz: string, now = new Date(), localZone = browserZone()) {
	const t = wall(new Date(at), tz)
	const diff = dayDiff(wall(now, tz).date, t.date)
	const d = new Date(`${t.date}T00:00:00Z`)
	const day =
		diff === 0
			? 'hoy'
			: diff === 1
				? 'mañana'
				: diff > 1 && diff < 7
					? `el ${DAYS[isoDay(t.date) - 1]}`
					: `el ${d.getUTCDate()} ${MONTH_SHORT.format(d).replace('.', '')}`
	return `${day} ${atTime(t.time)}${tz === localZone ? '' : ` (hora de ${zoneCity(tz)})`}`
}

export const RESULT: Record<ScheduleResult, string> = {
	ok: 'Hecho',
	offline: 'Pantalla sin conexión',
	missed: 'No se ejecutó: la app estaba parada',
	error: 'Falló: error interno',
}

// Fecha por defecto de un «una vez»: hoy si la hora aún no ha pasado; si no, mañana
export function defaultDate(time: string, tz: string, now = new Date()) {
	const today = wall(now, tz).date
	if (time && nextRun({ repeat: 'once', date: today, time, timezone: tz }, now)) return today
	return new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10)
}

// Acciones que se contradicen en el mismo minuto: encender y apagar, o dos brillos distintos
function opposite(a: ScheduleAction, b: ScheduleAction) {
	if (a.type === 'display.brightness' && b.type === 'display.brightness') return a.percent !== b.percent
	return (a.type === 'device.on' && b.type === 'device.off') || (a.type === 'device.off' && b.type === 'device.on')
}

function shareDay(a: ScheduleWhen, b: ScheduleWhen) {
	if (a.repeat === 'once' && b.repeat === 'once') return a.date === b.date
	const days = (w: ScheduleWhen) => (w.repeat === 'weekly' ? w.days : [isoDay(w.date)])
	return days(a).some((d) => days(b).includes(d))
}

type Clashable = Describable & { id?: string; enabled: boolean }
/** Programas activos del mismo destino que chocan con `s`: mismo minuto, algún día en común y acción contraria. */
// shortcut: compara la hora de pared sin mirar la zona (casi siempre es la misma); si se mezclan zonas, comparar instantes
export const clashes = <T extends Clashable>(s: Clashable, others: readonly T[]) =>
	!s.enabled
		? []
		: others.filter(
				(o) =>
					o.id !== s.id &&
					o.enabled &&
					o.when.time === s.when.time &&
					opposite(s.action, o.action) &&
					shareDay(s.when, o.when),
			)

export const AGENDA = ['Hoy', 'Mañana', 'Esta semana'] as const
const localDay = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()

/** Ejecuciones de los programas activos de hoy a 7 días, en orden y agrupadas en Hoy, Mañana y Esta semana. */
export function agenda<T extends Pick<Schedule, 'when' | 'enabled'>>(list: readonly T[], now = new Date()) {
	const end = new Date(localDay(now))
	end.setDate(end.getDate() + 7)
	const runs: { at: Date; schedule: T }[] = []
	for (const s of list) {
		if (!s.enabled) continue
		for (let t = nextRun(s.when, now); t && t < end; t = nextRun(s.when, t)) runs.push({ at: t, schedule: s })
	}
	runs.sort((a, b) => a.at.getTime() - b.at.getTime())
	// round: los días del cambio de hora duran 23 o 25 h
	const bucket = (t: Date) => AGENDA[Math.min(2, Math.round((localDay(t) - localDay(now)) / 86_400_000))]!
	return AGENDA.map((label) => ({ label, items: runs.filter((r) => bucket(r.at) === label) }))
}

type Suggestion = { title: string; days: number[]; time: string; action: ScheduleAction }
// A hora fija: sin ubicación no hay hora solar, así que «al anochecer» es las 19:00 y la frase lo dice
export const SUGGESTIONS: Record<ScheduleTarget['kind'], Suggestion[]> = {
	device: [
		{ title: 'Encender al anochecer', days: EVERY_DAY, time: '19:00', action: { type: 'device.on' } },
		{ title: 'Apagar a medianoche', days: EVERY_DAY, time: '00:00', action: { type: 'device.off' } },
		{ title: 'Despertar', days: WORKDAYS, time: '07:00', action: { type: 'device.on' } },
	],
	display: [
		{
			title: 'Bajar el brillo por la noche',
			days: EVERY_DAY,
			time: '22:00',
			action: { type: 'display.brightness', percent: 5 },
		},
		{
			title: 'Subir el brillo por la mañana',
			days: EVERY_DAY,
			time: '07:30',
			action: { type: 'display.brightness', percent: 40 },
		},
		{ title: 'Refrescar cada mañana', days: EVERY_DAY, time: '06:00', action: { type: 'display.refresh' } },
	],
}
