import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import { decodeImage, displaySize, encodeImage } from '@atekos/shared'
import { Icon } from '../../components/Icon'
import { Problems } from '../../components/Problems'
import { checkBox, draftImages, fitRect, floodFill, hexRgb, parseDraft, placeImage, toHex, toRGBA } from './canvas'
import type { Fit } from './canvas'

// La capa de dibujo mide siempre el lado máximo: cambiar el ancho o el alto recorta la vista, no lo dibujado
const LAYER = 320
const UNDO = 30
const BIG = 100 * 1024
const TOOLS = [
	['pencil', 'Lápiz'],
	['eraser', 'Borrador'],
	['line', 'Línea'],
	['rect', 'Rectángulo'],
	['ellipse', 'Elipse'],
	['fill', 'Bote'],
	['picker', 'Cuentagotas'],
	['move', 'Mover'],
] as const
type Tool = (typeof TOOLS)[number][0]
const FITS = [
	['contain', 'Ajustar'],
	['cover', 'Rellenar'],
	['fill', 'Estirar'],
] as const
const PALETTE = [
	['#000000', 'Negro'],
	['#ffffff', 'Blanco'],
	['#ff5050', 'Rojo'],
	['#ffd166', 'Amarillo'],
	['#66f3bf', 'Verde'],
	['#4f8bff', 'Azul'],
	['#9568ff', 'Morado'],
] as const
const ARROWS: Record<string, [number, number]> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
}

type Pt = { x: number; y: number }
type Box = Record<'x' | 'y' | 'w' | 'h', string>
const kb = (bytes: number) => `${(bytes / 1024).toLocaleString('es', { maximumFractionDigits: 1 })} KB`

