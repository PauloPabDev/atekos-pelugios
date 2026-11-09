import { useId, useRef } from 'react'
import { Icon } from './Icon'
import { Switch } from './ui'

// Editor clave-valor con tipos sobre un objeto `data`. El borrador guarda solo lo que tocas (no una copia entera):
// así lo que llega en vivo a las demás claves se sigue viendo, y al guardar solo se envía lo cambiado.

export type KvType = 'text' | 'number' | 'bool' | 'json'
export const KV_TYPES: readonly (readonly [KvType, string])[] = [
	['text', 'Texto'],
	['number', 'Número'],
	['bool', 'Sí/No'],
	['json', 'JSON'],
]
// base: el valor del servidor (en JSON) cuando empezaste a editarla; si cambia mientras tanto, hay que avisar
export type KvEdit = { type: KvType; text: string; base: string }
export type KvNew = { id: string; key: string; type: KvType; text: string }
export type KvDraft = { edits: Record<string, KvEdit>; removed: string[]; added: KvNew[] }
export const EMPTY_DRAFT: KvDraft = { edits: {}, removed: [], added: [] }

type Data = Record<string, unknown>
// Solo propiedades propias: una clave «constructor» no debe leer la de Object.prototype
const own = <T,>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined)
const without = <T,>(o: Record<string, T>, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k))
// JSON.stringify(undefined) es undefined: '' no es JSON de nada, así que «no está» nunca empata con un valor
export const enc = (v: unknown) => JSON.stringify(v) ?? ''

export const inferType = (v: unknown): KvType =>
	typeof v === 'string' ? 'text' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : 'json'

export const toText = (v: unknown) => (typeof v === 'string' ? v : enc(v))

// Valor corto para leer: «Sí»/«No», textos sin comillas y lo demás en JSON, recortado
export function showValue(v: unknown, max = 40) {
	const s = v === true ? 'Sí' : v === false ? 'No' : toText(v)
	return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export function parseValue(text: string, type: KvType): { ok: true; value: unknown } | { ok: false; error: string } {
	if (type === 'text') return { ok: true, value: text }
	if (type === 'bool') return { ok: true, value: text === 'true' }
	if (type === 'number') {
		// Se acepta la coma decimal; se envía un Number
		const s = text.trim().replace(',', '.')
		const n = Number(s)
		return s && Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: 'No es un número.' }
	}
	try {
		return { ok: true, value: JSON.parse(text) }
	} catch (e) {
		return { ok: false, error: `JSON no válido: ${(e as Error).message.replace(/\.$/, '')}.` }
	}
}

export type KvRow = { id: string; key: string; type: KvType; text: string; isNew: boolean; removed: boolean }

// Filas a pintar: las claves del servidor (con tu borrador encima), las que editabas y el servidor quitó, y las nuevas
export function kvRows(data: Data, draft: KvDraft): KvRow[] {
	const keys = [...Object.keys(data), ...Object.keys(draft.edits).filter((k) => !Object.hasOwn(data, k))]
	return [
		...keys.map((k) => {
			const e = own(draft.edits, k)
			const v = own(data, k)
			return {
				id: k,
				key: k,
				type: e?.type ?? inferType(v),
				text: e?.text ?? toText(v),
				isNew: false,
				removed: draft.removed.includes(k),
			}
		}),
		...draft.added.map((a) => ({ ...a, isNew: true, removed: false })),
	]
}

export const EMPTY_KEY = 'La clave no puede estar vacía.'
export type KvError = { on: 'key' | 'value'; text: string }

