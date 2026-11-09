// Errores en una región role=alert, uno por línea; sin errores no pinta nada
export function Problems({ lines }: { lines: string[] }) {
	if (lines.length === 0) return null
	return (
		<div role="alert" className="alert alert-error space-y-1">
			{lines.map((l, i) => (
				<p key={i}>{l}</p>
			))}
		</div>
	)
}
