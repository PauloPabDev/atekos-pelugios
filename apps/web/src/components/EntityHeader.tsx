import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from './Icon'
import { IconTile } from './ui'

// Cabecera compacta del detalle de un dispositivo o una pantalla: volver, icono, nombre, estado y un control,
// con las pestañas (children) debajo. La de las listas es PageHeader, más alta.
// El bloque es sticky bajo la cabecera de la app en el móvil (top-14) y arriba del todo en lg; los márgenes
// negativos (los del padding de <main>) hacen que su fondo tape lo que pasa por debajo. La línea inferior es la de
// .subnav. sticky={false} donde la página ya tiene su propia parte sticky (el editor de plantillas).
export function EntityHeader({
	back,
	backLabel,
	icon,
	tone,
	title,
	status,
	control,
	sticky = true,
	children,
}: {
	back: string
	backLabel: string
	icon: IconName
	tone?: 'neutral' | 'brand' | 'success'
	title: string
	status?: ReactNode
	control?: ReactNode
	sticky?: boolean
	children?: ReactNode
}) {
	return (
		<div
			className={`-mx-4 bg-canvas px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 ${sticky ? 'sticky top-14 z-20 lg:top-0' : ''}`}
		>
			<div className="flex items-center gap-3 py-2">
				<Link to={back} aria-label={backLabel} className="btn btn-icon btn-ghost -ml-3 sm:-ml-2">
					<Icon name="back" size={20} />
				</Link>
				<IconTile name={icon} tone={tone} />
				<div className="min-w-0 flex-1">
					<h1 className="truncate text-lg" title={title}>
						{title}
					</h1>
					{status && <p className="truncate text-sm text-fg-muted">{status}</p>}
				</div>
				{control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
			</div>
			{children}
		</div>
	)
}
