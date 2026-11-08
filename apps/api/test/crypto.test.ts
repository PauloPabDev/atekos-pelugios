import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashPassword, makeCipher, makeTokenHasher, verifyPassword } from '../src/shared/crypto'

describe('makeCipher', () => {
	const cipher = makeCipher(randomBytes(32).toString('base64'))

	it('cifra y descifra', () => {
		const box = cipher.encrypt('clave de la integración ñ')
		expect(box).not.toContain('clave')
		expect(cipher.decrypt(box)).toBe('clave de la integración ñ')
	})

	// La caja es iv.tag.datos: cambiar un bit de cualquier parte rompe la autenticación de GCM.
	it.each([
		['el iv', 0],
		['el tag', 1],
		['el texto cifrado', 2],
	])('falla si se altera %s', (_name, i) => {
		const parts = cipher.encrypt('secreto').split('.')
		const buf = Buffer.from(parts[i]!, 'base64url')
		buf[0] = buf[0]! ^ 1
		parts[i] = buf.toString('base64url')
		expect(() => cipher.decrypt(parts.join('.'))).toThrow()
	})
})

describe('makeTokenHasher', () => {
	const pepper = 'p'.repeat(32)

	it('es determinista con el mismo pepper y distinto con otro', () => {
		expect(makeTokenHasher(pepper).hash('dmt_x')).toBe(makeTokenHasher(pepper).hash('dmt_x'))
		expect(makeTokenHasher('q'.repeat(32)).hash('dmt_x')).not.toBe(makeTokenHasher(pepper).hash('dmt_x'))
	})

	it('create() da dmt_ + 43 caracteres, prefijo de 10 y un hash distinto del texto en claro', () => {
		const h = makeTokenHasher(pepper)
		const { plain, prefix, hash } = h.create()
		expect(plain).toMatch(/^dmt_[\w-]{43}$/)
		expect(prefix).toBe(plain.slice(0, 10))
		expect(prefix).toHaveLength(10)
		expect(hash).not.toBe(plain)
		expect(hash).toBe(h.hash(plain))
	})
})

it('las contraseñas se guardan con argon2id', async () => {
	const hash = await hashPassword('clave-larga-123')
	expect(hash).toMatch(/^\$argon2id\$/)
	expect(await verifyPassword(hash, 'clave-larga-123')).toBe(true)
	expect(await verifyPassword(hash, 'otra-clave-123')).toBe(false)
})
