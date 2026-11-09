import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PatchDataInput } from '@atekos/shared'
import * as api from '../../api'
import { Status } from '../../components/Status'
import { putDevice } from '../../hooks/useDeviceSocket'
import { useDevice } from './DeviceLayout'

const CARD_FOOT = 'flex flex-wrap items-center justify-end gap-3 border-t border-line px-4 py-3 sm:px-5'

// Textarea controlado: un device.updated por WS no pisa lo que estás escribiendo
export function DeviceData() {
	const { device } = useDevice()
	const qc = useQueryClient()
	const [text, setText] = useState(() => JSON.stringify(device.data, null, 2))
	const [invalid, setInvalid] = useState('')
	const save = useMutation({
		mutationFn: (data: PatchDataInput) => api.patchData(device.id, data),
		onSuccess: (d) => {
			putDevice(qc, d)
			setText(JSON.stringify(d.data, null, 2))
		},
	})

	const onSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		let value: unknown
		try {
			value = JSON.parse(text)
		} catch {
			return setInvalid('No es JSON válido.')
		}
		const parsed = PatchDataInput.safeParse(value)
		if (!parsed.success) return setInvalid('Tiene que ser un objeto JSON, p. ej. {"brillo": 80}.')
		setInvalid('')
		save.mutate(parsed.data)
	}

	return (
		<section>
			<form className="card" aria-labelledby="datos-title" onSubmit={onSubmit}>
				<div className="space-y-4 p-4 sm:p-5">
					<div>
						<h2 id="datos-title">Datos</h2>
						<p className="mt-1 text-sm text-fg-muted">Valores libres del dispositivo, en JSON.</p>
					</div>
					<div className="space-y-1.5">
						<label className="field">
							data (JSON)
							<textarea
								value={text}
								onChange={(e) => setText(e.target.value)}
								rows={8}
								spellCheck={false}
								aria-invalid={!!invalid}
								aria-describedby="data-hint"
							/>
						</label>
						<small id="data-hint">Se mezcla con el data actual: las claves que no envíes se conservan.</small>
					</div>
					{(invalid || save.error) && (
						<p role="alert" className="alert alert-error">
							{invalid || save.error?.message}
						</p>
					)}
				</div>
				<div className={CARD_FOOT}>
					<Status m={save} text="Guardado." />
					<button className="btn btn-primary" disabled={save.isPending} aria-busy={save.isPending}>
						Guardar data
					</button>
				</div>
			</form>
		</section>
	)
}
