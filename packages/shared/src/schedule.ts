import { z } from 'zod'

// Programas: acciones recurrentes (o de una vez) sobre un dispositivo o una pantalla.
// La hora es de reloj de pared en la zona del usuario: «19:00 en Europe/Madrid» sigue siendo las 19:00 tras el cambio de hora.

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM')
const YMD = z.iso.date()
export const TimeZone = z.string().refine((tz) => {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz })
		return true
	} catch {
		return false
	}
}, 'Zona horaria IANA no válida')

// Días ISO: 1 = lunes … 7 = domingo
export const ScheduleWhen = z.discriminatedUnion('repeat', [
	z.object({
		repeat: z.literal('weekly'),
		days: z
			.array(z.number().int().min(1).max(7))
			.min(1)
			.max(7)
			.transform((d) => [...new Set(d)].sort()),
		time: HHMM,
		timezone: TimeZone,
	}),
	z.object({ repeat: z.literal('once'), date: YMD, time: HHMM, timezone: TimeZone }),
])
export type ScheduleWhen = z.infer<typeof ScheduleWhen>

export const DEVICE_ACTIONS = ['device.on', 'device.off', 'device.toggle'] as const
// Unión discriminada por `type`: las de pantalla tienen las mismas formas que DisplayCommand (index.ts)
export const ScheduleAction = z.discriminatedUnion('type', [
	z.object({ type: z.literal('device.on') }),
	z.object({ type: z.literal('device.off') }),
	z.object({ type: z.literal('device.toggle') }),
	z.object({ type: z.literal('display.refresh') }),
	z.object({ type: z.literal('display.brightness'), percent: z.number().int().min(0).max(50) }),
])
export type ScheduleAction = z.infer<typeof ScheduleAction>

export const SCHEDULE_RESULTS = ['ok', 'offline', 'missed', 'error'] as const
export type ScheduleResult = (typeof SCHEDULE_RESULTS)[number]

export const Schedule = z.object({
	id: z.uuid(),
	target: z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('device'), id: z.uuid() }),
		// id = hardwareId (md-…), como en las rutas de pantallas
		z.object({ kind: z.literal('display'), id: z.string() }),
	]),
	name: z.string(),
	when: ScheduleWhen,
	action: ScheduleAction,
	enabled: z.boolean(),
	nextRunAt: z.string().nullable(),
	lastRunAt: z.string().nullable(),
	lastResult: z.enum(SCHEDULE_RESULTS).nullable(),
	createdAt: z.string(),
})
export type Schedule = z.infer<typeof Schedule>

const fields = { name: z.string().trim().max(80), when: ScheduleWhen, action: ScheduleAction, enabled: z.boolean() }
export const CreateScheduleInput = z.object({
	...fields,
	name: fields.name.default(''),
	enabled: fields.enabled.default(true),
})
export type CreateScheduleInput = z.infer<typeof CreateScheduleInput>

// Sin defaults: en zod 4 se aplicarían dentro de partial() y un PATCH de solo `enabled` vaciaría el nombre
export const PatchScheduleInput = z
	.object(fields)
	.partial()
	.refine((p) => Object.keys(p).length > 0, 'Nada que cambiar')
export type PatchScheduleInput = z.infer<typeof PatchScheduleInput>

// ---------- Cálculo de la próxima ejecución ----------

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function parts(t: number, tz: string) {
	let f = fmtCache.get(tz)
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone: tz,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
		})
		fmtCache.set(tz, f)
	}
	const p: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {}
	for (const x of f.formatToParts(t)) p[x.type] = x.value
	return {
		y: Number(p.year),
		m: Number(p.month),
		d: Number(p.day),
		h: Number(p.hour),
		min: Number(p.minute),
		s: Number(p.second),
	}
}

// Desfase (local − UTC) en ms de la zona en el instante t
function offset(t: number, tz: string) {
	const p = parts(t, tz)
	return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(t / 1000) * 1000
}

// Reloj de pared → instante. En el hueco del cambio de hora (02:30 que no existe) cae una hora después;
// en la hora repetida, la primera.
export function wallToUtc(y: number, m: number, d: number, h: number, min: number, tz: string) {
	const guess = Date.UTC(y, m - 1, d, h, min)
	// Candidatos con el desfase de antes y de después de un posible cambio de hora
	const early = guess - offset(guess - 6 * 3600e3, tz)
	const late = guess - offset(guess + 6 * 3600e3, tz)
	const ok = (t: number) => offset(t, tz) === guess - t
	if (ok(early)) return ok(late) ? Math.min(early, late) : early
	if (ok(late)) return late
	return early // hueco: con el desfase de antes cae tras el salto (02:30 → 03:30)
}

/** Próxima ejecución estrictamente posterior a `after`, o null si ya no habrá más (una vez, pasada). */
export function nextRun(when: ScheduleWhen, after: Date): Date | null {
	const [h, min] = when.time.split(':').map(Number) as [number, number]
	if (when.repeat === 'once') {
		const [y, m, d] = when.date.split('-').map(Number) as [number, number, number]
		const t = wallToUtc(y, m, d, h, min, when.timezone)
		return t > after.getTime() ? new Date(t) : null
	}
	const today = parts(after.getTime(), when.timezone)
	// 8 días: hoy ya pasado + la semana siguiente completa
	for (let i = 0; i <= 7; i++) {
		const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i))
		const iso = day.getUTCDay() || 7
		if (!when.days.includes(iso)) continue
		const t = wallToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, min, when.timezone)
		if (t > after.getTime()) return new Date(t)
	}
	return null
}
