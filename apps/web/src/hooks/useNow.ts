import { useEffect, useState } from 'react'

// Hora actual que se repinta cada `ms`: así «hace 2 minutos» no se queda congelado en una pantalla abierta
export function useNow(ms = 30_000) {
	const [now, setNow] = useState(Date.now)
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), ms)
		return () => clearInterval(t)
	}, [ms])
	return now
}
