import { EmptyState } from '../../components/ui'
import { useDevice } from './DeviceLayout'

// Esqueleto: sirve las rutas programas, programas/nuevo y programas/:scheduleId hasta que llegue la lista (§6)
export function DeviceSchedules() {
	const { device } = useDevice()
	return (
		<EmptyState icon="clock" title="Pronto">
			Podrás hacer que «{device.name}» se encienda o se apague sola a la hora que quieras.
		</EmptyState>
	)
}
