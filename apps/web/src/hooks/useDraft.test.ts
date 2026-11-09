import { act, renderHook } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { hasDraft, useDraft } from './useDraft'

const key = '/devices/1/datos'

test('el borrador sobrevive a desmontar, marca dirty y reset lo descarta', () => {
	const first = renderHook(() => useDraft(key, 'a'))
	expect(first.result.current[0]).toBe('a')
	expect(first.result.current[2].dirty).toBe(false)

	act(() => first.result.current[1]('b'))
	expect(first.result.current[0]).toBe('b')
	expect(first.result.current[2].dirty).toBe(true)
	expect(hasDraft('/devices/1/datos')).toBe(true)
	expect(hasDraft('/devices/1/ajustes')).toBe(false)
	first.unmount()

	// como al volver a la pestaña
	const again = renderHook(() => useDraft(key, 'a'))
	expect(again.result.current[0]).toBe('b')
	act(() => again.result.current[2].reset())
	expect(again.result.current[0]).toBe('a')
	expect(hasDraft('/devices/1')).toBe(false)
})

test('sin cambios sigue al valor inicial; volver al inicial deja de ser borrador', () => {
	const { result, rerender } = renderHook(({ initial }) => useDraft(key, initial), {
		initialProps: { initial: { brillo: 40 } },
	})
	rerender({ initial: { brillo: 80 } }) // llegó en vivo
	expect(result.current[0]).toEqual({ brillo: 80 })

	act(() => result.current[1]({ brillo: 10 }))
	rerender({ initial: { brillo: 90 } }) // con cambios, se queda el tuyo
	expect(result.current[0]).toEqual({ brillo: 10 })

	act(() => result.current[1]({ brillo: 90 }))
	expect(result.current[2].dirty).toBe(false)
})

test('si sessionStorage no tiene sitio, el borrador sigue en memoria', () => {
	vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
		throw new DOMException('lleno', 'QuotaExceededError')
	})
	const { result } = renderHook(() => useDraft(key, ''))
	act(() => result.current[1]('x'.repeat(1000)))
	expect(result.current[0]).toHaveLength(1000)
	expect(result.current[2].dirty).toBe(true)
	vi.restoreAllMocks()
})
