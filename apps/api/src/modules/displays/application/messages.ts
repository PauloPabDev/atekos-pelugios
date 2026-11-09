import { randomUUID } from 'node:crypto'
import { DISPLAY_MAX_FRAME, type DisplayServerMessage, type DisplayTemplate, type DisplayValues } from '@atekos/shared'
import { AppError } from '../../../shared/errors'
import type { DisplayOutbox } from '../domain/ports'

// Lo que necesita el dispositivo para dibujar la pantalla entera: la plantilla y todos sus valores (CONTRATO §3).
// La usan el REST, el `hello` y la navegación `screen.*`.
export function snapshotMessages(
	display: { values: DisplayValues },
	template: DisplayTemplate,
): [DisplayServerMessage, DisplayServerMessage] {
	return [
		{ type: 'template.set', template },
		{ type: 'data.update', templateVersion: template.version, strategy: 'snapshot', values: display.values },
	]
}

// Tope de DISPLAY_MAX_TEMPLATE_BYTES (UTF-8, no caracteres): se rechaza antes de guardar nada.
export function assertFits(messages: DisplayServerMessage[], maxBytes: number) {
	for (const m of messages)
		if (Buffer.byteLength(JSON.stringify(m)) > maxBytes)
			throw new AppError(413, 'message_too_large', `El mensaje ${m.type} pasa de ${maxBytes} bytes`)
}

// 6000 bytes → 8000 en base64 + el envoltorio (< 120): cada trama cabe en DISPLAY_MAX_FRAME.
const FRAG_BYTES = 6000

// Un mensaje de más de DISPLAY_MAX_FRAME bytes en tramas `frag` (contrato 1.1): sus bytes UTF-8, troceados, en base64.
export function fragment(json: string): string[] {
	const bytes = Buffer.from(json)
	const id = randomUUID()
	const count = Math.ceil(bytes.length / FRAG_BYTES)
	return Array.from({ length: count }, (_, seq) => {
		const data = bytes.subarray(seq * FRAG_BYTES, (seq + 1) * FRAG_BYTES).toString('base64')
		const frame = JSON.stringify({ type: 'frag', id, seq, count, bytes: bytes.length, data })
		if (frame.length > DISPLAY_MAX_FRAME) throw new Error('frag mayor que DISPLAY_MAX_FRAME') // ASCII: length = bytes
		return frame
	})
}

// En orden: template.set siempre antes que su data.update.
export async function publishAll(outbox: DisplayOutbox, displayId: string, messages: DisplayServerMessage[]) {
	for (const m of messages) await outbox.publish(displayId, m)
}
