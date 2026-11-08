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

// El firmware descarta tramas de más de 8192 bytes (UTF-8, no caracteres): se rechaza antes de guardar nada.
export function assertFits(messages: DisplayServerMessage[]) {
	for (const m of messages)
		if (Buffer.byteLength(JSON.stringify(m)) > DISPLAY_MAX_FRAME)
			throw new AppError(413, 'message_too_large', `El mensaje ${m.type} pasa de ${DISPLAY_MAX_FRAME} bytes`)
}

// En orden: template.set siempre antes que su data.update.
export async function publishAll(outbox: DisplayOutbox, displayId: string, messages: DisplayServerMessage[]) {
	for (const m of messages) await outbox.publish(displayId, m)
}
