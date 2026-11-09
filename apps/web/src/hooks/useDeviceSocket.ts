import { useEffect, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { WsServerMessage, type Device } from '@atekos/shared'

// Única forma de escribir un Device en la caché: el detalle (['device', id]) y la lista de / (['devices'])
export function putDevice(qc: QueryClient, device: Device) {
	qc.setQueryData(['device', device.id], device)
	qc.setQueryData<Device[]>(['devices'], (list) => list?.map((d) => (d.id === device.id ? device : d)))
}

// Devuelve si el WebSocket está abierto (para el chip «En vivo»)
export function useDeviceSocket(deviceIds: string[]) {
	const qc = useQueryClient()
	const [live, setLive] = useState(false)
	const key = deviceIds.join(',')
	useEffect(() => {
		if (!key) return
		// shortcut: sin reconexión automática; cuando moleste, reconectar con backoff en onclose
		const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`)
		ws.onopen = () => {
			setLive(true)
			key.split(',').forEach((deviceId) => ws.send(JSON.stringify({ type: 'subscribe', deviceId })))
		}
		ws.onclose = () => setLive(false)
		ws.onmessage = (e) => {
			const msg = WsServerMessage.safeParse(JSON.parse(e.data))
			if (msg.success && msg.data.type === 'device.updated') putDevice(qc, msg.data.device)
		}
		return () => {
			// sin onclose: el cierre del socket viejo llega tarde y apagaría el chip del nuevo
			ws.onclose = null
			ws.close()
			setLive(false)
		}
	}, [key, qc])
	return live
}
