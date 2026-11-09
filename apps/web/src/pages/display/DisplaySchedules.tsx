import { EmptyState } from '../../components/ui'
import { useDisplay } from './DisplayLayout'

// Esqueleto: sirve las rutas programas, programas/nuevo y programas/:scheduleId hasta que llegue la lista (§6)
export function DisplaySchedules() {
	const { display } = useDisplay()
	return (
		<EmptyState icon="clock" title="Pronto">
			Podrás programar el brillo y el refresco de «{display.name}» a la hora que quieras.
		</EmptyState>
	)
}
