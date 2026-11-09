import { useEffect, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { WsServerMessage, type Device } from '@atekos/shared'

// Única forma de escribir un Device en la caché: el detalle (['device', id]) y la lista de / (['devices'])
export function putDevice(qc: QueryClient, device: Device) {
	qc.setQueryData(['device', device.id], device)
	qc.setQueryData<Device[]>(['devices'], (list) => list?.map((d) => (d.id === device.id ? device : d)))
}

// live: abierto · connecting: abriendo o reintentando · offline: 5 intentos fallidos o sin red (sigue reintentando)
export type SocketStatus = 'live' | 'connecting' | 'offline'

const MAX_DELAY = 30_000

export function useDeviceSocket(deviceIds: string[]) {
	const qc = useQueryClient()
	const [status, setStatus] = useState<SocketStatus>('connecting')
	const key = deviceIds.join(',')
	useEffect(() => {
		if (!key) return
		const ids = key.split(',')
		let ws: WebSocket
		let tries = 0
		let opened = false
		let waiting = false
		let timer: ReturnType<typeof setTimeout> | undefined

		const connect = () => {
			waiting = false
			ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`)
			ws.onopen = () => {
				// El WS no reenvía lo que pasó mientras estaba caído: se recarga todo lo de estos dispositivos
				if (opened)
					qc.invalidateQueries({
						predicate: ({ queryKey }) => queryKey[0] === 'devices' || ids.some((id) => queryKey.includes(id)),
					})
				opened = true
				tries = 0
				setStatus('live')
				ids.forEach((deviceId) => ws.send(JSON.stringify({ type: 'subscribe', deviceId })))
			}
			ws.onclose = () => {
				tries++
				waiting = true
				setStatus(tries >= 5 || !navigator.onLine ? 'offline' : 'connecting')
				// 1 s, 2 s, 4 s… hasta 30 s; el azar evita que todas las pestañas vuelvan a la vez tras un reinicio de la API
				const delay = Math.min(MAX_DELAY, 1000 * 2 ** (tries - 1))
				timer = setTimeout(connect, delay * (0.5 + Math.random() / 2))
			}
			ws.onmessage = (e) => {
				const msg = WsServerMessage.safeParse(JSON.parse(e.data))
				if (msg.success && msg.data.type === 'device.updated') putDevice(qc, msg.data.device)
			}
		}
		// Si vuelve la red o la pestaña, no se espera a la siguiente vuelta del backoff
		const retry = () => {
			if (!waiting || document.visibilityState !== 'visible') return
			clearTimeout(timer)
			tries = 0
			setStatus('connecting')
			connect()
		}

		connect()
		window.addEventListener('online', retry)
		document.addEventListener('visibilitychange', retry)
		return () => {
			clearTimeout(timer)
			window.removeEventListener('online', retry)
			document.removeEventListener('visibilitychange', retry)
			// sin onclose: el cierre del socket viejo llega tarde y apagaría el chip del nuevo (y reintentaría)
			ws.onclose = null
			ws.close()
			setStatus('connecting')
		}
	}, [key, qc])
	return status
}