// Lo que hay que enviar: PATCH solo con lo que difiere del servidor (no pisa lo que escribe el ESP a la vez) y un
// DELETE por clave quitada. Errores y filas cambiadas van por id de fila (la clave, o el id de la fila nueva).
export function kvChanges(data: Data, draft: KvDraft) {
	const patch: [string, unknown][] = []
	const errors: Record<string, KvError> = {}
	const changed = new Set<string>()
	const conflicts: { key: string; value: unknown; gone: boolean }[] = []

	for (const [k, e] of Object.entries(draft.edits)) {
		if (draft.removed.includes(k)) continue
		const cur = enc(own(data, k))
		const p = parseValue(e.text, e.type)
		if (!p.ok) errors[k] = { on: 'value', text: p.error }
		else if (enc(p.value) !== cur) patch.push([k, p.value])
		else continue
		changed.add(k)
		if (e.base !== cur) conflicts.push({ key: k, value: own(data, k), gone: !Object.hasOwn(data, k) })
	}

	const taken = new Set([...Object.keys(data), ...Object.keys(draft.edits)].filter((k) => !draft.removed.includes(k)))
	for (const a of draft.added) {
		changed.add(a.id)
		const key = a.key.trim()
		if (!key) errors[a.id] = { on: 'key', text: EMPTY_KEY }
		else if (taken.has(key)) errors[a.id] = { on: 'key', text: `Ya existe un dato «${key}».` }
		else {
			taken.add(key)
			const p = parseValue(a.text, a.type)
			if (p.ok) patch.push([key, p.value])
			else errors[a.id] = { on: 'value', text: p.error }
		}
	}

	// Quitar y volver a añadir la misma clave es reemplazarla: basta el PATCH
	const remove = draft.removed.filter((k) => Object.hasOwn(data, k) && !patch.some(([p]) => p === k))
	remove.forEach((k) => changed.add(k))
	// fromEntries define propiedades propias: una clave «__proto__» no toca el prototipo
	return { patch: Object.fromEntries(patch), remove, errors, changed, conflicts, count: changed.size }
}

// El borrador como objeto (el modo JSON): un valor que no se puede leer va tal cual, como texto
export function kvMerged(data: Data, draft: KvDraft): Data {
	return Object.fromEntries(
		kvRows(data, draft)
			.filter((r) => !r.removed && r.key.trim())
			.map((r) => {
				const p = parseValue(r.text, r.type)
				return [r.key.trim(), p.ok ? p.value : r.text]
			}),
	)
}

// Del JSON editado al borrador. Se compara con lo que había al abrir el JSON (`snapshot`), no con lo de ahora:
// una clave que no tocaste no se envía aunque el dispositivo la haya cambiado después.
export function draftFromJson(obj: Data, snapshot: Data, prev: KvDraft): KvDraft {
	const edits: [string, KvEdit][] = []
	const added: KvNew[] = []
	for (const [k, v] of Object.entries(obj)) {
		const row = { type: inferType(v), text: toText(v) }
		if (!Object.hasOwn(snapshot, k)) added.push({ id: `json:${k}`, key: k, ...row })
		else if (enc(v) !== enc(snapshot[k]))
			edits.push([k, { ...row, base: own(prev.edits, k)?.base ?? enc(snapshot[k]) }])
	}
	return {
		edits: Object.fromEntries(edits),
		removed: Object.keys(snapshot).filter((k) => !Object.hasOwn(obj, k)),
		added,
	}
}

// Sin crypto.randomUUID: no existe fuera de HTTPS (el móvil que entra por la IP de la LAN)
export const kvNewRow = (): KvNew => ({
	id: `n${Math.random().toString(36).slice(2)}`,
	key: '',
	type: 'text',
	text: '',
})

const ROW =
	'grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2 px-4 py-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_8.5rem_auto] sm:gap-x-3 sm:px-5'

