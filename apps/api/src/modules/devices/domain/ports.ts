import type { CreateDeviceInput, Device, DeviceEvent, PatchDeviceInput } from '@atekos/shared'

export interface DeviceRepository {
	/** null si el dueño ya tiene ese slug (unique `devices_owner_slug`). */
	create(d: CreateDeviceInput & { ownerId: string }): Promise<Device | null>
	findById(id: string): Promise<Device | null>
	/** Por `createdAt` ascendente. */
	listByOwner(ownerId: string): Promise<Device[]>
	/** Solo los públicos, por `createdAt` ascendente; `page` empieza en 1. */
	listPublic(page: number, limit: number): Promise<Device[]>
	// Escrituras atómicas (UPDATE … RETURNING). Lanzan NotFound si el dispositivo ya no existe.
	update(id: string, patch: PatchDeviceInput): Promise<Device>
	setState(id: string, state: boolean): Promise<Device>
	toggleState(id: string): Promise<Device>
	mergeData(id: string, patch: Record<string, unknown>): Promise<Device>
	/** Borra el dispositivo y devuelve los hashes de sus tokens ligados (caen en cascada). */
	delete(id: string): Promise<string[]>
}

/** `device:{id}` en Redis. */
export interface DeviceCache {
	get(id: string): Promise<Device | null>
	set(d: Device): Promise<void>
	delete(id: string): Promise<void>
}

/** Documento de `device_events` (§5) sin `ts`: lo pone el adaptador al guardarlo. */
export type NewDeviceEvent = Omit<DeviceEvent, 'ts'>

export interface DeviceEventLog {
	append(e: NewDeviceEvent): Promise<void>
	/** Más reciente primero. */
	list(deviceId: string, limit: number): Promise<DeviceEvent[]>
}

/** Canal `device-events`: el `Device` después de cada cambio, para todas las instancias. */
export interface DeviceEventBus {
	publish(d: Device): Promise<void>
	subscribe(fn: (d: Device) => void): Promise<void>
}
