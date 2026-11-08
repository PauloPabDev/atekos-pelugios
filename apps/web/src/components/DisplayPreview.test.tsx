import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { DisplayTemplate, type DisplayElement } from '@atekos/shared'
import { DisplayPreview } from './DisplayPreview'
import { goalData, goalTemplate, statusTemplate } from '../examples'
import goalJson from '../../../../docs/metadisplay/examples/goal-template.json'
import statusJson from '../../../../docs/metadisplay/examples/status-template.json'
import goalDataJson from '../../../../docs/metadisplay/examples/goal-data.json'

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
})
