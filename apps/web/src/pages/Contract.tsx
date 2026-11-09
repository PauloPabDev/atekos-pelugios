import { Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as api from '../api'
import { Icon, type IconName } from '../components/Icon'
import '../styles/contract.css'

// Solo lo que lee esta página de los documentos (JSON Schema dentro de AsyncAPI 3.0 y OpenAPI 3.1)
type Schema = {
	$ref?: string
	type?: string | string[]
	properties?: Record<string, Schema>
	required?: string[]
	items?: Schema
	oneOf?: Schema[]
	anyOf?: Schema[]
	additionalProperties?: Schema | boolean
	propertyNames?: Schema
	const?: unknown
	enum?: unknown[]
	minimum?: number
	maximum?: number
	minLength?: number
	maxLength?: number
	pattern?: string
	maxItems?: number
	maxProperties?: number
	format?: string
	default?: unknown
}
type Message = { name: string; summary?: string; 'x-from': 'device' | 'server'; payload: Schema }
type AsyncApi = {
	info: { version: string; description: string; 'x-updated': string; 'x-protocol': number; 'x-max-frame-bytes': number }
	servers: { atekos: { host: string; protocol: string; pathname: string } }
	components: { securitySchemes: { deviceToken: { description: string } }; messages: Record<string, Message> }
}
type Security = Record<string, string[]>[]
type Operation = {
	summary?: string
	security?: Security
	requestBody?: { content: Record<string, { schema: Schema }> }
	responses: Record<string, { description: string }>
}
type OpenApi = {
	servers: { url: string }[]
	security?: Security
	paths: Record<string, Record<string, Operation>>
	components: { schemas: Record<string, Schema> }
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const REF = '#/components/schemas/'
const MAX_DEPTH = 8
// El color del chip dice el sentido: cian sale del dispositivo, violeta del servidor
const GROUPS = [
	['device', 'Del dispositivo al servidor', 'cyan'],
	['server', 'Del servidor al dispositivo', 'violet'],
] as const
const OFFICIAL = 'https://github.com/PauloPabDev/atekos-pelugios/blob/main/docs/metadisplay/CONTRATO.md'
const DOWNLOADS: [href: string, name: string, text: string, icon: IconName][] = [
	['/api/v1/contract/asyncapi.json', 'asyncapi.json', 'WebSocket del dispositivo (AsyncAPI 3.0)', 'doc'],
	['/api/v1/contract/openapi.json', 'openapi.json', 'API REST de pantallas (OpenAPI 3.1)', 'doc'],
	[OFFICIAL, 'Contrato oficial (CONTRATO.md)', 'El documento de referencia, en GitHub', 'link'],
]

// La fecha viene como AAAA-MM-DD, que Date lee en UTC: en otra zona saldría el día anterior
const day = (s: string) =>
	new Date(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

// Sin security propio hereda el raíz; [] es público
const access = (sec?: Security) =>
	!sec
		? 'sesión o token'
		: sec.length === 0
			? 'público'
			: sec.every((s) => Object.keys(s).join() === 'session')
				? 'sesión'
				: 'sesión o token'

const variants = (s: Schema) => s.oneOf ?? s.anyOf
const complex = (s: Schema): boolean =>
	!!s.properties || (!!s.items && complex(s.items)) || !!variants(s)?.some(complex)
const json = (x: unknown) => JSON.stringify(x)
const range = (min?: number, max?: number) =>
	min !== undefined && max !== undefined
		? `${min}–${max}`
		: min !== undefined
			? `≥ ${min}`
			: max !== undefined
				? `≤ ${max}`
				: ''

function constraints(s: Schema): string[] {
	const out: string[] = []
	if ('const' in s) out.push(`= ${json(s.const)}`)
	if (s.enum) out.push(`uno de ${s.enum.map(json).join(', ')}`)
	const r = range(s.minimum, s.maximum)
	if (r) out.push(r)
	const len = range(s.minLength, s.maxLength)
	if (len) out.push(`longitud ${len}`)
	if (s.pattern) out.push(`patrón ${s.pattern}`)
	if (s.maxItems !== undefined) out.push(`máx. ${s.maxItems} elementos`)
	if (s.maxProperties !== undefined) out.push(`máx. ${s.maxProperties} claves`)
	if (s.format) out.push(`formato ${s.format}`)
	if ('default' in s) out.push(`por defecto ${json(s.default)}`)
	if (s.propertyNames) out.push(...constraints(s.propertyNames).map((c) => `clave: ${c}`))
	if (typeof s.additionalProperties === 'object')
		out.push(...constraints(s.additionalProperties).map((c) => `valor: ${c}`))
	if (s.items && !complex(s.items)) out.push(...constraints(s.items).map((c) => `cada elemento: ${c}`))
	const v = variants(s)
	if (v && !v.some(complex)) out.push(...v.flatMap((x) => constraints(x).map((c) => `${String(x.type)}: ${c}`)))
	return out
}

function TypeLabel({ s }: { s: Schema }) {
	if (s.$ref?.startsWith(REF)) {
		const name = s.$ref.slice(REF.length)
		return <a href={`#schema-${name}`}>{name}</a>
	}
	const v = variants(s)
	if (v)
		return v.some(complex)
			? `uno de ${v.length}`
			: v.map((x, i) => (
					<Fragment key={i}>
						{i > 0 && ' | '}
						<TypeLabel s={x} />
					</Fragment>
				))
	if (s.type === 'array')
		return s.items && !complex(s.items) ? (
			<>
				<TypeLabel s={s.items} />
				[]
			</>
		) : (
			'array'
		)
	if (!s.properties && typeof s.additionalProperties === 'object' && Object.keys(s.additionalProperties).length)
		return (
			<>
				{'{ [clave]: '}
				<TypeLabel s={s.additionalProperties} />
				{' }'}
			</>
		)
	if (Array.isArray(s.type)) return s.type.join(' | ')
	return s.type ?? (s.properties ? 'object' : 'cualquiera')
}

// Las variantes de la plantilla se distinguen por su campo const (type en elementos, kind en local)
const variantName = (s: Schema, i: number) =>
	String(Object.values(s.properties ?? {}).find((p) => 'const' in p)?.const ?? `variante ${i + 1}`)

// Visor recursivo: tabla de campos; objetos anidados, items y variantes van plegados
function SchemaView({ s, depth = 0 }: { s: Schema; depth?: number }) {
	if (depth > MAX_DEPTH) return <p className="muted">…</p>
	const v = variants(s)
	if (v?.some(complex))
		return v.map((x, i) => (
			<details key={i}>
				<summary>{variantName(x, i)}</summary>
				<SchemaView s={x} depth={depth + 1} />
			</details>
		))
	if (s.items && complex(s.items)) return <SchemaView s={s.items} depth={depth + 1} />
	if (!s.properties)
		return (
			<p>
				<TypeLabel s={s} /> <span className="muted">{constraints(s).join(' · ')}</span>
			</p>
		)
	return (
		<div className="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Campo</th>
						<th>Tipo</th>
						<th>Obligatorio</th>
						<th>Restricciones</th>
					</tr>
				</thead>
				<tbody>
					{Object.entries(s.properties).map(([name, p]) => (
						<Fragment key={name}>
							<tr>
								<td>
									<code>{name}</code>
								</td>
								<td>
									<TypeLabel s={p} />
								</td>
								<td>{s.required?.includes(name) ? 'sí' : 'no'}</td>
								<td>{constraints(p).join(' · ')}</td>
							</tr>
							{complex(p) && (
								<tr>
									<td colSpan={4}>
										<details>
											<summary>{name}</summary>
											<SchemaView s={p} depth={depth + 1} />
										</details>
									</td>
								</tr>
							)}
						</Fragment>
					))}
				</tbody>
			</table>
		</div>
	)
}

// Público (fuera de <Session>): es la referencia para quien programa el firmware
export function Contract() {
	const asyncapi = useQuery({
		queryKey: ['contract', 'asyncapi.json'],
		queryFn: () => api.getContract('asyncapi.json') as Promise<AsyncApi>,
	})
	const openapi = useQuery({
		queryKey: ['contract', 'openapi.json'],
		queryFn: () => api.getContract('openapi.json') as Promise<OpenApi>,
	})
	const error = asyncapi.error ?? openapi.error
	const a = asyncapi.data
	const o = openapi.data

	return (
		<div className="contract">
			<h1>Contrato MetaDisplay</h1>
			{error ? (
				<p role="alert" className="error">
					No se pudo cargar el contrato: {error.message}
				</p>
			) : !a || !o ? (
				<p className="loading">Cargando…</p>
			) : (
				<>
					<p className="lead">
						v{a.info.version} · Última actualización:{' '}
						<time dateTime={a.info['x-updated']}>{day(a.info['x-updated'])}</time>
					</p>
					<nav aria-label="Secciones" className="sections">
						<a href="#descargas">Descargas</a>
						<a href="#mensajes">Mensajes</a>
						<a href="#rest">API REST</a>
						<a href="#esquemas">Esquemas</a>
					</nav>
					<div className="card">
						<dl className="meta">
							<dt>Protocolo</dt>
							<dd>{a.info['x-protocol']}</dd>
							<dt>WebSocket</dt>
							<dd>
								<code>{`${a.servers.atekos.protocol}://${a.servers.atekos.host}${a.servers.atekos.pathname}`}</code>
							</dd>
							<dt>Autenticación</dt>
							<dd>{a.components.securitySchemes.deviceToken.description}</dd>
							<dt>Trama máxima</dt>
							<dd>{a.info['x-max-frame-bytes']} bytes</dd>
						</dl>
						<p>{a.info.description}</p>
					</div>

					<section id="descargas">
						<h2>Descargas</h2>
						<ul className="cards">
							{DOWNLOADS.map(([href, name, text, icon]) => (
								<li key={href} className="card row">
									<span className="tile yellow">
										<Icon name={icon} />
									</span>
									<div className="grow">
										<a href={href} className="stretch card-title" download={href !== OFFICIAL}>
											{name}
										</a>
										<p className="muted">{text}</p>
									</div>
								</li>
							))}
						</ul>
					</section>

					<section id="mensajes">
						<h2>Mensajes del WebSocket</h2>
						{GROUPS.map(([from, label, color]) => (
							<Fragment key={from}>
								<h3>{label}</h3>
								<ul className="cards list" aria-label={label}>
									{Object.values(a.components.messages)
										.filter((m) => m['x-from'] === from)
										.map((m) => (
											<li key={m.name} className="card">
												<code className={`chip mono ${color}`}>{m.name}</code>
												{m.summary && <p>{m.summary}</p>}
												<SchemaView s={m.payload} />
											</li>
										))}
								</ul>
							</Fragment>
						))}
					</section>

					<section id="rest">
						<h2>API REST</h2>
						<p>
							Base: <code>{o.servers[0]?.url}</code>
						</p>
						<div className="table-wrap">
							<table>
								<thead>
									<tr>
										<th>Operación</th>
										<th>Resumen</th>
										<th>Acceso</th>
										<th>Cuerpo</th>
										<th>Respuestas</th>
									</tr>
								</thead>
								<tbody>
									{Object.entries(o.paths).flatMap(([path, item]) =>
										METHODS.map((method) => {
											const op = item[method]
											const body = op?.requestBody?.content['application/json']?.schema
											return (
												op && (
													<tr key={`${method} ${path}`}>
														<td data-method={method}>
															<code>
																{method.toUpperCase()} {path}
															</code>
														</td>
														<td className="wrap">{op.summary}</td>
														<td>{access(op.security ?? o.security)}</td>
														<td>{body ? <TypeLabel s={body} /> : '—'}</td>
														<td className="wrap">
															<ul className="events">
																{Object.entries(op.responses).map(([code, r]) => (
																	<li key={code}>
																		<code>{code}</code> {r.description}
																	</li>
																))}
															</ul>
														</td>
													</tr>
												)
											)
										}),
									)}
								</tbody>
							</table>
						</div>
					</section>

					<section id="esquemas">
						<h2>Esquemas</h2>
						{Object.entries(o.components.schemas).map(([name, s]) => (
							<section key={name} id={`schema-${name}`}>
								<h3>
									<code>{name}</code>
								</h3>
								<SchemaView s={s} />
							</section>
						))}
					</section>
				</>
			)}
		</div>
	)
}
