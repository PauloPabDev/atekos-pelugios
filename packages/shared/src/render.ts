import type { DisplayElement, DisplayRule, DisplayTemplate, DisplayValues } from './index'

// Semántica de referencia de la capa dinámica de la plantilla (docs/metadisplay/PLANTILLAS.md §7).
// La usan la vista previa de la web y la validación de la API; un firmware debe dibujar lo mismo.

type Scalar = DisplayValues[string]
type Animation = NonNullable<DisplayTemplate['animation']>

const COLOR = /^#[0-9a-fA-F]{6}$/
const COLOR_PROPS = new Set(['color', 'fillColor'])
const BOOL_PROPS = new Set(['filled', 'closed', 'visible'])
const TEXT_PROPS = new Set(['value', 'format'])

const has = (values: DisplayValues, key: string) => Object.hasOwn(values, key) // «toString» no es una variable

// Verdadero: true, un número ≠ 0 o un texto que no sea '', '0' ni 'false'. null y una clave ausente son falsos.
export const truthy = (v: Scalar | undefined) =>
	v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && !['', '0', 'false'].includes(v))

// Valor de una variable convertido al tipo de la propiedad; undefined = no sirve y se conserva la base.
function coerce(prop: string, v: Scalar): Scalar | undefined {
	if (COLOR_PROPS.has(prop)) return typeof v === 'string' && COLOR.test(v) ? v : undefined
	if (BOOL_PROPS.has(prop)) return truthy(v)
	if (TEXT_PROPS.has(prop)) return prop === 'format' ? (typeof v === 'string' ? v : undefined) : v
	const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
	return Number.isFinite(n) ? Math.round(n) : undefined
}

// eq/ne comparan sin conversión (5 ≠ "5"); gt/gte/lt/lte, como números (si alguno no lo es, la regla no se cumple).
export function testRule(r: DisplayRule, values: DisplayValues): boolean {
	const a = has(values, r.key) ? values[r.key] : undefined
	if (r.op === 'truthy') return truthy(a)
	if (r.op === 'falsy') return !truthy(a)
	if (r.op === 'eq') return a === r.value
	if (r.op === 'ne') return a !== r.value
	const [x, y] = [Number(a), Number(r.value)]
	if (typeof a === 'boolean' || a === null || a === undefined || !Number.isFinite(x) || !Number.isFinite(y))
		return false
	return r.op === 'gt' ? x > y : r.op === 'gte' ? x >= y : r.op === 'lt' ? x < y : x <= y
}

// "Temp: {temp} C" → "Temp: 21.5 C". Una variable ausente o null se queda en ''.
const SLOT = /\{([^{}]{1,40})\}/g
export const formatText = (format: string, values: DisplayValues) =>
	format.replace(SLOT, (_, key: string) => (has(values, key) ? String(values[key] ?? '') : ''))

// Variables de los datos que lee la plantilla (bind, binds, huecos de format y claves de when), sin repetir.
export function templateVariables(t: Pick<DisplayTemplate, 'elements' | 'animation'>): string[] {
	const keys = new Set<string>()
	const slots = (f: unknown) => typeof f === 'string' && [...f.matchAll(SLOT)].forEach((m) => keys.add(m[1]!))
	for (const e of [...t.elements, ...(t.animation?.frames.flatMap((f) => f.elements) ?? [])]) {
		if ('bind' in e && typeof e.bind === 'string') keys.add(e.bind)
		Object.values(e.binds ?? {}).forEach((k) => keys.add(k))
		slots('format' in e && e.format)
		for (const r of e.when ?? []) {
			keys.add(r.key)
			slots(r.set.format)
		}
	}
	return [...keys]
}

// Orden: propiedades base → `bind` (atajo de binds.value) → `binds` → `when` en orden (cada regla que se cumple
// fusiona su `set`) → `visible: false` lo oculta (null) → `format` da el texto final en `value`.
// El resultado ya no tiene bind/binds/when: `value` es lo que se dibuja.
export type ResolvedElement = DisplayElement & Record<string, unknown>
export function resolveElement(e: DisplayElement, values: DisplayValues): ResolvedElement | null {
	const { binds, when, ...out } = e as DisplayElement & Record<string, unknown>
	const o = out as Record<string, unknown>
	if (typeof o.bind === 'string') {
		o.value = has(values, o.bind) ? values[o.bind] : undefined
		delete o.bind
	}
	for (const [prop, key] of Object.entries(binds ?? {})) {
		const v = has(values, key) ? coerce(prop, values[key]!) : undefined
		if (v !== undefined) o[prop] = v
	}
	for (const r of when ?? []) if (testRule(r, values)) Object.assign(o, r.set)
	if (o.visible === false) return null
	if (typeof o.format === 'string') o.value = formatText(o.format, values)
	return o as ResolvedElement
}

// Índice del fotograma que toca a los `elapsedMs` de empezar. repeat 0 (o ausente) = siempre;
// al acabar las vueltas se queda en el último.
export function currentFrame(animation: Animation, elapsedMs: number): number {
	const total = animation.frames.reduce((s, f) => s + f.ms, 0)
	const repeat = animation.repeat ?? 0
	if (repeat > 0 && elapsedMs >= total * repeat) return animation.frames.length - 1
	let t = elapsedMs % total
	for (const [i, f] of animation.frames.entries()) {
		if (t < f.ms) return i
		t -= f.ms
	}
	return animation.frames.length - 1
}
