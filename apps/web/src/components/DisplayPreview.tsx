import { useMemo } from 'react'
import { decodeImage, displaySize, encodeBase64, resolveElement, rgb888, withDefaults } from '@atekos/shared'
import type { DisplayTemplate, DisplayValues, ResolvedElement } from '@atekos/shared'

const WHITE = '#FFFFFF'
const GRAY = '#333333'

type Resolved<T extends ResolvedElement['type']> = Extract<ResolvedElement, { type: T }>
type Paint = { filled?: boolean; fillColor?: string; color?: string; stroke?: number }

// Texto que se dibuja: resolveElement ya dejó en `value` el bind o el format aplicado
const label = (e: { value?: unknown }) => String(e.value ?? '')
// Un trazo de grosor impar va a media coordenada para caer justo en una fila/columna de píxeles
const half = (stroke = 1) => (stroke % 2) / 2
// Como rect en el firmware: relleno sin borde, o solo borde
const paint = (e: Paint) =>
	e.filled
		? { fill: e.fillColor ?? e.color ?? WHITE }
		: { fill: 'none', stroke: e.color ?? WHITE, strokeWidth: e.stroke ?? 1 }
const pts = (points: [number, number][], o: number) => points.map(([x, y]) => `${x + o},${y + o}`).join(' ')

// BMP de 24 bits (filas de abajo arriba, cada una rellenada a 4 bytes): se arma en JS puro y funciona también en jsdom
function bmp(px: Uint16Array, w: number, h: number) {
	const row = (w * 3 + 3) & ~3
	const bytes = new Uint8Array(54 + row * h)
	const v = new DataView(bytes.buffer)
	bytes.set([0x42, 0x4d]) // «BM»
	v.setUint32(2, bytes.length, true)
	v.setUint32(10, 54, true)
	v.setUint32(14, 40, true)
	v.setInt32(18, w, true)
	v.setInt32(22, h, true)
	v.setUint16(26, 1, true)
	v.setUint16(28, 24, true)
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const [r, g, b] = rgb888(px[y * w + x]!)
			bytes.set([b, g, r], 54 + (h - 1 - y) * row + x * 3)
		}
	return `data:image/bmp;base64,${encodeBase64(bytes)}`
}

function Image({ e }: { e: Resolved<'image'> }) {
	// Decodificar en cada fotograma de la animación sería caro: solo cuando cambia la imagen
	const href = useMemo(() => {
		const px = decodeImage(e.encoding, e.data, e.w, e.h)
		return px && bmp(px, e.w, e.h)
	}, [e.encoding, e.data, e.w, e.h])
	if (!href) return null
	return (
		<image
			href={href}
			x={e.x}
			y={e.y}
			width={e.w}
			height={e.h}
			preserveAspectRatio="none"
			style={{ imageRendering: 'pixelated' }}
		/>
	)
}

// Arco en sentido horario de start a end (grados, 0 = las 3 en punto); una vuelta entera o más es un círculo
function Arc({ e }: { e: Resolved<'arc'> }) {
	const [cx, cy] = [e.x + 0.5, e.y + 0.5]
	const stroke = { fill: 'none', stroke: e.color ?? WHITE, strokeWidth: e.stroke ?? 1 }
	if (Math.abs(e.end - e.start) >= 360) return <circle cx={cx} cy={cy} r={e.r} {...stroke} />
	const sweep = (((e.end - e.start) % 360) + 360) % 360
	if (sweep === 0) return null
	const at = (deg: number) => [cx + e.r * Math.cos((deg * Math.PI) / 180), cy + e.r * Math.sin((deg * Math.PI) / 180)]
	const [x0, y0] = at(e.start)
	const [x1, y1] = at(e.start + sweep)
	return <path d={`M ${x0} ${y0} A ${e.r} ${e.r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1} ${y1}`} {...stroke} />
}

