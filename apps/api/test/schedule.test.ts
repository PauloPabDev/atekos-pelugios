import { describe, expect, it } from 'vitest'
import { CreateScheduleInput, nextRun, ScheduleWhen } from '@atekos/shared'

const weekly = (days: number[], time: string, timezone = 'Europe/Madrid') =>
	ScheduleWhen.parse({ repeat: 'weekly', days, time, timezone })
const iso = (d: Date | null) => d?.toISOString() ?? null

describe('nextRun', () => {
	it('laborables a las 19:00: un viernes por la noche salta al lunes', () => {
		const w = weekly([1, 2, 3, 4, 5], '19:00')
		expect(iso(nextRun(w, new Date('2026-11-13T19:00:00Z')))).toBe('2026-11-16T18:00:00.000Z')
	})

	it('el mismo día si la hora aún no ha pasado, y nunca la hora exacta de `after`', () => {
		const w = weekly([5], '19:00')
		expect(iso(nextRun(w, new Date('2026-11-13T10:00:00Z')))).toBe('2026-11-13T18:00:00.000Z')
		expect(iso(nextRun(w, new Date('2026-11-13T18:00:00Z')))).toBe('2026-11-20T18:00:00.000Z')
	})

	it('zona sin cambio de hora (Bogotá, UTC−5)', () => {
		const w = weekly([1, 2, 3, 4, 5, 6, 7], '07:00', 'America/Bogota')
		expect(iso(nextRun(w, new Date('2026-11-09T00:00:00Z')))).toBe('2026-11-09T12:00:00.000Z')
	})

	it('la hora de pared se mantiene a ambos lados del cambio de hora', () => {
		const w = weekly([7], '20:00')
		expect(iso(nextRun(w, new Date('2026-03-22T12:00:00Z')))).toBe('2026-03-22T19:00:00.000Z') // CET
		expect(iso(nextRun(w, new Date('2026-03-29T12:00:00Z')))).toBe('2026-03-29T18:00:00.000Z') // CEST
	})

	it('hora inexistente (hueco de primavera) cae tras el salto; la repetida, en la primera', () => {
		expect(iso(nextRun(weekly([7], '02:30'), new Date('2026-03-28T12:00:00Z')))).toBe('2026-03-29T01:30:00.000Z')
		expect(iso(nextRun(weekly([7], '02:30'), new Date('2026-10-24T12:00:00Z')))).toBe('2026-10-25T00:30:00.000Z')
	})

	it('una vez: la fecha si es futura, null si ya pasó', () => {
		const once = ScheduleWhen.parse({ repeat: 'once', date: '2026-12-24', time: '21:30', timezone: 'Europe/Madrid' })
		expect(iso(nextRun(once, new Date('2026-12-01T00:00:00Z')))).toBe('2026-12-24T20:30:00.000Z')
		expect(nextRun(once, new Date('2026-12-25T00:00:00Z'))).toBeNull()
	})
})

describe('esquemas de programas', () => {
	it('los días se deduplican y ordenan', () => {
		expect(weekly([5, 1, 5, 3], '08:00')).toMatchObject({ days: [1, 3, 5] })
	})

	it('rechaza zona horaria, hora y días no válidos', () => {
		const base = { repeat: 'weekly', days: [1], time: '08:00', timezone: 'Europe/Madrid' }
		expect(ScheduleWhen.safeParse({ ...base, timezone: 'Marte/Olympus' }).success).toBe(false)
		expect(ScheduleWhen.safeParse({ ...base, time: '24:00' }).success).toBe(false)
		expect(ScheduleWhen.safeParse({ ...base, days: [] }).success).toBe(false)
		expect(ScheduleWhen.safeParse({ ...base, days: [0] }).success).toBe(false)
	})

	it('la acción de pantalla respeta el tope de brillo del contrato', () => {
		const when = { repeat: 'weekly', days: [1], time: '23:00', timezone: 'Europe/Madrid' }
		expect(CreateScheduleInput.safeParse({ when, action: { type: 'display.brightness', percent: 10 } }).success).toBe(
			true,
		)
		expect(CreateScheduleInput.safeParse({ when, action: { type: 'display.brightness', percent: 80 } }).success).toBe(
			false,
		)
	})
})
