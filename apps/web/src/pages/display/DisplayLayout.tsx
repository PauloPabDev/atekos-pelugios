import { useQuery } from '@tanstack/react-query'
import { Outlet, useLocation, useMatch, useOutletContext, useParams } from 'react-router'
import type { DisplayDetail } from '@atekos/shared'
import * as api from '../../api'
import { EntityHeader } from '../../components/EntityHeader'
import { Problems } from '../../components/Problems'
import { SectionTabs } from '../../components/SectionTabs'
import { Loading } from '../../components/ui'
import { hasDraft } from '../../hooks/useDraft'
import { useTitle } from '../../hooks/useTitle'
import { Online } from '../Displays'

export type DisplayContext = { display: DisplayDetail }
// Lo que el layout comparte con cada pestaña: la pantalla ya cargada y al día por polling
export const useDisplay = () => useOutletContext<DisplayContext>()

const TABS = [
	['', 'En vivo'],
	['datos', 'Datos'],
	['plantillas', 'Plantillas'],
	['programas', 'Programas'],
	['actividad', 'Actividad'],
	['ajustes', 'Ajustes'],
] as const

export function DisplayLayout() {
	const { deviceId = '' } = useParams()
	const display = useQuery({
		queryKey: ['display', deviceId],
		queryFn: () => api.getDisplay(deviceId),
		refetchInterval: 3000,
	})
	const tab = useLocation().pathname.split('/')[3] ?? ''
	// El editor tiene su propia vista previa y barra de guardar sticky: la cabecera no se les pone encima
	const editing = !!useMatch('/displays/:deviceId/plantillas/:templateId')
	useTitle(TABS.find(([to]) => to === tab)?.[1], display.data?.name)

	const back = { back: '/displays', backLabel: 'Volver a mis pantallas', icon: 'screen' } as const
	// Con datos ya cargados, un fallo del polling no desmonta las pestañas (perderían los borradores)
	if (!display.data) {
		if (display.isPending) return <Loading />
		return (
			<>
				<EntityHeader {...back} title="Pantalla" sticky={false} />
				<div className="mt-4">
					<Problems
						lines={
							display.error instanceof api.HttpError && display.error.status === 404
								? ['Esta pantalla no existe.']
								: api.errorLines(display.error)
						}
					/>
				</div>
			</>
		)
	}
	const d = display.data
	const base = `/displays/${deviceId}`

	return (
		<>
			<EntityHeader
				{...back}
				tone={d.online ? 'success' : 'neutral'}
				title={d.name}
				status={`Muestra «${d.template.id}»`}
				control={<Online online={d.online} />}
				sticky={!editing}
			>
				<SectionTabs
					label={`Secciones de «${d.name}»`}
					tabs={TABS.map(([to, label]) =>
						to ? { to: `${base}/${to}`, label, dirty: hasDraft(`${base}/${to}`) } : { to: base, label, end: true },
					)}
				/>
			</EntityHeader>
			<div className="mt-6 space-y-6">
				<Problems lines={api.errorLines(display.error)} />
				{/* key: al pasar a otra pantalla, las pestañas se montan de cero (sin borradores de la anterior) */}
				<div key={deviceId}>
					<Outlet context={{ display: d } satisfies DisplayContext} />
				</div>
			</div>
		</>
	)
}
