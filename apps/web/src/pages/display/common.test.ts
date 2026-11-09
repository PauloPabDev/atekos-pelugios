import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import { kindOf, nextVersion, parseField, toField, useArrived } from './common'

test('nextVersion: nueva, la del borrador; existente, la siguiente a la guardada salvo que el borrador ya sea mayor', () => {
	expect(nextVersion(1, undefined)).toBe(1)
	expect(nextVersion(1, 3)).toBe(4)
	expect(nextVersion(3, 3)).toBe(4)
	expect(nextVersion(9, 3)).toBe(9)
})

test('el tipo de una variable sale de su valor guardado; sin valor o null, texto', () => {
	expect(kindOf(21.5)).toBe('number')
	expect(kindOf(false)).toBe('bool')
	expect(kindOf('hola')).toBe('text')
	expect(kindOf(null)).toBe('text')
	expect(kindOf(undefined)).toBe('text')
	expect([toField(21.5), toField(true), toField(null), toField(undefined)]).toEqual(['21.5', true, '', ''])
})

test('parseField convierte lo tecleado y explica lo que no vale', () => {
	expect(parseField('number', '21,5')).toEqual({ value: 21.5 })
	expect(parseField('number', ' -3 ')).toEqual({ value: -3 })
	expect(parseField('number', '')).toEqual({ error: 'No es un número.' })
	expect(parseField('number', '12a')).toEqual({ error: 'No es un número.' })
	expect(parseField('text', '')).toEqual({ value: '' })
	expect(parseField('bool', true)).toEqual({ value: true })
})

test('useArrived: lo que ya estaba al cargar no destella; lo que llega después, sí', () => {
	const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 10, m)).toISOString()
	const hook = renderHook(({ newest, loaded }) => useArrived(newest, loaded), {
		initialProps: { newest: undefined as string | undefined, loaded: false },
	})
	expect(hook.result.current(t(1))).toBe(false)
	hook.rerender({ newest: t(1), loaded: true })
	expect(hook.result.current(t(1))).toBe(false)
	hook.rerender({ newest: t(2), loaded: true })
	expect(hook.result.current(t(2))).toBe(true)

	// Una lista vacía al cargar: todo lo que llegue es nuevo
	const empty = renderHook(() => useArrived(undefined, true))
	expect(empty.result.current(t(0))).toBe(true)
})
