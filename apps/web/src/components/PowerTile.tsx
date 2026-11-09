import { useId, type ReactNode, type Ref } from 'react'
import { Icon, type IconName } from './Icon'

// Tarjeta grande del estado. Con onToggle, toda la tarjeta es el interruptor (role=switch, nombre = `name`):
// el control principal merece la superficie del pulgar, no los 44px del Switch. Sin onToggle (sensores) solo informa.
export function PowerTile({
	name,
	on,
	label,
	icon,
	detail,
	busy = false,
	onToggle,
	ref,
}: {
	name: string
	on: boolean
	// «Encendido», «Apagado», «Activo»…
	label: string
	icon: IconName
	// Línea bajo el estado: «desde las 19:00 · Programa»
	detail?: ReactNode
	busy?: boolean
	onToggle?: () => void
	ref?: Ref<HTMLElement>
}) {
	const detailId = useId()
	const look = `flex min-h-32 w-full flex-col gap-4 rounded-lg border p-4 text-left shadow-xs transition-colors sm:p-5 ${
		on ? 'border-green-200 bg-success-soft' : 'border-line bg-surface'
	}`
	const body = (
		<>
			<span
				className={`grid size-14 place-items-center rounded-xl border ${
					on ? 'border-green-200 bg-surface text-success-fg' : 'border-line bg-canvas text-fg-muted'
				}`}
			>
				<Icon name={icon} size={28} />
			</span>
			<span className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
				<span className="min-w-0">
					<span className="block text-2xl font-semibold text-fg">{label}</span>
					{detail && (
						<span id={detailId} className="block text-sm text-fg-muted">
							{detail}
						</span>
					)}
				</span>
				{onToggle && (
					<span className="ml-auto flex items-center gap-3 text-sm text-fg-muted">
						{on ? 'Toca para apagar' : 'Toca para encender'}
						{/* El mando es solo dibujo: el estado lo da aria-checked del botón */}
						<span
							aria-hidden="true"
							className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-brand' : 'bg-line-strong'}`}
						>
							<span
								className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${
									on ? 'translate-x-5' : ''
								} ${busy ? 'animate-pulse' : ''}`}
							/>
						</span>
					</span>
				)}
			</span>
		</>
	)

	if (!onToggle)
		return (
			<div ref={ref as Ref<HTMLDivElement>} className={look}>
				{body}
			</div>
		)
	return (
		<button
			ref={ref as Ref<HTMLButtonElement>}
			type="button"
			role="switch"
			aria-checked={on}
			aria-label={name}
			aria-describedby={detail ? detailId : undefined}
			aria-busy={busy}
			className={`${look} cursor-pointer aria-busy:cursor-progress ${on ? '' : 'hover:border-line-strong'}`}
			onClick={() => {
				if (!busy) onToggle()
			}}
		>
			{body}
		</button>
	)
}
