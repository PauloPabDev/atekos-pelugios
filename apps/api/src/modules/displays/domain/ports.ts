import type { DisplayCommand, DisplayEvent, DisplayServerMessage, DisplayTemplate, DisplayValues } from '@atekos/shared'

/** Fila de `displays` con las fechas en ISO. `hardwareId` es el `deviceId` público ('md-34B7DA01ABCD'). */
export type DisplayRecord = {
	id: string
	ownerId: string
	hardwareId: string
	name: string
	activeTemplateId: string
	values: DisplayValues
	createdAt: string
	updatedAt: string
}

export interface DisplayRepository {
	/** Inserta la pantalla y `template` como su plantilla activa, en una transacción. null si el hardwareId ya existe. */
	create(
		d: { ownerId: string; hardwareId: string; name: string },
		template: DisplayTemplate,
	): Promise<DisplayRecord | null>
	findById(id: string): Promise<DisplayRecord | null>
	/** `hardwareId` ya normalizado con DisplayHardwareId. */
	findByHardwareId(hardwareId: string): Promise<DisplayRecord | null>
	/** Por `createdAt` ascendente. */
	listByOwner(ownerId: string): Promise<DisplayRecord[]>
	findTemplate(displayId: string, templateId: string): Promise<DisplayTemplate | null>
	/** Por `templateId`. */
	listTemplates(displayId: string): Promise<DisplayTemplate[]>
	/** Inserta o sube de versión. 409 `version_not_incremented` si ya existe con una versión ≥. */
	upsertTemplate(displayId: string, t: DisplayTemplate): Promise<void>
	/** 409 si es la activa; 404 si no existe. */
	deleteTemplate(displayId: string, templateId: string): Promise<void>
	/** Activa una plantilla guardada y la devuelve. 422 `template_not_found` si no existe. */
	setActive(displayId: string, templateId: string): Promise<{ display: DisplayRecord; template: DisplayTemplate }>
	// Escrituras atómicas (UPDATE … RETURNING). Lanzan NotFound si la pantalla ya no existe.
	rename(id: string, name: string): Promise<DisplayRecord>
	replaceValues(id: string, values: DisplayValues): Promise<DisplayRecord>
	/** Merge superficial (jsonb ||). 422 `invalid_data` si el resultado pasa de 64 claves. */
	mergeValues(id: string, patch: DisplayValues): Promise<DisplayRecord>
	/** Borra la pantalla y devuelve los hashes de sus tokens ligados (caen en cascada). */
	delete(id: string): Promise<string[]>
}

/** ZSET `dpres:{displayId}` (DISENO §2): conexiones vivas del dispositivo en cualquier instancia. */
export interface DisplayPresence {
	add(displayId: string, connId: string): Promise<void>
	/** Igual que add: cada latido alarga la vida de la conexión. */
	renew(displayId: string, connId: string): Promise<void>
	remove(displayId: string, connId: string): Promise<void>
	isOnline(displayId: string): Promise<boolean>
}

/** `close` termina los sockets de la pantalla (borrado). */
export type DisplayOutMessage = DisplayServerMessage | { type: 'close' }

/** Canal `display-out`: cada instancia entrega a sus sockets los mensajes de las pantallas que tiene conectadas. */
export interface DisplayOutbox {
	publish(displayId: string, message: DisplayOutMessage): Promise<void>
	subscribe(fn: (displayId: string, message: DisplayOutMessage) => void): Promise<void>
}

export type NewTouchEvent = Omit<DisplayEvent, 'ts'> & { displayId: string; ownerId: string }
export type NewCommandEvent = {
	displayId: string
	ownerId: string
	command: DisplayCommand
	actor: { kind: 'user' | 'token'; id: string }
}

/** Colección time-series `display_events`; `ts` lo pone el adaptador al guardar. */
export interface DisplayEventLog {
	appendTouch(e: NewTouchEvent): Promise<void>
	/** Solo toques, más reciente primero. */
	listTouches(displayId: string, limit: number): Promise<DisplayEvent[]>
	appendCommand(e: NewCommandEvent): Promise<void>
}
