import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import * as api from '../../api'
import { Icon } from '../../components/Icon'
import { Problems } from '../../components/Problems'
import { Status } from '../../components/Status'
import { useDisplay } from './DisplayLayout'

const CARD_FOOT = 'flex flex-wrap items-center justify-end gap-3 border-t border-line px-4 py-3 sm:px-5'

export function DisplaySettings() {
	const { display } = useDisplay()
	const { deviceId: id, name } = display
	const qc = useQueryClient()
	const navigate = useNavigate()
	const [confirming, setConfirming] = useState(false)
	const [copyMsg, setCopyMsg] = useState('')
	const rename = useMutation({
		mutationFn: (name: string) => api.patchDisplay(id, { name }),
		onSuccess: () =>
			Promise.all([
				qc.invalidateQueries({ queryKey: ['display', id] }),
				qc.invalidateQueries({ queryKey: ['displays'] }),
			]),
	})
	const del = useMutation({
		mutationFn: () => api.deleteDisplay(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['displays'] })
			navigate('/displays')
		},
	})

	const copyId = async () => {
		try {
			await navigator.clipboard.writeText(id)
			setCopyMsg('Copiado.')
		} catch {
			// navigator.clipboard no existe fuera de HTTPS/localhost (p. ej. el celular por IP de la LAN)
			setCopyMsg('No se pudo copiar: selecciónalo y cópialo a mano.')
		}
	}

	return (
		<div className="space-y-8">
			<section>
				<form
					className="card"
					aria-labelledby="general-title"
					onSubmit={(e) => {
						e.preventDefault()
						rename.mutate(String(new FormData(e.currentTarget).get('name')))
					}}
				>
					<div className="space-y-4 p-4 sm:p-5">
						<h2 id="general-title">General</h2>
						<label className="field sm:max-w-sm">
							Nombre
							<input name="name" required maxLength={80} defaultValue={name} />
						</label>
						<Problems lines={api.errorLines(rename.error)} />
					</div>
					<div className={CARD_FOOT}>
						<Status m={rename} text="Guardado." />
						<button className="btn btn-primary" disabled={rename.isPending} aria-busy={rename.isPending}>
							Guardar cambios
						</button>
					</div>
				</form>
			</section>

			<section className="card">
				<h2 className="border-b border-line px-4 py-3 sm:px-5">Para programadores</h2>
				<div className="divide-y divide-line">
					<div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
						<div className="min-w-0 flex-1 basis-48">
							<p className="text-sm text-fg-muted">Id de hardware</p>
							<p className="mono break-all">{id}</p>
						</div>
						<span role="status" className="text-sm text-fg-muted">
							{copyMsg}
						</span>
						<button type="button" className="btn btn-secondary" onClick={copyId}>
							<Icon name="copy" size={16} />
							Copiar
						</button>
					</div>
					<div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
						<p className="min-w-0 flex-1 basis-48 text-sm text-fg-muted">
							La pantalla se conecta con un token propio, que se pega en su portal WiFi.
						</p>
						{/* ?pantalla: para que Tokens preseleccione esta pantalla cuando lo lea */}
						<Link to={`/tokens?pantalla=${display.id}`} className="btn btn-ghost -mr-3">
							Crear token para esta pantalla
							<Icon name="chevron" size={16} />
						</Link>
					</div>
				</div>
			</section>

			<section>
				<div className="card border-red-200 p-4 sm:p-5">
					<h2>Zona de peligro</h2>
					{confirming ? (
						<>
							<p className="mt-1 text-sm text-fg">
								¿Borrar «{name}»? Se borran sus plantillas, sus datos y sus programas, y sus tokens dejan de funcionar
								al momento. No se puede deshacer.
							</p>
							<div className="mt-4 flex flex-wrap gap-2">
								<button
									type="button"
									className="btn btn-danger"
									onClick={() => del.mutate()}
									disabled={del.isPending}
									aria-busy={del.isPending}
								>
									Sí, borrar
								</button>
								<button type="button" className="btn btn-secondary" autoFocus onClick={() => setConfirming(false)}>
									Cancelar
								</button>
							</div>
							<div className="mt-3">
								<Problems lines={api.errorLines(del.error)} />
							</div>
						</>
					) : (
						<div className="mt-1 flex flex-wrap items-center justify-between gap-3">
							<p className="text-sm text-fg-muted">
								Quita la pantalla de tu cuenta con sus plantillas, datos y programas. Sus tokens dejan de funcionar.
							</p>
							<button type="button" className="btn btn-danger-outline" onClick={() => setConfirming(true)}>
								<Icon name="trash" size={16} />
								Borrar pantalla
							</button>
						</div>
					)}
				</div>
			</section>
		</div>
	)
}
