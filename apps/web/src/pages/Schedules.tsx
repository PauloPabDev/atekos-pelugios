import { EmptyState, PageHeader } from '../components/ui'
import { useTitle } from '../hooks/useTitle'

// Esqueleto de la vista global de programas (§6.7); aún sin pestaña en la navegación principal
export function Schedules() {
	useTitle('Programas')
	return (
		<>
			<PageHeader title="Programas" />
			<EmptyState icon="calendar" title="Pronto">
				Aquí verás todo lo que tienes programado hoy y mañana.
			</EmptyState>
		</>
	)
}
