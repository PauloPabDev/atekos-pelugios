import type { TelemetryReading } from '@atekos/shared'

/** Colección time-series `telemetry` (§5). */
export interface TelemetryRepository {
	append(r: TelemetryReading): Promise<void>
	/** Lecturas con `from <= ts <= to`, por `ts` ascendente (para gráficas). */
	list(deviceId: string, from: Date, to: Date, limit: number): Promise<TelemetryReading[]>
}
