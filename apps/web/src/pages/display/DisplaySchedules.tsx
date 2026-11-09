import { SchedulesTab } from '../schedules/SchedulesTab'
import { useDisplay } from './DisplayLayout'

// Sirve programas, programas/nuevo y programas/:scheduleId (§6); el destino es el id de hardware (md-…)
export function DisplaySchedules() {
	const { display } = useDisplay()
	return <SchedulesTab target={{ kind: 'display', id: display.deviceId }} name={display.name} />
}