// strict: muestra también «La clave no puede estar vacía.» (tras intentar guardar; antes molesta al empezar a escribir)
export function KeyValueEditor({
	value,
	draft,
	onChange,
	strict = false,
}: {
	value: Data
	draft: KvDraft
	onChange: (draft: KvDraft) => void
	strict?: boolean
}) {
	const addButton = useRef<HTMLButtonElement>(null)
	const uid = useId()
	const rows = kvRows(value, draft)
	const { errors, changed } = kvChanges(value, draft)

	const edit = (r: KvRow, change: { key?: string; type?: KvType; text?: string }) => {
		if (r.isNew) return onChange({ ...draft, added: draft.added.map((a) => (a.id === r.id ? { ...a, ...change } : a)) })
		const type = change.type ?? r.type
		const text = change.text ?? r.text
		const orig = own(value, r.key)
		// Volver al valor de partida quita la fila del borrador
		const pristine = Object.hasOwn(value, r.key) && type === inferType(orig) && text === toText(orig)
		const base = own(draft.edits, r.key)?.base ?? enc(orig)
		onChange({
			...draft,
			edits: pristine ? without(draft.edits, r.key) : { ...draft.edits, [r.key]: { type, text, base } },
		})
	}

	const remove = (r: KvRow) => {
		if (r.isNew) {
			onChange({ ...draft, added: draft.added.filter((a) => a.id !== r.id) })
			// La fila desaparece con el foco dentro: que no se pierda
			addButton.current?.focus()
		} else
			onChange({
				...draft,
				removed: r.removed ? draft.removed.filter((k) => k !== r.key) : [...draft.removed, r.key],
			})
	}

	return (
		<>
			<ul className="divide-y divide-line">
				{rows.map((r, i) => {
					const err = errors[r.id] && (strict || errors[r.id]!.text !== EMPTY_KEY) ? errors[r.id] : undefined
					// Por posición: una clave con espacios rompería la lista de ids de aria-describedby
					const errId = `${uid}-err-${i}`
					const name = r.key.trim() || 'el dato nuevo'
					const valueProps = {
						'aria-label': `Valor de ${name}`,
						'aria-invalid': err?.on === 'value',
						'aria-describedby': err?.on === 'value' ? errId : undefined,
						disabled: r.removed,
					}
					return (
						<li
							key={r.id}
							// La fila con cambios lleva un filo de marca a la izquierda
							className={`${ROW} ${changed.has(r.id) ? 'shadow-[inset_2px_0_0_var(--color-brand)]' : ''}`}
						>
							<div className="min-w-0">
								{r.isNew ? (
									<input
										aria-label="Clave del dato nuevo"
										className="font-mono"
										value={r.key}
										// Solo al montar: la fila recién añadida, todavía vacía
										autoFocus={!r.key && !r.text}
										autoComplete="off"
										spellCheck={false}
										aria-invalid={err?.on === 'key'}
										aria-describedby={err?.on === 'key' ? errId : undefined}
										onChange={(e) => edit(r, { key: e.target.value })}
									/>
								) : (
									<p
										className={`flex min-h-11 items-center font-mono text-sm break-all sm:min-h-9 ${
											r.removed ? 'text-fg-subtle line-through' : 'text-fg'
										}`}
									>
										{r.key}
									</p>
								)}
								{(r.removed || changed.has(r.id)) && (
									<p className="text-xs text-fg-subtle">
										{r.removed ? 'Se quitará' : r.isNew ? 'Nuevo' : 'Modificado'}
									</p>
								)}
							</div>
							<div className="max-sm:order-last max-sm:col-span-3">
								{r.type === 'bool' ? (
									<div className="flex min-h-11 items-center gap-3 sm:min-h-9">
										<Switch
											checked={r.text === 'true'}
											label={`Valor de ${name}`}
											disabled={r.removed}
											onChange={() => edit(r, { text: r.text === 'true' ? 'false' : 'true' })}
										/>
										<span className="text-sm text-fg" aria-hidden="true">
											{r.text === 'true' ? 'Sí' : 'No'}
										</span>
									</div>
								) : r.type === 'json' ? (
									<textarea
										{...valueProps}
										rows={3}
										spellCheck={false}
										value={r.text}
										onChange={(e) => edit(r, { text: e.target.value })}
									/>
								) : (
									<input
										{...valueProps}
										inputMode={r.type === 'number' ? 'decimal' : undefined}
										value={r.text}
										onChange={(e) => edit(r, { text: e.target.value })}
									/>
								)}
							</div>
							<select
								aria-label={`Tipo de ${name}`}
								className="w-28 sm:w-full"
								value={r.type}
								disabled={r.removed}
								onChange={(e) => {
									const type = e.target.value as KvType
									// A Sí/No solo pasa un «true» explícito; el resto de cambios conserva el texto
									edit(r, { type, text: type === 'bool' ? String(r.text === 'true') : r.text })
								}}
							>
								{KV_TYPES.map(([t, label]) => (
									<option key={t} value={t}>
										{label}
									</option>
								))}
							</select>
							{r.removed ? (
								<button
									type="button"
									className="btn btn-ghost"
									aria-label={`Deshacer quitar ${name}`}
									onClick={() => remove(r)}
								>
									Deshacer
								</button>
							) : (
								<button
									type="button"
									className="btn btn-icon btn-ghost"
									aria-label={`Quitar ${name}`}
									onClick={() => remove(r)}
								>
									<Icon name="x" size={18} />
								</button>
							)}
							{err && (
								<p id={errId} className="col-span-full text-sm text-danger-fg max-sm:order-last">
									{err.text}
								</p>
							)}
						</li>
					)
				})}
			</ul>
			<div className="border-t border-line px-2 py-2 sm:px-3">
				<button
					ref={addButton}
					type="button"
					className="btn btn-ghost"
					onClick={() => onChange({ ...draft, added: [...draft.added, kvNewRow()] })}
				>
					<Icon name="plus" size={16} />
					Añadir dato
				</button>
			</div>
		</>
	)
}
