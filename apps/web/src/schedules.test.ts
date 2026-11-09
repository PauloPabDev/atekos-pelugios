import { expect, test } from 'vitest'
import type { ScheduleAction, ScheduleWhen } from '@atekos/shared'
import {
	actionLabel,
	agenda,
	atTime,
	browserZone,
	clashes,
	daysPhrase,
	defaultDate,
	describeSchedule,
	nextRunLabel,
	RESULT,
} from './schedules'

const tz = 'Europe/Madrid'
// lunes 9 de noviembre de 2026, 13:00 en Madrid
const now = new Date('2026-11-09T12:00:00Z')
const weekly = (days: number[], time = '19:00'): ScheduleWhen => ({ repeat: 'weekly', days, time, timezone: tz })
const once = (date: string, time = '19:00'): ScheduleWhen => ({ repeat: 'once', date, time, timezone: tz })
const on: ScheduleAction = { type: 'device.on' }
const off: ScheduleAction = { type: 'device.off' }

test('daysPhrase: los casos con nombre, los consecutivos y las listas', () => {
	expect(daysPhrase([1, 2, 3, 4, 5, 6, 7])).toBe('Todos los días')
	expect(daysPhrase([5, 4, 3, 2, 1])).toBe('De lunes a viernes')
	expect(daysPhrase([6, 7])).toBe('Los fines de semana')
	expect(daysPhrase([3])).toBe('Cada miércoles')
	expect(daysPhrase([1, 2, 3, 4])).toBe('De lunes a jueves')
	expect(daysPhrase([2, 3])).toBe('Martes y miércoles')
	expect(daysPhrase([1, 3, 5])).toBe('Lunes, miércoles y viernes')
	expect(daysPhrase([])).toBe('Ningún día')
})

test('atTime: 24 h, sin cero delante y «a la» con la 1', () => {
	expect(atTime('19:00')).toBe('a las 19:00')
	expect(atTime('07:05')).toBe('a las 7:05')
	expect(atTime('01:30')).toBe('a la 1:30')
	expect(atTime('00:15')).toBe('a las 0:15')
})

test('describeSchedule: semanal, una vez (hoy, mañana, otra fecha, otro año) y acciones', () => {
	expect(describeSchedule({ when: weekly([1, 2, 3, 4, 5]), action: on })).toBe(
		'De lunes a viernes a las 19:00 → Encender',
	)
	expect(describeSchedule({ when: weekly([6, 7], '23:30'), action: off })).toBe(
		'Los fines de semana a las 23:30 → Apagar',
	)
	expect(describeSchedule({ when: once('2026-11-09'), action: off }, undefined, now)).toBe('Hoy a las 19:00 → Apagar')
	expect(describeSchedule({ when: once('2026-11-10', '01:00'), action: on }, undefined, now)).toBe(
		'Mañana a la 1:00 → Encender',
	)
	expect(
		describeSchedule({ when: once('2026-12-24'), action: { type: 'display.brightness', percent: 10 } }, undefined, now),
	).toBe('El jueves 24 de diciembre a las 19:00 → Brillo al 10 %')
	expect(describeSchedule({ when: once('2027-01-05'), action: { type: 'display.refresh' } }, undefined, now)).toBe(
		'El martes 5 de enero de 2027 a las 19:00 → Refrescar',
	)
})

test('actionLabel según el tipo de dispositivo', () => {
	expect(actionLabel(on, 'light')).toBe('Encender')
	expect(actionLabel(on, 'sensor')).toBe('Activar')
	expect(actionLabel(off, 'sensor')).toBe('Desactivar')
	expect(actionLabel({ type: 'device.toggle' })).toBe('Alternar')
})

test('nextRunLabel: hoy, mañana, la semana, más lejos y otra zona', () => {
	expect(nextRunLabel('2026-11-09T18:00:00Z', tz, now, tz)).toBe('hoy a las 19:00')
	expect(nextRunLabel('2026-11-10T06:00:00Z', tz, now, tz)).toBe('mañana a las 7:00')
	expect(nextRunLabel('2026-11-13T18:00:00Z', tz, now, tz)).toBe('el viernes a las 19:00')
	expect(nextRunLabel('2026-11-24T06:00:00Z', tz, now, tz)).toBe('el 24 nov a las 7:00')
	// 23:00 en Madrid: las 0:30 ya son mañana allí aunque en Bogotá sea el mismo día
	expect(nextRunLabel('2026-11-09T23:30:00Z', tz, new Date('2026-11-09T22:00:00Z'), 'America/Bogota')).toBe(
		'mañana a las 0:30 (hora de Madrid)',
	)
})

test('RESULT explica cada resultado', () => {
	expect(RESULT.ok).toBe('Hecho')
	expect(RESULT.offline).toBe('Pantalla sin conexión')
	expect(RESULT.missed).toBe('No se ejecutó: la app estaba parada')
})

test('defaultDate: hoy si la hora aún no pasó; si no, mañana', () => {
	expect(defaultDate('19:00', tz, now)).toBe('2026-11-09')
	expect(defaultDate('08:00', tz, now)).toBe('2026-11-10')
})

test('clashes: mismo minuto, algún día en común y acción contraria; los pausados no cuentan', () => {
	const s = { id: 'a', enabled: true, when: weekly([1, 2, 3, 4, 5]), action: on }
	const others = [
		{ id: 'b', enabled: true, when: weekly([5, 6]), action: off },
		{ id: 'c', enabled: true, when: weekly([6, 7]), action: off },
		{ id: 'd', enabled: false, when: weekly([1]), action: off },
		{ id: 'e', enabled: true, when: weekly([1], '19:01'), action: off },
		{ id: 'f', enabled: true, when: weekly([1]), action: { type: 'device.toggle' } as ScheduleAction },
		{ id: 'g', enabled: true, when: once('2026-11-10'), action: off }, // martes
	]
	expect(clashes(s, others).map((o) => o.id)).toEqual(['b', 'g'])
	expect(clashes({ ...s, enabled: false }, others)).toEqual([])
	const bright = (percent: number) => ({ type: 'display.brightness', percent }) as const
	expect(
		clashes({ enabled: true, when: weekly([1]), action: bright(5) }, [
			{ id: 'x', enabled: true, when: weekly([1]), action: bright(40) },
			{ id: 'y', enabled: true, when: weekly([1]), action: bright(5) },
		]).map((o) => o.id),
	).toEqual(['x'])
})

test('agenda: hoy, mañana y el resto de la semana, en orden y sin los pausados', () => {
	const local = browserZone()
	const monday = new Date(2026, 10, 9, 12, 0)
	const tomorrow = `${monday.getFullYear()}-11-10`
	const list = [
		{ id: 'diario', enabled: true, when: { ...weekly([1, 2, 3, 4, 5, 6, 7]), timezone: local } },
		{ id: 'una', enabled: true, when: { ...once(tomorrow, '08:00'), timezone: local } },
		{ id: 'pausado', enabled: false, when: { ...weekly([1, 2]), timezone: local } },
	]
	const [hoy, manana, semana] = agenda(list, monday)
	expect(hoy!.items.map((r) => r.schedule.id)).toEqual(['diario'])
	expect(manana!.items.map((r) => r.schedule.id)).toEqual(['una', 'diario'])
	expect(semana!.label).toBe('Esta semana')
	expect(semana!.items).toHaveLength(5)
})
