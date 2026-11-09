import { useId, type ReactNode } from 'react'

// Selector exclusivo con radios de verdad (las flechas del teclado funcionan solas) y aspecto de segmentos
export function Segmented<T extends string>({
	legend,
	value,
	options,
	onChange,
	children,
}: {
	legend: string
	value: T
	options: readonly (readonly [T, string])[]
	onChange: (v: T) => void
	children?: ReactNode
}) {
	const name = useId()
	return (
		<fieldset className="border-0 p-0">
			<legend className="mb-1.5 px-0">{legend}</legend>
			<div className="flex rounded-md border border-line bg-subtle p-0.5 sm:inline-flex">
				{options.map(([v, label]) => (
					<label
						key={v}
						className="flex h-10 flex-1 cursor-pointer items-center justify-center rounded px-3 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors select-none has-checked:bg-surface has-checked:text-fg has-checked:shadow-xs has-focus-visible:outline-2 has-focus-visible:outline-brand sm:h-8 sm:flex-none"
					>
						<input
							type="radio"
							className="sr-only"
							name={name}
							value={v}
							checked={value === v}
							onChange={() => onChange(v)}
						/>
						{label}
					</label>
				))}
			</div>
			{children}
		</fieldset>
	)
}
