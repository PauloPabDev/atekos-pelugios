import { expect, test } from 'vitest'
import { ago, DEVICE_TYPE, label } from './labels'

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
