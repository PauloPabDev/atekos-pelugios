import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router'

// end: solo activa en su ruta exacta (el índice «En vivo»); dirty: borrador sin guardar en esa pestaña
export type Tab = { to: string; label: string; end?: boolean; dirty?: boolean }

// Pestañas que son rutas, no un tablist: cada una tiene URL, «atrás» funciona y NavLink pone aria-current="page"
export function SectionTabs({ label, tabs }: { label: string; tabs: Tab[] }) {
	const nav = useRef<HTMLElement>(null)
	const { pathname } = useLocation()
	useEffect(() => {
		// En el móvil hacen scroll horizontal: la activa se centra
		nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' })
	}, [pathname])

	return (
		<nav ref={nav} aria-label={label} className="subnav">
			{tabs.map((t) => (
				<NavLink key={t.to} to={t.to} end={t.end}>
					{t.label}
					{t.dirty && (
						<>
							<span aria-hidden="true" className="ml-1 text-brand">
								•
							</span>
							<span className="sr-only"> (sin guardar)</span>
						</>
					)}
				</NavLink>
			))}
		</nav>
	)
}
