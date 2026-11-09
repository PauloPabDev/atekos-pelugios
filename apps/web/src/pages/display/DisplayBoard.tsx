import type { ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { DisplayDetail } from '@atekos/shared'
import * as api from '../../api'
import { Problems } from '../../components/Problems'
import { Status } from '../../components/Status'
import { ago, fullDate } from '../../labels'
import { lastSeen } from '../Displays'
import { EXPLAIN } from './common'

const mb = (bytes: number) => `${(bytes / 1_048_576).toLocaleString('es', { maximumFractionDigits: 2 })} MB`
// Lo que el firmware añada a board/display sin que la web lo conozca se enseña tal cual
const extras = (o: object, known: string[]) =>
	Object.entries(o)
		.filter(([k, v]) => !known.includes(k) && v !== null && typeof v !== 'object')
		.map(([k, v]): [string, ReactNode] => [k, String(v)])

// Ficha de la placa (contrato 1.3): llega con cada hello y cuando se pide con display.info
export function DisplayBoard({ display: d }: { display: DisplayDetail }) {
	const ask = useMutation({ mutationFn: () => api.sendDisplayCommand(d.deviceId, { type: 'display.info' }) })
	const info = d.info
	const board = info?.board ?? {}
	const screen = info?.display
	const count = info?.buttons?.length ?? screen?.buttons

	const rows: [string, ReactNode][] = info
		? [
				['Placa', board.model],
				['Chip', board.chip],
				['Firmware', info.firmware],
				[
					'Pantalla',
					screen &&
						`${screen.width}×${screen.height} px${screen.driver ? ` · ${screen.driver}` : ''}${screen.touch === undefined ? '' : screen.touch ? ' · táctil' : ' · sin táctil'}`,
				],
				[
					'Botones',
					info.buttons?.length ? (
						<ul className="space-y-0.5">
							{info.buttons.map((b) => (
								<li key={b.button}>
									<span className="mono">{b.button}</span>
									{b.name && ` · ${b.name}`}
									{b.gpio !== undefined && <span className="text-fg-muted"> · GPIO {b.gpio}</span>}
								</li>
							))}
						</ul>
					) : (
						count !== undefined && (count === 1 ? '1 botón' : `${count} botones`)
					),
				],
				['Flash', board.flashBytes !== undefined && mb(board.flashBytes)],
				['PSRAM', board.psramBytes !== undefined && (board.psramBytes ? mb(board.psramBytes) : 'No tiene')],
				['MAC', board.mac && <span className="mono">{board.mac}</span>],
				...extras(board, ['model', 'chip', 'mac', 'flashBytes', 'psramBytes']),
				...extras(screen ?? {}, ['width', 'height', 'touch', 'buttons', 'driver']),
			]
		: []

	return (
		<section aria-labelledby="placa" className="card">
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
				<h2 id="placa">Placa</h2>
				<button
					type="button"
					className="btn btn-secondary"
					onClick={() => ask.mutate()}
					disabled={!d.online || ask.isPending}
					title={d.online ? undefined : 'La placa no está conectada'}
				>
					Pedir ficha
				</button>
			</div>
			<dl className="divide-y divide-line">
				<Row label="Conexión">
					{d.online ? (
						'En línea'
					) : (
						<span title={d.lastSeenAt ? fullDate(d.lastSeenAt) : undefined}>
							Sin conexión, {lastSeen(d.lastSeenAt)}
						</span>
					)}
				</Row>
				{rows
					.filter(([, v]) => v !== undefined && v !== false && v !== '')
					.map(([label, v]) => (
						<Row key={label} label={label}>
							{v}
						</Row>
					))}
			</dl>
			<div className="space-y-2 px-4 pt-1 pb-3 text-sm text-fg-muted sm:px-5">
				{info ? (
					<>
						{!!info.capabilities?.length && (
							<details>
								<summary>Capacidades ({info.capabilities.length})</summary>
								<ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Capacidades">
									{info.capabilities.map((c) => (
										<li key={c} className="badge mono">
											{c}
										</li>
									))}
								</ul>
							</details>
						)}
						<p title={fullDate(info.receivedAt)}>Ficha recibida {ago(info.receivedAt)}.</p>
					</>
				) : (
					<p>
						La placa aún no ha enviado su ficha (modelo, pantalla y botones). La manda con el hello el firmware que
						implementa el contrato 1.3.
					</p>
				)}
				<Status m={ask} text="Pedida: llega en unos segundos." />
				<Problems lines={api.errorLines(ask.error, EXPLAIN)} />
			</div>
		</section>
	)
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex gap-3 px-4 py-2 text-sm sm:px-5">
			<dt className="w-20 shrink-0 text-fg-muted">{label}</dt>
			<dd className="min-w-0 flex-1 break-words">{children}</dd>
		</div>
	)
}
