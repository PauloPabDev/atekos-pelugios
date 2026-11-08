import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { WsServerMessage, type Device } from '@atekos/shared'

// Única forma de escribir un Device en la caché: el detalle (['device', id]) y la lista de / (['devices'])
export function putDevice(qc: QueryClient, device: Device) {
	qc.setQueryData(['device', device.id], device)
	qc.setQueryData<Device[]>(['devices'], (list) => list?.map((d) => (d.id === device.id ? device : d)))
}

export function useDeviceSocket(deviceIds: string[]) {
	const qc = useQueryClient()
	const key = deviceIds.join(',')
	useEffect(() => {
		if (!key) return
		// shortcut: sin reconexión automática; cuando moleste, reconectar con backoff en onclose
		const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`)
		ws.onopen = () => key.split(',').forEach((deviceId) => ws.send(JSON.stringify({ type: 'subscribe', deviceId })))
		ws.onmessage = (e) => {
			const msg = WsServerMessage.safeParse(JSON.parse(e.data))
			if (msg.success && msg.data.type === 'device.updated') putDevice(qc, msg.data.device)
		}
		return () => ws.close()
	}, [key, qc])
}
