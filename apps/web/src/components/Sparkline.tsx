// Minigráfica sin dependencias: una polyline en currentColor y el último punto en el color de marca.
// El SVG se estira al ancho de su caja (preserveAspectRatio="none"); vector-effect deja el trazo en px reales.
const W = 100
const H = 32
const PAD = 3

// Puntos [x, y] (x suele ser el instante) → coordenadas en la caja W×H, con el mayor y arriba
export function sparkPoints(points: readonly (readonly [number, number])[]): [number, number][] {
	if (!points.length) return []
	const xs = points.map(([x]) => x)
	const ys = points.map(([, y]) => y)
	const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
	const [y0, y1] = [Math.min(...ys), Math.max(...ys)]
	// Un solo instante o un valor constante: centrado en vez de dividir entre cero
	const sx = (x: number) => (x1 === x0 ? W : ((x - x0) / (x1 - x0)) * W)
	const sy = (y: number) => (y1 === y0 ? H / 2 : PAD + (1 - (y - y0) / (y1 - y0)) * (H - 2 * PAD))
	const round = (n: number) => Math.round(n * 100) / 100
	return points.map(([x, y]) => [round(sx(x)), round(sy(y))])
}

export function Sparkline({
	points,
	label,
	className = '',
}: {
	points: readonly (readonly [number, number])[]
	// Resumen para el lector de pantalla: «temp: 21,5 ahora; mínimo 19 y máximo 23,1»
	label: string
	className?: string
}) {
	const pts = sparkPoints(points)
	const last = pts.at(-1)
	// Con un solo punto, una raya plana hasta él
	const line = pts.length === 1 ? [[0, pts[0]![1]], pts[0]!] : pts
	return (
		<svg
			role="img"
			aria-label={label}
			viewBox={`0 0 ${W} ${H}`}
			preserveAspectRatio="none"
			className={`h-8 w-full overflow-visible text-fg-muted ${className}`}
		>
			<polyline
				points={line.map((p) => p.join(',')).join(' ')}
				fill="none"
				stroke="currentColor"
				strokeWidth={1.5}
				strokeLinejoin="round"
				strokeLinecap="round"
				vectorEffect="non-scaling-stroke"
			/>
			{/* Un trazo de largo cero con remate redondo es un punto que no se deforma al estirar el SVG */}
			{last && (
				<path
					d={`M${last[0]} ${last[1]}h0`}
					className="text-brand"
					stroke="currentColor"
					strokeWidth={6}
					strokeLinecap="round"
					vectorEffect="non-scaling-stroke"
				/>
			)}
		</svg>
	)
}
