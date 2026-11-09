import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

// Interruptor accesible: el nombre lo da `label` (aria-label); mientras `busy`, el mando late y no admite otro toque
export function Switch({
	checked,
	label,
	busy = false,
	disabled = false,
	onChange,
}: {
	checked: boolean
	label: string
	busy?: boolean
	disabled?: boolean
	onChange: () => void
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			aria-busy={busy}
			disabled={disabled}
			className="switch"
			onClick={() => {
				if (!busy) onChange()
			}}
		>
			<span className="switch-track">
				<span className="switch-thumb" />
			</span>
		</button>
	)
}

export function Loading({ text = 'Cargando…' }: { text?: string }) {
	return (
		<p className="flex items-center gap-2.5 py-6 text-sm text-fg-muted">
			<span className="spinner" aria-hidden="true" />
			{text}
		</p>
	)
}

// Cabecera de página: título, descripción opcional y acciones a la derecha
export function PageHeader({
	title,
	description,
	actions,
	back,
}: {
	title: ReactNode
	description?: ReactNode
	actions?: ReactNode
	back?: ReactNode
}) {
	return (
		<div className="mb-6">
			{back}
			<div className="flex flex-wrap items-end gap-x-4 gap-y-3">
				<div className="min-w-0 flex-1">
					<h1>{title}</h1>
					{description && <div className="mt-1 text-sm text-fg-muted">{description}</div>}
				</div>
				{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
			</div>
		</div>
	)
}

export function EmptyState({
	icon,
	title,
	children,
	action,
}: {
	icon: IconName
	title: string
	children?: ReactNode
	action?: ReactNode
}) {
	return (
		<div className="flex flex-col items-center rounded-lg border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
			<span className="mb-3 grid size-10 place-items-center rounded-lg border border-line bg-canvas text-fg-muted">
				<Icon name={icon} size={20} />
			</span>
			<p className="text-sm font-medium text-fg">{title}</p>
			{children && <div className="mt-1 max-w-sm text-sm text-fg-muted">{children}</div>}
			{action && <div className="mt-4">{action}</div>}
		</div>
	)
}

// Baldosa de icono de 36px para filas y tarjetas
export function IconTile({ name, tone = 'neutral' }: { name: IconName; tone?: 'neutral' | 'brand' | 'success' }) {
	const tones = {
		neutral: 'border-line bg-canvas text-fg-muted',
		brand: 'border-indigo-200 bg-brand-soft text-brand',
		success: 'border-green-200 bg-success-soft text-success-fg',
	}
	return (
		<span className={`grid size-9 shrink-0 place-items-center rounded-lg border ${tones[tone]}`}>
			<Icon name={name} size={18} />
		</span>
	)
}
