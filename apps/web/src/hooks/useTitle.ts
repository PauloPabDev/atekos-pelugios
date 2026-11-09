import { useEffect } from 'react'

// document.title = «Programas · Luz de la sala · atekos»: lo leen el historial del navegador y el lector de pantalla
export function useTitle(...parts: (string | undefined)[]) {
	const title = [...parts.filter(Boolean), 'atekos'].join(' · ')
	useEffect(() => {
		const prev = document.title
		document.title = title
		return () => {
			document.title = prev
		}
	}, [title])
}
