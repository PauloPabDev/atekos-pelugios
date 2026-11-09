import { EmptyState } from '../../components/ui'
import { SchedulesTab } from '../schedules/SchedulesTab'
import { useDevice } from './DeviceLayout'

// Sirve programas, programas/nuevo y programas/:scheduleId (§6)
export function DeviceSchedules() {
	const { device } = useDevice()
	if (device.type === 'sensor')
		return (
			<section className="space-y-4">
				<h2>Programas</h2>
				<EmptyState icon="sensor" title="Los sensores no se programan">
					Un sensor solo envía lecturas: no tiene nada que encender ni apagar a una hora. Programa la luz o el
					interruptor que quieras mover.
				</EmptyState>
			</section>
		)
	return <SchedulesTab target={{ kind: 'device', id: device.id }} name={device.name} deviceType={device.type} />
}
