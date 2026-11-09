import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { DisplayTemplate, encodeBase64, type DisplayElement } from '@atekos/shared'
import { DisplayPreview } from './DisplayPreview'
import { goalData, goalTemplate, showcaseData, showcaseTemplate, statusTemplate } from '../examples'
import goalJson from '../../../../docs/metadisplay/examples/goal-template.json'
import statusJson from '../../../../docs/metadisplay/examples/status-template.json'
import goalDataJson from '../../../../docs/metadisplay/examples/goal-data.json'
import showcaseJson from '../../../../docs/metadisplay/examples/showcase-template.json'
import showcaseDataJson from '../../../../docs/metadisplay/examples/showcase-data.json'

const tpl = (elements: DisplayElement[], extra: Partial<DisplayTemplate> = {}): DisplayTemplate => ({
	id: 't',
	version: 1,
	elements,
	actions: [],
	...extra,
})

test('text con bind muestra el valor de values; sin la clave, vacío', () => {
	render(
		<DisplayPreview
			template={tpl([
				{ type: 'text', x: 10, y: 10, bind: 'msg' },
				{ type: 'text', x: 10, y: 30, bind: 'falta', value: 'NO' },
				{ type: 'text', x: 10, y: 50, bind: 'toString' },
			])}
			values={{ msg: 'HOLA' }}
		/>,
	)
	const [msg, missing, inherited] = screen.getByRole('img').querySelectorAll('text')
	expect(msg).toHaveTextContent('HOLA')
	expect(msg).toHaveAttribute('dominant-baseline', 'hanging')
	expect(msg).toHaveAttribute('font-size', '8')
	expect(missing).toHaveTextContent(/^$/)
	expect(inherited).toHaveTextContent(/^$/)
})

test('progress: 50 sobre w 152 rellena 76; 150 se recorta a 152', () => {
	const bar = (v: number) => {
		const { container, unmount } = render(
			<DisplayPreview
				template={tpl([{ type: 'progress', x: 10, y: 10, w: 152, h: 12, bind: 'p' }])}
				values={{ p: v }}
			/>,
		)
		// rects: fondo de la pantalla, fondo de la barra, relleno
		const width = container.querySelectorAll('rect')[2]?.getAttribute('width')
		unmount()
		return width
	}
	expect(bar(50)).toBe('76')
	expect(bar(150)).toBe('152')
	expect(bar(-5)).toBe('0')
})

test('background llena el fondo; sin background es negro', () => {
	const { container, rerender } = render(<DisplayPreview template={tpl([], { background: '#090D18' })} values={{}} />)
	const bg = () => container.querySelector('rect')
	expect(bg()).toHaveAttribute('fill', '#090D18')
	expect(bg()).toHaveAttribute('width', '172')
	expect(bg()).toHaveAttribute('height', '320')
	rerender(<DisplayPreview template={tpl([])} values={{}} />)
	expect(bg()).toHaveAttribute('fill', '#000000')
})

test('showActions dibuja las zonas táctiles con su id y mode', () => {
	const { container, rerender } = render(<DisplayPreview template={goalTemplate} values={goalData} />)
	expect(container.querySelector('.actions')).toBeNull()
	rerender(<DisplayPreview template={goalTemplate} values={goalData} showActions />)
	const zones = container.querySelectorAll('.actions rect')
	expect(zones).toHaveLength(2)
	expect(zones[0]).toHaveAttribute('stroke-dasharray')
	expect(within(container.querySelector('.actions')!).getByText('go-status (remote)')).toBeInTheDocument()
	expect(screen.getByText('ACTUALIZAR')).toHaveAttribute('text-anchor', 'middle')
	expect(screen.getByText(/aproximada/)).toBeInTheDocument()
})

test('los ejemplos copiados son válidos e iguales a los de docs/metadisplay/examples', () => {
	expect(DisplayTemplate.safeParse(goalTemplate).success).toBe(true)
	expect(DisplayTemplate.safeParse(statusTemplate).success).toBe(true)
	expect(goalTemplate).toEqual(goalJson)
	expect(statusTemplate).toEqual(statusJson)
	expect(goalData).toEqual(goalDataJson)
	expect(DisplayTemplate.safeParse(showcaseTemplate).success).toBe(true)
	expect(showcaseTemplate).toEqual(showcaseJson)
	expect(showcaseData).toEqual(showcaseDataJson)
})

test('rotation 90 da un lienzo horizontal de 320×172', () => {
	const { container } = render(<DisplayPreview template={tpl([], { rotation: 90 })} values={{}} />)
	const svg = screen.getByRole('img')
	expect(svg).toHaveAttribute('viewBox', '0 0 320 172')
	expect(svg).toHaveAttribute('width', '640')
	expect(container.querySelector('rect')).toHaveAttribute('width', '320')
})

