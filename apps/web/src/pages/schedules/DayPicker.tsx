import { useId } from 'react'
import { DAY_LETTERS, DAYS, EVERY_DAY, sameDays, WEEKEND, WORKDAYS } from '../../schedules'

const SHORTCUTS = [
	['Todos los días', EVERY_DAY],
	['Laborables', WORKDAYS],
	['Fin de semana', WEEKEND],
] as const

// Días como casillas de verdad: se ve «L», el lector oye «lunes». Debajo, los atajos de un toque.
export function DayPicker({
	days,
	onChange,
	error,
}: {
	days: readonly number[]
	onChange: (days: number[]) => void
	error?: string
}) {
	const errorId = useId()
	return (
		<fieldset className="border-0 p-0" aria-describedby={error ? errorId : undefined}>
			<legend className="mb-1.5 px-0">Días</legend>
			{/* 7 columnas iguales: a 320 px los chips se estrechan y no hay scroll horizontal */}
			<div className="grid max-w-sm grid-cols-7 gap-1.5 sm:max-w-72">
				{DAYS.map((name, i) => (
					<label
						key={name}
						className="grid h-11 cursor-pointer place-items-center rounded-md border border-line bg-surface text-sm font-medium text-fg-muted transition-colors select-none hover:bg-subtle has-checked:border-brand has-checked:bg-brand-soft has-checked:font-semibold has-checked:text-brand-hover has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand sm:h-9"
					>
						<input
							type="checkbox"
							className="sr-only"
							aria-label={name}
							checked={days.includes(i + 1)}
							onChange={(e) => onChange(e.target.checked ? [...days, i + 1] : days.filter((d) => d !== i + 1))}
						/>
						<span aria-hidden="true">{DAY_LETTERS[i]}</span>
					</label>
				))}
			</div>
			<div className="mt-2 flex flex-wrap gap-0.5">
				{SHORTCUTS.map(([label, set]) => {
					const on = sameDays(days, set)
					return (
						<button
							key={label}
							type="button"
							aria-pressed={on}
							className={`btn btn-ghost px-2.5 ${on ? 'bg-subtle text-fg' : ''}`}
							onClick={() => onChange([...set])}
						>
							{label}
						</button>
					)
				})}
			</div>
			{error && (
				<p id={errorId} className="mt-1 text-sm text-danger-fg">
					{error}
				</p>
			)}
		</fieldset>
	)
}
