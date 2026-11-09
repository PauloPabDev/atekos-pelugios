import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import type { PatchDeviceInput } from '@atekos/shared'
import * as api from '../../api'
import { Icon } from '../../components/Icon'
import { Status } from '../../components/Status'
import { putDevice } from '../../hooks/useDeviceSocket'
import { useDevice } from './DeviceLayout'

const CARD_FOOT = 'flex flex-wrap items-center justify-end gap-3 border-t border-line px-4 py-3 sm:px-5'

export function DeviceSettings() {
	const { device: d } = useDevice()
	const qc = useQueryClient()
	const navigate = useNavigate()
	const [confirming, setConfirming] = useState(false)
	const patch = useMutation({
		mutationFn: (input: PatchDeviceInput) => api.patchDevice(d.id, input),
		onSuccess: (x) => putDevice(qc, x),
	})
	const del = useMutation({
		mutationFn: () => api.deleteDevice(d.id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['devices'] })
			navigate('/')
		},
	})

	return (
		<div className="space-y-8">
			<section>
				<form
					className="card"
					aria-labelledby="ajustes-title"
					onSubmit={(e) => {
						e.preventDefault()
						patch.mutate(Object.fromEntries(new FormData(e.currentTarget)) as PatchDeviceInput)
					}}
				>
					<div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
						<div className="sm:col-span-2">
							<h2 id="ajustes-title">Ajustes</h2>
							<p className="mt-1 text-sm text-fg-muted">Cómo se llama y quién puede verlo.</p>
						</div>
						<label className="field">
							Nombre
							<input name="name" required maxLength={80} defaultValue={d.name} />
						</label>
						<label className="field">
							Visibilidad
							<select name="visibility" defaultValue={d.visibility}>
								<option value="private">Privado</option>
								<option value="public">Público</option>
							</select>
						</label>
						<label className="field sm:col-span-2">
							Descripción
							<textarea name="description" maxLength={500} rows={2} defaultValue={d.description} />
						</label>
						{patch.error && (
							<p role="alert" className="alert alert-error sm:col-span-2">
								{patch.error.message}
							</p>
						)}
					</div>
					<div className={CARD_FOOT}>
						<Status m={patch} text="Guardado." />
						<button className="btn btn-primary" disabled={patch.isPending} aria-busy={patch.isPending}>
							Guardar
						</button>
					</div>
				</form>
			</section>

			<section>
				<div className="card border-red-200 p-4 sm:p-5">
					<h2>Borrar</h2>
					{confirming ? (
						<>
							<p className="mt-1 text-sm text-fg">
								¿Borrar «{d.name}»? También se borran sus tokens ligados. No se puede deshacer.
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
							{del.error && (
								<p role="alert" className="alert alert-error mt-3">
									{del.error.message}
								</p>
							)}
						</>
					) : (
						<div className="mt-1 flex flex-wrap items-center justify-between gap-3">
							<p className="text-sm text-fg-muted">Borra el dispositivo, su historial y sus tokens ligados.</p>
							<button type="button" className="btn btn-danger-outline" onClick={() => setConfirming(true)}>
								<Icon name="trash" size={16} />
								Borrar dispositivo
							</button>
						</div>
					)}
				</div>
			</section>
		</div>
	)
}
