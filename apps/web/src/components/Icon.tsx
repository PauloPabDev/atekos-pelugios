// Iconos de trazo (24×24, currentColor), siempre decorativos: el texto visible da el nombre.
// Solo <path>: los tests de la vista previa buscan el primer <rect> del documento
const PATHS = {
	bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z',
	toggle: 'M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7zM16 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
	sensor: 'M3 12h3l3-7 4 14 3-7h5',
	cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9',
	screen: 'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 17h6',
	key: 'M14.5 4a5.5 5.5 0 1 1-4.4 8.8L4 19v2h3v-2h2v-2h2l1.2-1.2A5.5 5.5 0 0 1 14.5 4zM16 8.5h.01',
	doc: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h4',
	plus: 'M12 5v14M5 12h14',
	check: 'M5 12.5l4.5 4.5L19 7.5',
	back: 'M15 5l-7 7 7 7',
	bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
	copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
	eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
	trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
	spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18',
	refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
	sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
	bot: 'M8 8h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zM12 4v4M9.5 14h.01M14.5 14h.01',
	shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
	link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
	search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
	chevron: 'M9 6l6 6-6 6',
	logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
	x: 'M6 6l12 12M18 6L6 18',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
	return (
		<svg
			className="shrink-0"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d={PATHS[name]} />
		</svg>
	)
}

// Logotipo: el rayo en una baldosa oscura y el nombre en texto
export function BrandMark() {
	return (
		<>
			<span className="grid size-7 place-items-center rounded-md bg-primary text-white">
				<Icon name="bolt" size={16} />
			</span>
			<span className="text-[15px] font-semibold tracking-tight">atekos</span>
		</>
	)
}
