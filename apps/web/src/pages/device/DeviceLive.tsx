import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import * as api from '../../api'
import { Icon } from '../../components/Icon'
import { Switch } from '../../components/ui'
import { putDevice } from '../../hooks/useDeviceSocket'
import { DEVICE_TYPE, label } from '../../labels'
import { useDevice } from './DeviceLayout'

export function DeviceLive() {
	const { device: d } = useDevice()
	const qc = useQueryClient()
	const [copyMsg, setCopyMsg] = useState('')
	const toggle = useMutation({ mutationFn: () => api.toggleDevice(d.id), onSuccess: (x) => putDevice(qc, x) })

	const copyLink = async () => {
		const url = new URL(`/p/${d.id}`, location.origin).href
		try {
			await navigator.clipboard.writeText(url)
			setCopyMsg('Enlace copiado.')
		} catch {
			// navigator.clipboard no existe fuera de HTTPS/localhost (p. ej. el celular por IP de la LAN)
			setCopyMsg(`No se pudo copiar; cópialo a mano: ${url}`)
		}
	}

	const stateText = d.state ? 'Encendido' : 'Apagado'

	return (
		<>
			<div className="flex flex-wrap items-start gap-x-4 gap-y-3">
				<div className="min-w-0 flex-1 basis-64">
					<div className="flex flex-wrap items-center gap-2">
						<span className={`badge ${d.state ? 'badge-success' : ''}`}>
							<span className={`dot ${d.state ? 'dot-on' : ''}`} />
							{stateText}
						</span>
						<span className="badge">{label(DEVICE_TYPE, d.type)}</span>
						<span className={`badge ${d.visibility === 'public' ? 'badge-brand' : ''}`}>
							{d.visibility === 'public' ? 'Público' : 'Privado'}
						</span>
					</div>
					<p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
						<span>
							Slug <span className="mono">{d.slug}</span>
						</span>
						<span>
							Id <span className="mono break-all">{d.id}</span>
						</span>
					</p>
				</div>
				<div className="flex items-center gap-3">
					<span className="text-sm font-medium text-fg-muted">{stateText}</span>
					<Switch checked={d.state} label={d.name} busy={toggle.isPending} onChange={() => toggle.mutate()} />
				</div>
			</div>
			{toggle.error && (
				<p role="alert" className="alert alert-error mt-3">
					{toggle.error.message}
				</p>
			)}
			{d.visibility === 'public' && (
				<div className="mt-4 flex flex-wrap items-center gap-2">
					<Link to={`/p/${d.id}`} className="btn btn-secondary">
						<Icon name="eye" size={16} />
						Vista pública
					</Link>
					<button type="button" className="btn btn-secondary" onClick={copyLink}>
						<Icon name="copy" size={16} />
						Copiar enlace
					</button>
					<span role="status" className="min-w-0 text-sm break-all text-fg-muted">
						{copyMsg}
					</span>
				</div>
			)}
		</>
	)
}