function Element({ e }: { e: ResolvedElement }) {
	switch (e.type) {
		case 'text':
			return (
				<text x={e.x} y={e.y} fontSize={8 * (e.size ?? 1)} fill={e.color ?? WHITE} dominantBaseline="hanging">
					{label(e)}
				</text>
			)
		case 'rect': {
			if (e.filled)
				return <rect x={e.x} y={e.y} width={e.w} height={e.h} rx={e.radius} fill={e.fillColor ?? e.color ?? WHITE} />
			const s = e.stroke ?? 1
			return (
				<rect
					x={e.x + s / 2}
					y={e.y + s / 2}
					width={e.w - s}
					height={e.h - s}
					rx={e.radius}
					fill="none"
					stroke={e.color ?? WHITE}
					strokeWidth={s}
				/>
			)
		}
		case 'line': {
			const o = half(e.stroke)
			return (
				<line
					x1={e.x + o}
					y1={e.y + o}
					x2={e.x2 + o}
					y2={e.y2 + o}
					stroke={e.color ?? WHITE}
					strokeWidth={e.stroke ?? 1}
				/>
			)
		}
		case 'progress': {
			const pct = Math.min(Math.max(Number(e.value) || 0, 0), 100)
			return (
				<g>
					<rect x={e.x} y={e.y} width={e.w} height={e.h} fill={e.color ?? GRAY} />
					<rect x={e.x} y={e.y} width={(e.w * pct) / 100} height={e.h} fill={e.fillColor ?? WHITE} />
				</g>
			)
		}
		case 'button':
			return (
				<g>
					<rect x={e.x} y={e.y} width={e.w} height={e.h} fill={e.fillColor ?? GRAY} />
					<text
						x={e.x + e.w / 2}
						y={e.y + e.h / 2}
						fontSize={8 * (e.size ?? 1)}
						fill={e.color ?? WHITE}
						textAnchor="middle"
						dominantBaseline="middle"
					>
						{label(e)}
					</text>
				</g>
			)
		case 'circle':
			return <circle cx={e.x + 0.5} cy={e.y + 0.5} r={e.r} {...paint(e)} />
		case 'ellipse':
			return <ellipse cx={e.x + 0.5} cy={e.y + 0.5} rx={e.rx} ry={e.ry} {...paint(e)} />
		case 'polygon': {
			const o = e.filled ? 0.5 : half(e.stroke)
			return e.closed === false ? (
				<polyline points={pts(e.points, o)} {...paint(e)} fill="none" />
			) : (
				<polygon points={pts(e.points, o)} {...paint(e)} />
			)
		}
		case 'arc':
			return <Arc e={e} />
		case 'curve': {
			const o = half(e.stroke)
			const [p0, ...rest] = e.points.map(([x, y]) => `${x + o} ${y + o}`)
			return (
				<path
					d={`M ${p0} ${rest.length === 2 ? 'Q' : 'C'} ${rest.join(' ')}`}
					fill="none"
					stroke={e.color ?? WHITE}
					strokeWidth={e.stroke ?? 1}
				/>
			)
		}
		case 'image':
			return <Image e={e} />
	}
}

// Vista previa SVG de una plantilla: función pura de sus props (por eso SVG y no canvas: se prueba en jsdom).
// `frame` es el fotograma de la animación que se dibuja encima de los elementos.
export function DisplayPreview({
	template,
	values,
	showActions = false,
	frame = 0,
}: {
	template: DisplayTemplate
	values: DisplayValues
	showActions?: boolean
	frame?: number
}) {
	const { width, height } = displaySize(template.rotation)
	const v = withDefaults(template, values)
	const elements = [...template.elements, ...(template.animation?.frames[frame]?.elements ?? [])]
	return (
		<figure>
			<svg
				viewBox={`0 0 ${width} ${height}`}
				width={width * 2}
				height={height * 2}
				shapeRendering="crispEdges"
				fontFamily="ui-monospace, monospace"
				role="img"
				aria-label={`Vista previa de ${template.id} v${template.version}`}
			>
				<rect width={width} height={height} fill={template.background ?? '#000000'} />
				{elements.map((e, i) => {
					const r = resolveElement(e, v)
					return r && <Element key={i} e={r} />
				})}
				{showActions && (
					<g className="actions">
						{template.actions.flatMap((a) => {
							if (a.x === undefined || a.y === undefined || a.w === undefined || a.h === undefined) return []
							// tap en magenta; la zona que resalta un botón físico, en cian
							const color = a.trigger === 'button' ? '#00FFFF' : '#FF00FF'
							const title =
								a.trigger === 'button'
									? `${a.id}: botón ${a.button} (${a.press === 'long' ? 'larga' : 'corta'})`
									: `${a.id} (${a.mode})`
							return (
								<rect
									key={a.id}
									x={a.x + 0.5}
									y={a.y + 0.5}
									width={a.w - 1}
									height={a.h - 1}
									fill={color}
									fillOpacity={0.15}
									stroke={color}
									strokeDasharray="3 2"
								>
									<title>{title}</title>
								</rect>
							)
						})}
					</g>
				)}
			</svg>
			{/* Ancho 0 y mínimo 100%: el pie no ensancha el bisel, toma el ancho de la pantalla */}
			<figcaption className="mt-1.5 w-0 min-w-full text-xs text-zinc-400 max-lg:truncate">
				{template.id} v{template.version}. Vista previa aproximada: la fuente real del LCD es distinta.
			</figcaption>
		</figure>
	)
}
