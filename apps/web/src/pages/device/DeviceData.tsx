import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from '../../api'
import {
	draftFromJson,
	EMPTY_DRAFT,
	enc,
	KeyValueEditor,
	kvChanges,
	kvMerged,
	kvNewRow,
	kvRows,
	showValue,
	type KvDraft,
} from '../../components/KeyValueEditor'
import { Status } from '../../components/Status'
import { EmptyState } from '../../components/ui'
import { useDraft } from '../../hooks/useDraft'
import { putDevice } from '../../hooks/useDeviceSocket'
import { useDevice } from './DeviceLayout'

// En el móvil el pie se queda pegado encima de las pestañas de la app (57px + zona segura)
export const STICKY_FOOT =
	'flex flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-b-lg border-t border-line bg-surface px-4 py-3 sm:px-5 max-lg:sticky max-lg:bottom-[calc(57px+env(safe-area-inset-bottom))] max-lg:z-10'

type Json = { text: string; error: string; snapshot: Record<string, unknown> }
const openJson = (data: Record<string, unknown>, draft: KvDraft): Json => ({
	text: JSON.stringify(kvMerged(data, draft), null, 2),
	error: '',
	snapshot: data,
})

export function DeviceData() {
	const { device } = useDevice()
	const id = device.id
	const qc = useQueryClient()
	// Solo lo que tocas: lo que llega en vivo a las otras claves se sigue viendo y no se pisa
	const [draft, setDraft, { dirty, reset }] = useDraft<KvDraft>(`/devices/${id}/datos`, EMPTY_DRAFT)
	// Modo avanzado: el texto vive aparte (puede no ser JSON válido mientras escribes)
	const [json, setJson] = useState<Json | null>(null)
	// Tras intentar guardar, también se marcan las claves vacías
	const [strict, setStrict] = useState(false)
	const changes = kvChanges(device.data, draft)
	const empty = kvRows(device.data, draft).length === 0

	const save = useMutation({
		mutationFn: async ({ patch, remove }: { patch: Record<string, unknown>; remove: string[] }) => {
			let d = device
			if (Object.keys(patch).length) d = await api.patchData(id, patch)
			for (const k of remove) d = await api.deleteDeviceDataKey(id, k)
			return d
		},
		onSuccess: (d) => {
			putDevice(qc, d)
			reset()
			setStrict(false)
			setJson((j) => j && openJson(d.data, EMPTY_DRAFT))
		},
		// Puede quedar a medias (pasó el PATCH y falló un DELETE): se recarga para ver lo que hay de verdad
		onError: () => qc.invalidateQueries({ queryKey: ['device', id] }),
	})

	// Cambios del borrador desde fuera del editor: el texto JSON, si está abierto, se rehace
	const replace = (d: KvDraft) => {
		setDraft(d)
		if (json) setJson(openJson(device.data, d))
	}

	const onJson = (text: string) => {
		let obj: unknown
		let error = ''
		try {
			obj = JSON.parse(text)
		} catch (e) {
			error = `JSON no válido: ${(e as Error).message.replace(/\.$/, '')}.`
		}
		if (!error && (typeof obj !== 'object' || obj === null || Array.isArray(obj)))
			error = 'Tiene que ser un objeto JSON, p. ej. {"brillo": 80}.'
		setJson({ ...json!, text, error })
		if (!error) setDraft(draftFromJson(obj as Record<string, unknown>, json!.snapshot, draft))
	}

	const onSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		if (json?.error) return
		if (Object.keys(changes.errors).length) {
			setStrict(true)
			// Tras pintar los errores, al primero
			const form = e.currentTarget
			setTimeout(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
			return
		}
		save.mutate({ patch: changes.patch, remove: changes.remove })
	}

	const add = () => replace({ ...draft, added: [...draft.added, kvNewRow()] })

	return (
		<section>
			<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1 basis-64">
					<h2 id="datos-title">Datos</h2>
					<p className="mt-1 text-sm text-fg-muted">
						Valores que guarda el dispositivo: un modo, un color, un umbral… También los puede escribir el propio
						dispositivo por la API.
					</p>
				</div>
				{!empty && (
					<button
						type="button"
						className="btn btn-ghost"
						onClick={() => setJson(json ? null : openJson(device.data, draft))}
					>
						{json ? 'Ver como formulario' : 'Ver como JSON'}
					</button>
				)}
			</div>

			{empty ? (
				<EmptyState
					icon="cube"
					title="Sin datos todavía"
					action={
						<button type="button" className="btn btn-secondary" onClick={add}>
							Añadir el primero
						</button>
					}
				>
					Un modo, un color, un umbral… lo que el dispositivo necesite recordar.
				</EmptyState>
			) : (
				<form className="card" aria-labelledby="datos-title" noValidate onSubmit={onSubmit}>
					{json ? (
						<div className="space-y-1.5 p-4 sm:p-5">
							<label className="field">
								Datos en JSON
								<textarea
									value={json.text}
									onChange={(e) => onJson(e.target.value)}
									rows={12}
									spellCheck={false}
									aria-invalid={!!json.error}
									aria-describedby="datos-json-hint"
								/>
							</label>
							<small id="datos-json-hint" className="block">
								Al guardar solo se envían las claves que cambies; las que borres del objeto se quitan.
							</small>
							{json.error && <p className="text-sm text-danger-fg">{json.error}</p>}
						</div>
					) : (
						<KeyValueEditor value={device.data} draft={draft} onChange={setDraft} strict={strict} />
					)}

					{/* Lo que el dispositivo cambió mientras editabas la misma clave: decides tú */}
					<div aria-live="polite">
						{changes.conflicts.length > 0 && (
							<div className="space-y-2 border-t border-line p-4 sm:px-5">
								{changes.conflicts.map((c) => (
									<div
										key={c.key}
										className="alert alert-warning flex flex-wrap items-center justify-end gap-x-3 gap-y-2"
									>
										<p className="min-w-0 flex-1 basis-56">
											{c.gone
												? `«${c.key}» se quitó en el dispositivo mientras editabas.`
												: `«${c.key}» cambió en el dispositivo a ${showValue(c.value, 24)} mientras editabas.`}
										</p>
										<button
											type="button"
											className="btn btn-secondary"
											onClick={() =>
												replace({
													...draft,
													edits: Object.fromEntries(Object.entries(draft.edits).filter(([k]) => k !== c.key)),
												})
											}
										>
											{c.gone ? 'Quitarlo' : `Usar ${showValue(c.value, 12)}`}
										</button>
										<button
											type="button"
											className="btn btn-ghost"
											onClick={() =>
												replace({
													...draft,
													edits: { ...draft.edits, [c.key]: { ...draft.edits[c.key]!, base: enc(c.value) } },
												})
											}
										>
											Mantener el mío
										</button>
									</div>
								))}
							</div>
						)}
					</div>

					{save.error && (
						<p role="alert" className="alert alert-error mx-4 mb-4 sm:mx-5">
							{save.error.message}
						</p>
					)}
					<div className={STICKY_FOOT}>
						<Status m={save} text="Guardado." />
						{changes.count > 0 && (
							<span className="mr-auto text-sm text-fg-muted">
								{changes.count === 1 ? '1 cambio sin guardar' : `${changes.count} cambios sin guardar`}
							</span>
						)}
						{dirty && (
							<button
								type="button"
								className="btn btn-ghost"
								onClick={() => {
									reset()
									setStrict(false)
									if (json) setJson(openJson(device.data, EMPTY_DRAFT))
								}}
							>
								Descartar
							</button>
						)}
						<button
							className="btn btn-primary"
							disabled={!changes.count || !!json?.error || save.isPending}
							aria-busy={save.isPending}
						>
							Guardar cambios
						</button>
					</div>
				</form>
			)}
		</section>
	)
}