test('formas nuevas: círculo relleno, polilínea abierta, curva cúbica y grosor', () => {
	const { container } = render(
		<DisplayPreview
			template={tpl([
				{ type: 'circle', x: 50, y: 50, r: 10, filled: true, fillColor: '#FF0000' },
				{
					type: 'polygon',
					points: [
						[0, 0],
						[10, 10],
						[20, 0],
					],
					closed: false,
					color: '#00FF00',
					stroke: 3,
				},
				{
					type: 'curve',
					points: [
						[0, 0],
						[10, 10],
						[20, 10],
						[30, 0],
					],
					stroke: 2,
				},
				{ type: 'arc', x: 80, y: 80, r: 20, start: 0, end: 90 },
			])}
			values={{}}
		/>,
	)
	expect(container.querySelector('circle')).toHaveAttribute('fill', '#FF0000')
	expect(container.querySelector('circle')).toHaveAttribute('r', '10')
	expect(container.querySelector('polyline')).toHaveAttribute('stroke-width', '3')
	expect(container.querySelector('polyline')).toHaveAttribute('fill', 'none')
	expect(container.querySelector('path')?.getAttribute('d')).toMatch(/^M 0 0 C /)
	expect(container.querySelectorAll('path')[1]?.getAttribute('d')).toMatch(/^M 100\.5 80\.5 A 20 20 0 0 1 /)
})

test('image se dibuja como BMP en un data: URL; si data no cuadra con w×h, no se dibuja', () => {
	// 2×2 en RLE: un tramo de 4 píxeles rojos
	const data = encodeBase64(Uint8Array.of(3, 0xf8, 0))
	const img: DisplayElement = { type: 'image', x: 1, y: 2, w: 2, h: 2, encoding: 'rgb565-rle', data }
	const { container, rerender } = render(<DisplayPreview template={tpl([img])} values={{}} />)
	const href = container.querySelector('image')?.getAttribute('href') ?? ''
	expect(href).toMatch(/^data:image\/bmp;base64,Qk/) // «BM»
	const bytes = Uint8Array.from(atob(href.split(',')[1]!), (c) => c.charCodeAt(0))
	expect([...bytes.slice(54, 57)]).toEqual([0, 0, 255]) // BGR del primer píxel: rojo
	rerender(<DisplayPreview template={tpl([{ ...img, w: 3 } as DisplayElement])} values={{}} />)
	expect(container.querySelector('image')).toBeNull()
})

test('capa dinámica: format, binds y when que oculta, todo con las variables de los datos', () => {
	render(
		<DisplayPreview
			template={tpl([
				{ type: 'text', x: 1, y: 1, format: 'T: {temp} C' },
				{ type: 'text', x: 1, y: 20, value: 'ALARMA', when: [{ key: 'ok', op: 'truthy', set: { visible: false } }] },
				{ type: 'text', x: 1, y: 40, value: 'x', binds: { color: 'c' } },
			])}
			values={{ temp: 21, ok: true, c: '#123456' }}
		/>,
	)
	expect(screen.getByText('T: 21 C')).toBeInTheDocument()
	expect(screen.queryByText('ALARMA')).toBeNull()
	expect(screen.getByText('x')).toHaveAttribute('fill', '#123456')
})

test('frame elige el fotograma de la animación, que se dibuja encima de los elementos', () => {
	const t = tpl([{ type: 'text', x: 1, y: 1, value: 'BASE' }], {
		animation: {
			frames: [
				{ ms: 100, elements: [{ type: 'text', x: 1, y: 20, value: 'UNO' }] },
				{ ms: 100, elements: [{ type: 'text', x: 1, y: 20, value: 'DOS' }] },
			],
		},
	})
	const { rerender } = render(<DisplayPreview template={t} values={{}} />)
	expect(screen.getByText('UNO')).toBeInTheDocument()
	rerender(<DisplayPreview template={t} values={{}} frame={1} />)
	expect(screen.getByText('DOS')).toBeInTheDocument()
	expect(screen.queryByText('UNO')).toBeNull()
	expect(screen.getByText('BASE')).toBeInTheDocument()
})

test('showActions marca en cian la zona de un botón físico y sin zona no dibuja nada', () => {
	const { container } = render(<DisplayPreview template={showcaseTemplate} values={{}} showActions />)
	const zones = container.querySelectorAll('.actions rect')
	expect(zones).toHaveLength(2) // pulsar (botón 0 corta) y tocar; restablecer no tiene zona
	expect(zones[0]).toHaveAttribute('stroke', '#00FFFF')
	expect(within(container.querySelector('.actions')!).getByText('pulsar: botón 0 (corta)')).toBeInTheDocument()
})

test('mini: el mismo dibujo, decorativo y sin pie', () => {
	const { container } = render(
		<DisplayPreview template={tpl([{ type: 'text', x: 10, y: 10, bind: 'msg' }])} values={{ msg: 'HOLA' }} mini />,
	)
	expect(screen.queryByRole('img')).toBeNull()
	expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
	expect(container.querySelector('text')).toHaveTextContent('HOLA')
	expect(container.querySelector('figcaption')).toBeNull()
})
