import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { CreateDisplayInput } from '@atekos/shared'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { Problems } from '../components/Problems'
import { EmptyState, IconTile, Loading, PageHeader } from '../components/ui'

export function Online({ online }: { online: boolean }) {
	return (
		<span className={online ? 'badge badge-success' : 'badge'}>
			<span className={online ? 'dot dot-live' : 'dot'} aria-hidden="true" />
			{online ? 'En línea' : 'Sin conexión'}
		</span>
	)
}

export function Displays() {
	const qc = useQueryClient()
	// Polling (DISENO §1): el estado online y la plantilla activa cambian sin que la web haga nada
	const displays = useQuery({ queryKey: ['displays'], queryFn: api.listDisplays, refetchInterval: 3000 })
	const create = useMutation({
		mutationFn: api.createDisplay,
		onSuccess: () => qc.invalidateQueries({ queryKey: ['displays'] }),
	})
	const [invalid, setInvalid] = useState<string[]>([])
	const [open, setOpen] = useState(false)
	const count = displays.data?.length ?? 0
	const online = displays.data?.filter((d) => d.online).length ?? 0

	const onSubmit = (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		// Además del pattern del navegador: CreateDisplayInput normaliza el hex a mayúsculas
		const parsed = CreateDisplayInput.safeParse(Object.fromEntries(new FormData(e.currentTarget)))
		setInvalid(parsed.success ? [] : api.issueLines(parsed.error.issues))
		if (parsed.success) create.mutate(parsed.data, { onSuccess: () => setOpen(false) })
	}

	return (
		<>
			<PageHeader
				title="Mis pantallas"
				description={count > 0 && `${online} de ${count} en línea`}
				// Sin pantallas, la acción la lleva el bloque vacío
				actions={
					count > 0 && (
						<button type="button" className="btn btn-primary" aria-expanded={open} onClick={() => setOpen(!open)}>
							<Icon name="plus" size={16} />
							Nueva pantalla
						</button>
					)
				}
			/>

			{open && (
				<form className="card mb-6" onSubmit={onSubmit} aria-labelledby="nueva-titulo">
					<div className="border-b border-line px-4 py-3 sm:px-5">
						<h2 id="nueva-titulo">Registrar pantalla</h2>
					</div>
					<div className="grid items-start gap-4 p-4 sm:grid-cols-2 sm:p-5">
						<div className="flex flex-col gap-1.5">
							<label className="field">
								Id de la pantalla
								<input
									name="deviceId"
									// Sin mayúsculas visuales: el prefijo «md-» va en minúsculas y verlo como «MD-» confunde
									className="font-mono"
									required
									pattern="md-[0-9a-fA-F]{12}"
									placeholder="md-34B7DA01ABCD"
									autoComplete="off"
									spellCheck={false}
									autoFocus
									aria-describedby="device-id-hint"
								/>
							</label>
							<small id="device-id-hint">
								«md-» y 12 hexadecimales: el deviceId que la pantalla envía en su device.hello.
							</small>
						</div>
						<label className="field">
							Nombre
							<input name="name" required maxLength={80} />
						</label>
						<div className="sm:col-span-2">
							<Problems lines={[...invalid, ...api.errorLines(create.error)]} />
						</div>
					</div>
					<div className="flex justify-end gap-2 rounded-b-lg border-t border-line bg-canvas px-4 py-3 sm:px-5">
						<button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
							Cancelar
						</button>
						<button className="btn btn-primary" disabled={create.isPending}>
							Registrar pantalla
						</button>
					</div>
				</form>
			)}

			{displays.isPending && <Loading />}
			<Problems lines={api.errorLines(displays.error)} />
			{count === 0 && displays.data && !open && (
				<EmptyState
					icon="screen"
					title="Todavía no tienes pantallas"
					action={
						<button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
							<Icon name="plus" size={16} />
							Nueva pantalla
						</button>
					}
				>
					Regístrala con su id y un nombre para editar lo que muestra.
				</EmptyState>
			)}
			{/* Siempre montada (oculta si está vacía): la lista no cambia de nodo al llegar la primera pantalla */}
			<ul className="card divide-y divide-line overflow-hidden empty:hidden" aria-label="Pantallas">
				{displays.data?.map((d) => (
					<li key={d.deviceId} className="relative flex items-center gap-3 px-4 py-3 hover:bg-subtle sm:px-5">
						<IconTile name="screen" />
						<div className="min-w-0 flex-1">
							<Link
								to={`/displays/${d.deviceId}`}
								className="block truncate font-medium text-fg after:absolute after:inset-0"
							>
								{d.name}
							</Link>
							<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
								<span className="mono">{d.deviceId}</span>
								{/* Un id de plantilla llega a 64 caracteres: parte la línea antes que desbordar */}
								<span className="wrap-anywhere">plantilla {d.activeTemplateId}</span>
							</div>
						</div>
						<Online online={d.online} />
					</li>
				))}
			</ul>
		</>
	)
}