// Editor de imagen y dibujo en un <dialog> modal: fondo + foto encajada + capa de dibujo → un elemento image del
// borrador (nuevo, o en lugar del que se edita). text/setText son los del editor de plantillas.
export function ImageCanvas({
	text,
	setText,
	onClose,
}: {
	text: string
	setText: (t: string) => void
	onClose: () => void
}) {
	const draft = useMemo(() => parseDraft(text), [text])
	const images = useMemo(() => draftImages(draft), [draft])
	const screen = displaySize(typeof draft?.rotation === 'number' ? draft.rotation : 0)
	const full: Box = { x: '0', y: '0', w: String(screen.width), h: String(screen.height) }
	const half = Math.floor(screen.height / 2)

	const [box, setBox] = useState(full)
	const [editing, setEditing] = useState<number | null>(null)
	const [photo, setPhoto] = useState<ImageBitmap | HTMLCanvasElement | null>(null)
	const [fit, setFit] = useState<Fit>('contain')
	const [zoom, setZoom] = useState(100)
	const [offset, setOffset] = useState<Pt>({ x: 0, y: 0 })
	const [bg, setBg] = useState('#000000')
	const [tool, setTool] = useState<Tool>('pencil')
	const [color, setColor] = useState('#ffffff')
	const [size, setSize] = useState(2)
	const [filled, setFilled] = useState(false)
	const [background, setBackground] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [result, setResult] = useState<ReturnType<typeof encodeImage> | null>(null)
	// Sube con cada cambio en la capa de dibujo: re-codifica y refresca deshacer/rehacer (las pilas van en refs)
	const [rev, setRev] = useState(0)
	const dialog = useRef<HTMLDialogElement>(null)
	const view = useRef<HTMLCanvasElement>(null)
	const undo = useRef<ImageData[]>([])
	const redo = useRef<ImageData[]>([])
	const drag = useRef<{ from: Pt; last: Pt; offset: Pt } | null>(null)
	// Fuera del DOM; sin canvas 2D (jsdom, algún navegador raro) queda en null y el lienzo solo avisa
	const [layer] = useState(() => {
		const c = document.createElement('canvas')
		c.width = c.height = LAYER
		return c.getContext('2d', { willReadFrequently: true })
	})

	const n = { x: Number(box.x), y: Number(box.y), w: Number(box.w), h: Number(box.h) }
	const problem = checkBox(n, screen)
	// El canvas necesita un tamaño válido aunque lo tecleado aún no lo sea
	const w = Math.min(Math.max(Math.round(n.w) || 1, 1), LAYER)
	const h = Math.min(Math.max(Math.round(n.h) || 1, 1), LAYER)

	useEffect(() => {
		if (!dialog.current?.open) dialog.current?.showModal()
	}, [])

	// Fondo + foto + dibujo en el canvas visible, a resolución real; null sin canvas 2D
	function compose() {
		const v = view.current?.getContext('2d', { willReadFrequently: true })
		if (!v || !layer) return null
		v.fillStyle = bg
		v.fillRect(0, 0, w, h)
		if (photo) {
			const r = fitRect(fit, photo, { width: w, height: h }, zoom / 100, offset)
			v.drawImage(photo, r.x, r.y, r.w, r.h)
		}
		v.drawImage(layer.canvas, 0, 0)
		return v
	}
	// Antes de pintar: al cambiar width/height el canvas se vacía y no debe verse en blanco
	useLayoutEffect(() => void compose())

	// Codificar 55 040 píxeles en cada movimiento del zoom sería caro: espera a que pare
	useEffect(() => {
		const t = setTimeout(() => {
			const v = compose()
			setResult(v && encodeImage(v.getImageData(0, 0, w, h).data, w, h))
		}, 300)
		return () => clearTimeout(t)
	}, [w, h, photo, fit, zoom, offset, bg, rev]) // lo que lee compose, más rev para lo dibujado

	function snapshot() {
		if (!layer) return
		undo.current = [...undo.current.slice(1 - UNDO), layer.getImageData(0, 0, LAYER, LAYER)]
		redo.current = []
	}
	function commit() {
		compose()
		setRev((r) => r + 1)
	}
	function step(from: RefObject<ImageData[]>, to: RefObject<ImageData[]>) {
		const img = from.current.pop()
		if (!img || !layer) return
		to.current.push(layer.getImageData(0, 0, LAYER, LAYER))
		layer.putImageData(img, 0, 0)
		commit()
	}

	// Puntero → centro del píxel del lienzo (así un trazo de 1 px cae justo en una fila o columna)
	function point(e: PointerEvent<HTMLCanvasElement>): Pt {
		const r = e.currentTarget.getBoundingClientRect()
		const px = (v: number, max: number) => Math.min(Math.max(Math.floor(v), 0), max - 1) + 0.5
		return { x: px(((e.clientX - r.left) * w) / r.width, w), y: px(((e.clientY - r.top) * h) / r.height, h) }
	}

	// La herramienta actual de a a b; el lápiz y el borrador son muchos tramos cortos seguidos
	function shape(c: CanvasRenderingContext2D, a: Pt, b: Pt) {
		c.strokeStyle = c.fillStyle = color
		c.lineWidth = size
		c.lineCap = 'round'
		c.lineJoin = 'round'
		c.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
		c.beginPath()
		if (tool === 'rect') c.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
		else if (tool === 'ellipse')
			c.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, 2 * Math.PI)
		else if (a.x === b.x && a.y === b.y) {
			// Un toque sin arrastrar: el lienzo no pinta las líneas de largo 0
			c.rect(a.x - size / 2, a.y - size / 2, size, size)
			return c.fill()
		} else {
			c.moveTo(a.x, a.y)
			c.lineTo(b.x, b.y)
		}
		if (filled && (tool === 'rect' || tool === 'ellipse')) c.fill()
		else c.stroke()
	}

	function down(e: PointerEvent<HTMLCanvasElement>) {
		const v = compose()
		if (!v || !layer || e.button > 0) return
		const p = point(e)
		const [x, y] = [Math.floor(p.x), Math.floor(p.y)]
		if (tool === 'picker') {
			const [r = 0, g = 0, b = 0] = v.getImageData(x, y, 1, 1).data
			setColor(toHex(r, g, b))
			return setTool('pencil')
		}
		if (tool === 'fill') {
			// La zona se busca en lo que se ve (foto incluida), pero se pinta en la capa de dibujo
			snapshot()
			const paint = layer.getImageData(0, 0, w, h)
			floodFill(v.getImageData(0, 0, w, h).data, paint.data, w, h, x, y, hexRgb(color))
			layer.putImageData(paint, 0, 0)
			return commit()
		}
		e.currentTarget.setPointerCapture(e.pointerId)
		drag.current = { from: p, last: p, offset }
		if (tool === 'move') return
		snapshot()
		if (tool === 'pencil' || tool === 'eraser') {
			shape(layer, p, p)
			compose()
		}
	}

	function move(e: PointerEvent<HTMLCanvasElement>) {
		const d = drag.current
		if (!d || !layer) return
		const p = point(e)
		const last = d.last
		d.last = p
		if (tool === 'move') setOffset({ x: d.offset.x + p.x - d.from.x, y: d.offset.y + p.y - d.from.y })
		else if (tool === 'pencil' || tool === 'eraser') {
			shape(layer, last, p)
			compose()
		} else {
			// Vista previa de la figura: el siguiente compose la borra
			const v = compose()
			if (v) shape(v, d.from, p)
		}
	}

	function up() {
		const d = drag.current
		drag.current = null
		if (!d || !layer || tool === 'move') return
		if (tool !== 'pencil' && tool !== 'eraser') shape(layer, d.from, d.last)
		commit()
	}

	// Las flechas mueven la foto (Mayús: de 10 en 10): la alternativa por teclado a arrastrar con «Mover»
	function nudge(e: KeyboardEvent) {
		const d = ARROWS[e.key]
		if (!d || !photo) return
		e.preventDefault()
		const k = e.shiftKey ? 10 : 1
		setOffset((o) => ({ x: o.x + d[0] * k, y: o.y + d[1] * k }))
	}

	// Ctrl/⌘+Z deshace y Ctrl+Y o Ctrl+Mayús+Z rehace, salvo en un campo (que tiene su propio deshacer)
	function shortcut(e: KeyboardEvent) {
		const k = e.key.toLowerCase()
		if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).closest('input, select, textarea')) return
		if (k === 'z' && !e.shiftKey) step(undo, redo)
		else if (k === 'y' || k === 'z') step(redo, undo)
		else return
		e.preventDefault()
	}

	function clear() {
		snapshot()
		layer?.clearRect(0, 0, LAYER, LAYER)
		commit()
	}

	async function importFile(f: File) {
		setError(null)
		try {
			setPhoto(await createImageBitmap(f))
			setFit('contain')
			setZoom(100)
			setOffset({ x: 0, y: 0 })
		} catch {
			setError('No se pudo leer la imagen: prueba con un PNG o un JPG.')
		}
	}

	// Una imagen del borrador pasa a ser la foto, a 1:1 en su sitio y su tamaño; el dibujo empieza en blanco
	function edit(index: number | null) {
		setEditing(index)
		const img = images.find((i) => i.index === index)
		if (!img) return
		setBox({ x: String(img.x), y: String(img.y), w: String(img.w), h: String(img.h) })
		const px = decodeImage(img.encoding, img.data, img.w, img.h)
		if (!layer || !px) return
		const c = document.createElement('canvas')
		c.width = img.w
		c.height = img.h
		c.getContext('2d')?.putImageData(new ImageData(toRGBA(px), img.w, img.h), 0, 0)
		setPhoto(c)
		setFit('contain')
		setZoom(100)
		setOffset({ x: 0, y: 0 })
		clear()
	}

	function insert() {
		const v = compose()
		if (!v || problem) return
		const image = { ...n, ...encodeImage(v.getImageData(0, 0, w, h).data, w, h) }
		const r = placeImage(text, image, { replace: editing ?? undefined, background })
		if ('error' in r) return setError(r.error)
		setText(r.text)
		dialog.current?.close()
	}

	const tabs = 'btn btn-secondary aria-pressed:border-brand aria-pressed:bg-brand-soft aria-pressed:text-brand-hover'
	return (
		// Sin margen (preflight de Tailwind) el modal no se centra: m-auto
		<dialog
			ref={dialog}
			aria-labelledby="canvas-title"
			onClose={onClose}
			onKeyDown={shortcut}
			className="m-auto h-[calc(100svh-1rem)] max-h-none w-[calc(100vw-1rem)] max-w-6xl rounded-xl border border-line bg-canvas text-fg shadow-xl backdrop:bg-zinc-950/50 sm:h-[calc(100svh-4rem)]"
		>
			<div className="flex h-full flex-col">
				<header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface py-2 pr-2 pl-4">
					<h2 id="canvas-title" className="mr-auto">
						Lienzo e imagen
					</h2>
					{images.length > 0 && (
						<select
							aria-label="Imagen"
							value={editing ?? ''}
							onChange={(e) => edit(e.target.value === '' ? null : Number(e.target.value))}
							className="w-auto max-sm:order-last max-sm:mb-1 max-sm:w-full"
						>
							<option value="">Nueva imagen</option>
							{images.map((img, k) => (
								<option key={img.index} value={img.index}>
									Editar imagen n.º {k + 1} ({img.x},{img.y} {img.w}×{img.h})
								</option>
							))}
						</select>
					)}
					<button
						type="button"
						aria-label="Cerrar"
						className="btn btn-icon btn-ghost"
						onClick={() => dialog.current?.close()}
					>
						<Icon name="x" size={20} />
					</button>
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6">
					<div className="space-y-3">
						{!layer && (
							<p role="alert" className="alert alert-warning">
								Este navegador no permite dibujar en un canvas 2D: el lienzo no funciona aquí.
							</p>
						)}
						<div role="group" aria-label="Herramienta" className="grid grid-cols-4 gap-1 sm:flex sm:flex-wrap">
							{TOOLS.map(([t, label]) => (
								<button
									key={t}
									type="button"
									aria-pressed={tool === t}
									onClick={() => setTool(t)}
									className={`${tabs} px-1 max-sm:text-xs sm:px-3`}
								>
									{label}
								</button>
							))}
						</div>
						<div className="flex flex-wrap items-end gap-x-4 gap-y-2">
							<label className="field">
								Color
								<input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-14 p-1" />
							</label>
							<div role="group" aria-label="Paleta" className="flex gap-1 pb-1 sm:pb-0">
								{PALETTE.map(([c, name]) => (
									<button
										key={c}
										type="button"
										aria-label={name}
										aria-pressed={color === c}
										onClick={() => setColor(c)}
										className="size-9 cursor-pointer rounded-md border border-line-strong aria-pressed:ring-2 aria-pressed:ring-brand aria-pressed:ring-offset-1"
										style={{ background: c }}
									/>
								))}
							</div>
							<label className="field w-36">
								Grosor: {size} px
								<input type="range" min={1} max={32} value={size} onChange={(e) => setSize(Number(e.target.value))} />
							</label>
							<label className="check">
								<input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} />
								Rectángulo y elipse rellenos
							</label>
						</div>
						<div className="-ml-3 flex flex-wrap">
							<button
								type="button"
								className="btn btn-ghost"
								disabled={!undo.current.length}
								onClick={() => step(undo, redo)}
							>
								Deshacer
							</button>
							<button
								type="button"
								className="btn btn-ghost"
								disabled={!redo.current.length}
								onClick={() => step(redo, undo)}
							>
								Rehacer
							</button>
							<button type="button" className="btn btn-ghost" disabled={!layer} onClick={clear}>
								Borrar dibujo
							</button>
						</div>
						{/* A resolución real y ampliado por CSS sin suavizar; el ancho manda y el alto sale de la proporción */}
						<canvas
							ref={view}
							width={w}
							height={h}
							role="img"
							tabIndex={0}
							aria-label={`Lienzo de ${w}×${h} px`}
							aria-describedby="canvas-hint"
							onPointerDown={down}
							onPointerMove={move}
							onPointerUp={up}
							onPointerCancel={up}
							onKeyDown={nudge}
							className="mx-auto block h-auto touch-none border border-line-strong"
							style={{
								width: `min(100%, ${(52 * w) / h}svh)`,
								imageRendering: 'pixelated',
								cursor: tool === 'move' ? 'move' : 'crosshair',
							}}
						/>
						<small id="canvas-hint" className="block text-center">
							Dibuja con el ratón, el dedo o un lápiz. Con «Mover» arrastras la foto; con el lienzo enfocado, las
							flechas también la mueven (Mayús: de 10 en 10).
						</small>
					</div>

					<div className="mt-6 space-y-4 lg:mt-0">
						<fieldset className="space-y-3">
							<legend>Tamaño y posición</legend>
							<div className="grid grid-cols-4 gap-2">
								{(
									[
										['x', 'x'],
										['y', 'y'],
										['w', 'Ancho'],
										['h', 'Alto'],
									] as const
								).map(([k, label]) => (
									<label key={k} className="field">
										{label}
										<input
											type="number"
											inputMode="numeric"
											min={k === 'w' || k === 'h' ? 1 : 0}
											max={LAYER}
											value={box[k]}
											aria-invalid={!!problem}
											aria-describedby="box-hint"
											onChange={(e) => setBox({ ...box, [k]: e.target.value })}
										/>
									</label>
								))}
							</div>
							<div className="-ml-3 flex flex-wrap">
								<button type="button" className="btn btn-ghost" onClick={() => setBox(full)}>
									Pantalla completa
								</button>
								<button type="button" className="btn btn-ghost" onClick={() => setBox({ ...full, h: String(half) })}>
									Mitad superior
								</button>
								<button
									type="button"
									className="btn btn-ghost"
									onClick={() => setBox({ ...full, y: String(screen.height - half), h: String(half) })}
								>
									Mitad inferior
								</button>
							</div>
							<small id="box-hint" className="block">
								En píxeles de la pantalla, que mide {screen.width}×{screen.height}. El lienzo es ese ancho y alto.
							</small>
							<Problems lines={problem ? [problem] : []} />
						</fieldset>

						<fieldset className="space-y-3">
							<legend>Foto</legend>
							<label className="field">
								Archivo
								<input
									type="file"
									accept="image/*"
									onChange={(e) => {
										const f = e.target.files?.[0]
										e.target.value = '' // permite volver a elegir el mismo archivo
										if (f) void importFile(f)
									}}
								/>
							</label>
							<div
								role="radiogroup"
								aria-label="Encaje"
								className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-subtle p-1"
							>
								{FITS.map(([f, label]) => (
									<label
										key={f}
										className="grid h-11 cursor-pointer place-items-center rounded-md text-sm font-medium text-fg-muted has-checked:bg-surface has-checked:text-fg has-checked:shadow-xs has-disabled:cursor-not-allowed has-disabled:opacity-50 has-focus-visible:outline-2 has-focus-visible:outline-brand sm:h-9"
									>
										<input
											type="radio"
											name="fit"
											className="sr-only"
											checked={fit === f}
											disabled={!photo}
											onChange={() => setFit(f)}
										/>
										{label}
									</label>
								))}
							</div>
							<label className="field">
								Zoom: {zoom} %
								<input
									type="range"
									min={10}
									max={400}
									step={5}
									value={zoom}
									disabled={!photo}
									onChange={(e) => setZoom(Number(e.target.value))}
								/>
							</label>
							<div className="flex flex-wrap items-end gap-3">
								<button
									type="button"
									className="btn btn-secondary"
									disabled={!photo}
									onClick={() => setOffset({ x: 0, y: 0 })}
								>
									Centrar
								</button>
								<label className="field">
									Fondo
									<input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="w-14 p-1" />
								</label>
							</div>
							<small className="block">
								«Ajustar» la deja entera con bandas del color de fondo, «Rellenar» cubre el lienzo recortando lo que
								sobra y «Estirar» la deforma. Lo dibujado no se pierde al cambiarlo.
							</small>
						</fieldset>
					</div>
				</div>

				<footer className="space-y-2 border-t border-line bg-surface px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
					<Problems lines={error ? [error] : []} />
					{result && result.data.length > BIG && (
						<p className="alert alert-warning">
							Ocupa {kb(result.data.length)}: la plantilla tardará más en llegar a la pantalla. Reduce el tamaño o usa
							colores planos, que se comprimen mejor.
						</p>
					)}
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
						<p className="mr-auto text-sm text-fg-muted" aria-live="polite">
							{result && (
								<>
									<code>{result.encoding}</code> · {kb(result.data.length)} en la plantilla
								</>
							)}
						</p>
						{editing === null && (
							<label className="check">
								<input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} />
								Como fondo (debajo de todo)
							</label>
						)}
						<div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
							<button type="button" className="btn btn-secondary" onClick={() => dialog.current?.close()}>
								Cancelar
							</button>
							<button type="button" className="btn btn-primary" disabled={!layer || !!problem} onClick={insert}>
								{editing === null ? 'Añadir a la plantilla' : 'Reemplazar imagen'}
							</button>
						</div>
					</div>
				</footer>
			</div>
		</dialog>
	)
}
