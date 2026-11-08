import { DISPLAY_HEIGHT, DISPLAY_WIDTH } from '@atekos/shared'
import type { DisplayElement, DisplayTemplate, DisplayValues } from '@atekos/shared'

const WHITE = '#FFFFFF'
const GRAY = '#333333'

// Valor que muestra un elemento: el ligado si tiene bind (vacío si falta en values) y si no, su value.
// hasOwn: un bind «toString» no debe sacar lo heredado de Object.prototype
const content = (e: { value?: DisplayValues[string]; bind?: string }, values: DisplayValues) =>
	e.bind !== undefined ? (Object.hasOwn(values, e.bind) ? values[e.bind] : undefined) : e.value
const label = (e: { value?: DisplayValues[string]; bind?: string }, values: DisplayValues) =>
	String(content(e, values) ?? '')

// Las líneas de 1 px van a media coordenada para caer justo en una fila/columna de píxeles
function Element({ e, values }: { e: DisplayElement; values: DisplayValues }) {
	switch (e.type) {
		case 'text':
			return (
				<text x={e.x} y={e.y} fontSize={8 * (e.size ?? 1)} fill={e.color ?? WHITE} dominantBaseline="hanging">
					{label(e, values)}
				</text>
			)
		case 'rect':
			return e.filled ? (
				<rect x={e.x} y={e.y} width={e.w} height={e.h} rx={e.radius} fill={e.fillColor ?? e.color ?? WHITE} />
			) : (
				<rect
					x={e.x + 0.5}
					y={e.y + 0.5}
					width={e.w - 1}
					height={e.h - 1}
					rx={e.radius}
					fill="none"
					stroke={e.color ?? WHITE}
				/>
			)
		case 'line':
			return <line x1={e.x + 0.5} y1={e.y + 0.5} x2={e.x2 + 0.5} y2={e.y2 + 0.5} stroke={e.color ?? WHITE} />
		case 'progress': {
			const pct = Math.min(Math.max(Number(content(e, values)) || 0, 0), 100)
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
						{label(e, values)}
					</text>
				</g>
			)
	}
}

// Vista previa SVG de una plantilla: función pura de sus props (por eso SVG y no canvas: se prueba en jsdom)
export function DisplayPreview({
	template,
	values,
	showActions = false,
}: {
	template: DisplayTemplate
	values: DisplayValues
	showActions?: boolean
}) {
	return (
		<figure className="preview">
			<svg
				viewBox={`0 0 ${DISPLAY_WIDTH} ${DISPLAY_HEIGHT}`}
				width={DISPLAY_WIDTH * 2}
				height={DISPLAY_HEIGHT * 2}
				shapeRendering="crispEdges"
				fontFamily="ui-monospace, monospace"
				role="img"
				aria-label={`Vista previa de ${template.id} v${template.version}`}
			>
				<rect width={DISPLAY_WIDTH} height={DISPLAY_HEIGHT} fill={template.background ?? '#000000'} />
				{template.elements.map((e, i) => (
					<Element key={i} e={e} values={values} />
				))}
				{showActions && (
					<g className="actions">
						{template.actions.flatMap((a) =>
							a.x === undefined || a.y === undefined || a.w === undefined || a.h === undefined ? (
								[]
							) : (
								<rect
									key={a.id}
									x={a.x + 0.5}
									y={a.y + 0.5}
									width={a.w - 1}
									height={a.h - 1}
									fill="#FF00FF"
									fillOpacity={0.15}
									stroke="#FF00FF"
									strokeDasharray="3 2"
								>
									<title>{`${a.id} (${a.mode})`}</title>
								</rect>
							),
						)}
					</g>
				)}
			</svg>
			<figcaption className="muted">
				{template.id} v{template.version}. Vista previa aproximada: la fuente real del LCD es distinta.
			</figcaption>
		</figure>
	)
}
