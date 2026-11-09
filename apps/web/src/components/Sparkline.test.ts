import { expect, test } from 'vitest'
import { sparkPoints } from './Sparkline'

test('sparkPoints: x de 0 a 100 por instante, el mayor arriba y sin dividir entre cero', () => {
	expect(
		sparkPoints([
			[0, 10],
			[50, 20],
			[100, 15],
		]),
	).toEqual([
		[0, 29],
		[50, 3],
		[100, 16],
	])
	// valor constante: a media altura; un solo punto: al final
	expect(
		sparkPoints([
			[0, 5],
			[10, 5],
		]),
	).toEqual([
		[0, 16],
		[100, 16],
	])
	expect(sparkPoints([[7, 1]])).toEqual([[100, 16]])
	expect(sparkPoints([])).toEqual([])
})
