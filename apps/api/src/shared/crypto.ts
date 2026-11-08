import { randomBytes, createHmac, createCipheriv, createDecipheriv } from 'node:crypto'
export { hash as hashPassword, verify as verifyPassword } from '@node-rs/argon2' // argon2id por defecto

// Tokens: tienen mucha entropía, así que basta un HMAC rápido. El pepper vive solo en el env:
// si alguien roba la BD, no puede verificar tokens sin él.
export const makeTokenHasher = (pepper: string) => ({
	hash: (plain: string) => createHmac('sha256', pepper).update(plain).digest('hex'),
	create() {
		const plain = `dmt_${randomBytes(32).toString('base64url')}`
		return { plain, prefix: plain.slice(0, 10), hash: this.hash(plain) }
	},
})
export type TokenHasher = ReturnType<typeof makeTokenHasher>

// Secretos que el sistema necesita volver a leer (p. ej. la clave de una integración externa).
// En la fase de domótica no hay ninguno; el día que aparezca, va en una columna `<algo>_enc` usando esto.
export const makeCipher = (keyB64: string) => {
	const key = Buffer.from(keyB64, 'base64') // 32 bytes: openssl rand -base64 32
	return {
		encrypt(plain: string) {
			const iv = randomBytes(12)
			const c = createCipheriv('aes-256-gcm', key, iv)
			const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
			return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.')
		},
		decrypt(box: string) {
			const [iv, tag, data] = box.split('.').map((s) => Buffer.from(s, 'base64url'))
			const d = createDecipheriv('aes-256-gcm', key, iv!)
			d.setAuthTag(tag!)
			return Buffer.concat([d.update(data!), d.final()]).toString('utf8')
		},
	}
}
