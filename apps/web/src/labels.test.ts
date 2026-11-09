import { expect, test } from 'vitest'
import { ago, DEVICE_TYPE, groupByDay, label } from './labels'

test('ago: tiempo relativo en español', () => {
	const now = Date.parse('2026-01-01T12:00:00Z')
	expect(ago('2026-01-01T11:59:30Z', now)).toBe('ahora')
	expect(ago('2026-01-01T11:55:00Z', now)).toBe('hace 5 minutos')
	expect(ago('2026-01-01T11:00:01Z', now)).toBe('hace 59 minutos')
	expect(ago('2025-12-31T12:00:00Z', now)).toBe('ayer')
})

test('label: valor desconocido cae al crudo', () => {
	expect(label(DEVICE_TYPE, 'light')).toBe('Luz')
	expect(label(DEVICE_TYPE, 'robot')).toBe('robot')
})

test('groupByDay: Hoy, Ayer y luego el día con su nombre, en el orden de entrada', () => {
	// Fechas locales: el test no depende de la zona horaria de la máquina
	const now = new Date(2026, 10, 9, 12, 0) // lunes 9 de noviembre de 2026
	const items = [
		new Date(2026, 10, 9, 11, 0),
		new Date(2026, 10, 9, 0, 5),
		new Date(2026, 10, 8, 23, 59),
		new Date(2026, 10, 5, 19, 0),
		new Date(2025, 11, 31, 10, 0),
	].map((d) => ({ ts: d.toISOString() }))

	const groups = groupByDay(items, (i) => i.ts, now)
	expect(groups.map((g) => [g.label, g.items.length])).toEqual([
		['Hoy', 2],
		['Ayer', 1],
		['jueves 5 de noviembre', 1],
		['miércoles 31 de diciembre de 2025', 1],
	])
	expect(groupByDay([], (i: { ts: string }) => i.ts, now)).toEqual([])
})
