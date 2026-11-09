import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { DEVICE_TYPES, type CreateDeviceInput } from '@atekos/shared'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { Status } from '../components/Status'
import { EmptyState, IconTile, Loading, PageHeader, Switch } from '../components/ui'
import { putDevice, useDeviceSocket } from '../hooks/useDeviceSocket'
import { ago, DEVICE_ICON, DEVICE_TYPE, fullDate, label } from '../labels'

// «Luz del Salón» → «luz-del-salon», dentro de [a-z0-9-]{1,40}
const slugify = (s: string) =>
	s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+/, '')
		.slice(0, 40)
		.replace(/-+$/, '')

const FILTERS = [
	['all', 'Todos'],
	['on', 'Encendidos'],
	['off', 'Apagados'],
] as const
type Filter = (typeof FILTERS)[number][0]

export function Devices() {
	const qc = useQueryClient()
	const devices = useQuery({ queryKey: ['devices'], queryFn: api.listDevices })
	useDeviceSocket(devices.data?.map((d) => d.id) ?? [])
	const toggle = useMutation({ mutationFn: api.toggleDevice, onSuccess: (d) => putDevice(qc, d) })
	const create = useMutation({
		mutationFn: api.createDevice,
		onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
	})
	const [name, setName] = useState('')
	// null = el usuario no ha tocado el slug: se deriva del nombre
	const [slug, setSlug] = useState<string | null>(null)
	// null = sin tocar: el alta arranca abierta si aún no hay dispositivos
	const [open, setOpen] = useState<boolean | null>(null)
	const formOpen = open ?? devices.data?.length === 0
	const [query, setQuery] = useState('')
	const [filter, setFilter] = useState<Filter>('all')

	const all = devices.data ?? []
	const onCount = all.filter((d) => d.state).length
	const q = query.trim().toLocaleLowerCase('es')
	const shown = all.filter(
		(d) => (filter === 'all' || d.state === (filter === 'on')) && d.name.toLocaleLowerCase('es').includes(q),
	)

	return (
		<>
			<PageHeader
				title="Mis dispositivos"
				description={devices.data && `${onCount} de ${all.length} encendidos`}
				actions={
					<>
						<Status m={create} text="Dispositivo creado." />
						<button
							type="button"
							className="btn btn-primary max-sm:w-11 max-sm:px-0"
							aria-expanded={formOpen}
							aria-controls="nuevo"
							onClick={() => setOpen(!formOpen)}
						>
							<Icon name="plus" size={16} />
							{/* En el móvil solo el icono: el texto queda para el lector de pantalla */}
							<span className="sr-only sm:not-sr-only">Nuevo dispositivo</span>
						</button>
					</>
				}
			/>

			{/* Siempre montado (hidden) para que aria-controls apunte a algo y el borrador sobreviva al plegarlo */}
			<form
				id="nuevo"
				hidden={!formOpen}
				aria-labelledby="nuevo-title"
				className="card mb-6"
				onSubmit={(e) => {
					e.preventDefault()
					const form = e.currentTarget
					// todos los campos son texto y el navegador ya aplica required/pattern; la API valida con zod
					create.mutate(Object.fromEntries(new FormData(form)) as unknown as CreateDeviceInput, {
						onSuccess: () => form.reset(),
					})
				}}
				// «Cancelar» es type=reset y el alta correcta llama a form.reset(): ambos vacían y pliegan
				onReset={() => {
					setName('')
					setSlug(null)
					setOpen(false)
					if (create.isError) create.reset()
				}}
			>
				<div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
					<h2 id="nuevo-title" className="sm:col-span-2">
						Nuevo dispositivo
					</h2>
					<label className="field">
						Nombre
						<input name="name" required maxLength={80} onChange={(e) => setName(e.target.value)} />
					</label>
					<div className="flex flex-col gap-1.5">
						<label className="field">
							Slug
							<input
								name="slug"
								required
								maxLength={40}
								pattern="[a-z0-9\-]{1,40}"
								aria-describedby="slug-hint"
								value={slug ?? slugify(name)}
								onChange={(e) => setSlug(e.target.value)}
							/>
						</label>
						<small id="slug-hint">Minúsculas, números y guiones, p. ej. «luz-sala». Se rellena desde el nombre.</small>
					</div>
					<label className="field">
						Tipo
						<select name="type" defaultValue="light">
							{DEVICE_TYPES.map((t) => (
								<option key={t} value={t}>
									{label(DEVICE_TYPE, t)}
								</option>
							))}
						</select>
					</label>
					<label className="field">
						Visibilidad
						<select name="visibility" defaultValue="private">
							<option value="private">Privado</option>
							<option value="public">Público</option>
						</select>
					</label>
					<label className="field sm:col-span-2">
						Descripción
						<textarea name="description" maxLength={500} rows={2} />
					</label>
					{create.error && (
						<p role="alert" className="alert alert-error sm:col-span-2">
							{create.error.message}
						</p>
					)}
				</div>
				<div className="flex justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">
					<button type="reset" className="btn btn-secondary">
						Cancelar
					</button>
					<button className="btn btn-primary" disabled={create.isPending} aria-busy={create.isPending}>
						Crear dispositivo
					</button>
				</div>
			</form>

			{devices.isPending && <Loading />}
			{devices.error && (
				<p role="alert" className="alert alert-error">
					{devices.error.message}
				</p>
			)}
			{devices.data?.length === 0 && (
				<EmptyState
					icon="bulb"
					title="Todavía no tienes dispositivos"
					action={
						!formOpen && (
							<button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
								<Icon name="plus" size={16} />
								Crear el primero
							</button>
						)
					}
				>
					Crea uno y contrólalo desde aquí, desde la API o con un token.
				</EmptyState>
			)}

			{all.length > 0 && (
				<>
					<div className="mb-3 flex flex-wrap items-center gap-2">
						<label className="relative min-w-0 flex-1 basis-56 sm:max-w-xs">
							<span className="sr-only">Buscar dispositivo</span>
							<span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-fg-subtle">
								<Icon name="search" size={16} />
							</span>
							<input type="search" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
						</label>
						<div role="group" aria-label="Filtrar" className="flex w-full rounded-lg bg-subtle p-0.5 sm:w-auto">
							{FILTERS.map(([f, text]) => (
								<button
									key={f}
									type="button"
									aria-pressed={filter === f}
									onClick={() => setFilter(f)}
									className={`h-11 flex-1 cursor-pointer rounded-md px-3 text-sm font-medium transition-colors sm:h-8 sm:flex-none ${
										filter === f ? 'bg-surface text-fg shadow-xs' : 'text-fg-muted hover:text-fg'
									}`}
								>
									{text}
								</button>
							))}
						</div>
					</div>

					{shown.length === 0 ? (
						<EmptyState icon="search" title="Sin resultados">
							Ningún dispositivo coincide con la búsqueda o el filtro.
						</EmptyState>
					) : (
						<ul className="card divide-y divide-line overflow-hidden">
							{shown.map((d) => {
								const busy = toggle.isPending && toggle.variables === d.id
								return (
									<li key={d.id} className="relative px-4 py-3 transition-colors hover:bg-canvas">
										<div className="flex items-center gap-3">
											<IconTile name={DEVICE_ICON[d.type] ?? 'cube'} tone={d.state ? 'success' : 'neutral'} />
											<div className="min-w-0 flex-1">
												{/* El after cubre la fila: toda ella lleva al detalle */}
												<Link
													to={`/devices/${d.id}`}
													className="block truncate text-sm font-medium text-fg after:absolute after:inset-0"
												>
													{d.name}
												</Link>
												<p className="truncate text-sm text-fg-muted">
													{label(DEVICE_TYPE, d.type)} · {d.visibility === 'public' ? 'Público' : 'Privado'} ·{' '}
													<time dateTime={d.updatedAt} title={fullDate(d.updatedAt)}>
														{ago(d.updatedAt)}
													</time>
												</p>
											</div>
											<span className="hidden items-center gap-2 text-sm text-fg-muted sm:flex">
												<span className={`dot ${d.state ? 'dot-on' : ''}`} />
												{d.state ? 'Encendido' : 'Apagado'}
											</span>
											<div className="relative z-10 flex">
												<Switch checked={d.state} label={d.name} busy={busy} onChange={() => toggle.mutate(d.id)} />
											</div>
										</div>
										{toggle.error && toggle.variables === d.id && (
											<p role="alert" className="alert alert-error relative z-10 mt-2">
												{toggle.error.message}
											</p>
										)}
									</li>
								)
							})}
						</ul>
					)}
				</>
			)}
		</>
	)
}
