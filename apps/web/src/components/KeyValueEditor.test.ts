import { expect, test } from 'vitest'
import {
	draftFromJson,
	EMPTY_DRAFT,
	EMPTY_KEY,
	enc,
	kvChanges,
	kvMerged,
	parseValue,
	type KvDraft,
} from './KeyValueEditor'

test('parseValue: coma decimal, Sí/No y JSON con su error', () => {
	expect(parseValue(' 21,5 ', 'number')).toEqual({ ok: true, value: 21.5 })
	expect(parseValue('', 'number')).toEqual({ ok: false, error: 'No es un número.' })
	expect(parseValue('abc', 'number')).toEqual({ ok: false, error: 'No es un número.' })
	expect(parseValue('true', 'bool')).toEqual({ ok: true, value: true })
	expect(parseValue('80', 'text')).toEqual({ ok: true, value: '80' })
	expect(parseValue('{"a":[1]}', 'json')).toEqual({ ok: true, value: { a: [1] } })
	const bad = parseValue('{a', 'json')
	expect(!bad.ok && bad.error).toMatch(/^JSON no válido: .+\.$/)
})

test('kvChanges: el PATCH lleva solo lo que difiere del servidor; quitar es un DELETE', () => {
	const data = { brillo: 80, modo: 'día', viejo: 1 }
	const draft: KvDraft = {
		edits: {
			brillo: { type: 'number', text: '90', base: '80' },
			// editado pero igual que el servidor: no se envía
			modo: { type: 'text', text: 'día', base: '"día"' },
		},
		removed: ['viejo'],
		added: [{ id: 'n1', key: ' color ', type: 'text', text: 'ámbar' }],
	}
	const c = kvChanges(data, draft)
	expect(c.patch).toEqual({ brillo: 90, color: 'ámbar' })
	expect(c.remove).toEqual(['viejo'])
	expect(c.count).toBe(3)
	expect(c.errors).toEqual({})
	expect(c.conflicts).toEqual([])
})

test('kvChanges: claves vacías o repetidas, valores mal escritos y cambios del dispositivo mientras editas', () => {
	const data = { brillo: 85, modo: 'día' }
	const c = kvChanges(data, {
		edits: { brillo: { type: 'number', text: '90', base: '80' }, modo: { type: 'number', text: 'x', base: '"día"' } },
		removed: [],
		added: [
			{ id: 'a', key: '', type: 'text', text: '' },
			{ id: 'b', key: 'modo', type: 'text', text: '' },
		],
	})
	expect(c.errors).toEqual({
		modo: { on: 'value', text: 'No es un número.' },
		a: { on: 'key', text: EMPTY_KEY },
		b: { on: 'key', text: 'Ya existe un dato «modo».' },
	})
	// brillo pasó de 80 a 85 en el dispositivo mientras lo cambiabas a 90
	expect(c.conflicts).toEqual([{ key: 'brillo', value: 85, gone: false }])
	// quitar y volver a añadir es reemplazar: sin DELETE
	const r = kvChanges(data, {
		edits: {},
		removed: ['modo'],
		added: [{ id: 'c', key: 'modo', type: 'bool', text: 'true' }],
	})
	expect([r.patch, r.remove]).toEqual([{ modo: true }, []])
})

test('modo JSON: solo cuenta lo que difiere de lo que había al abrirlo', () => {
	const snapshot = { brillo: 80, modo: 'día', viejo: 1 }
	const draft = draftFromJson({ brillo: 80, modo: 'noche', nuevo: [1] }, snapshot, EMPTY_DRAFT)
	expect(draft).toEqual({
		edits: { modo: { type: 'text', text: 'noche', base: enc('día') } },
		removed: ['viejo'],
		added: [{ id: 'json:nuevo', key: 'nuevo', type: 'json', text: '[1]' }],
	})
	// el dispositivo cambió brillo después de abrir el JSON: como no lo tocaste, no se envía
	expect(kvChanges({ ...snapshot, brillo: 85 }, draft).patch).toEqual({ modo: 'noche', nuevo: [1] })
	expect(kvMerged(snapshot, draft)).toEqual({ brillo: 80, modo: 'noche', nuevo: [1] })
})
