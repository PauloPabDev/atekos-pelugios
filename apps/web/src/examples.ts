import type { DisplayTemplate, DisplayValues } from '@atekos/shared'

// Copia de docs/metadisplay/examples (la web no lee docs/): si cambian allí, hay que actualizarlos aquí

export const goalTemplate: DisplayTemplate = {
	id: 'goal.v1',
	version: 1,
	background: '#090D18',
	elements: [
		{ type: 'text', x: 10, y: 14, size: 2, color: '#FFFFFF', value: 'META' },
		{ type: 'text', x: 10, y: 48, size: 1, color: '#B2B9D2', value: 'OBJETIVO' },
		{ type: 'text', x: 10, y: 67, size: 2, color: '#B6A3FF', bind: 'targetText' },
		{ type: 'line', x: 10, y: 99, x2: 160, y2: 99, color: '#586180' },
		{ type: 'text', x: 10, y: 119, size: 1, color: '#B2B9D2', value: 'ACUMULADO' },
		{ type: 'text', x: 10, y: 143, size: 2, color: '#FFFFFF', bind: 'collectedText' },
		{ type: 'progress', x: 10, y: 188, w: 152, h: 13, color: '#D8D9E5', fillColor: '#9568FF', bind: 'progress' },
		{ type: 'text', x: 10, y: 215, size: 1, color: '#FFFFFF', bind: 'daysText' },
		{ type: 'text', x: 10, y: 236, size: 1, color: '#B2B9D2', bind: 'percentageText' },
		{
			type: 'button',
			x: 10,
			y: 271,
			w: 152,
			h: 36,
			size: 1,
			color: '#FFFFFF',
			fillColor: '#6240B4',
			value: 'ACTUALIZAR',
		},
		{ type: 'button', x: 48, y: 247, w: 76, h: 20, size: 1, color: '#FFFFFF', fillColor: '#26395A', value: 'ESTADO' },
	],
	actions: [
		{
			id: 'refresh',
			trigger: 'tap',
			x: 10,
			y: 271,
			w: 152,
			h: 36,
			mode: 'hybrid',
			event: 'data.refresh',
			local: { kind: 'feedback', message: 'Actualizando...' },
		},
		{ id: 'go-status', trigger: 'tap', x: 48, y: 247, w: 76, h: 20, mode: 'remote', event: 'screen.status.v1' },
	],
}

export const statusTemplate: DisplayTemplate = {
	id: 'status.v1',
	version: 2,
	background: '#06131B',
	elements: [
		{ type: 'text', x: 12, y: 22, size: 2, value: 'ESTADO', color: '#FFFFFF' },
		{ type: 'text', x: 12, y: 83, size: 1, value: 'SERVIDOR', color: '#95B2CA' },
		{ type: 'text', x: 12, y: 110, size: 2, bind: 'serverStatus', color: '#66F3BF' },
		{ type: 'text', x: 12, y: 170, size: 1, value: 'ULTIMO DATO', color: '#95B2CA' },
		{ type: 'text', x: 12, y: 195, size: 1, bind: 'daysText', color: '#FFFFFF' },
		{
			type: 'button',
			x: 12,
			y: 268,
			w: 148,
			h: 37,
			size: 1,
			value: 'VOLVER A META',
			color: '#FFFFFF',
			fillColor: '#245363',
		},
	],
	actions: [{ id: 'go-back', trigger: 'tap', x: 12, y: 268, w: 148, h: 37, mode: 'remote', event: 'screen.goal.v1' }],
}

// Ejemplo avanzado: horizontal, formas, curva, imagen, animación, variables con bind/binds/format/when y botones físicos
export const showcaseTemplate: DisplayTemplate = {
	id: 'showcase.v1',
	version: 1,
	rotation: 90,
	background: '#090D18',
	elements: [
		{ type: 'text', x: 10, y: 8, size: 2, color: '#FFFFFF', value: 'PANEL' },
		{
			type: 'image',
			x: 300,
			y: 4,
			w: 16,
			h: 16,
			encoding: 'rgb565-rle',
			data: 'EJNfBQhjAf//BQhjAZNfBQhjAf//BQhjAZNfBQhjAf//BQhjAZNfBQhjAf//BQhjAZNfBQhjAf//BQhjAZNfBQhjAf//BQhjAZNfDf//AZNfDf//AZNfBQhjAf//BQhjAZNfBQhjAf//BQhjAZNfBQhjAf//BQhjAZNfBQhjAf//BQhjAZNfBQhjAf//BQhjAZNfBQhjAf//BQhjEJNf',
		},
		{
			type: 'text',
			x: 10,
			y: 38,
			size: 2,
			color: '#B6A3FF',
			format: 'Temp: {temp} C',
			when: [{ key: 'temp', op: 'gt', value: 30, set: { color: '#FF5050' } }],
		},
		{ type: 'progress', x: 10, y: 66, w: 180, h: 12, color: '#26395A', fillColor: '#9568FF', bind: 'nivel' },
		{ type: 'text', x: 10, y: 84, size: 1, color: '#B2B9D2', format: 'Nivel {nivel}%' },
		{ type: 'line', x: 10, y: 102, x2: 190, y2: 102, color: '#586180', stroke: 2 },
		{ type: 'text', x: 10, y: 112, size: 1, color: '#FFFFFF', format: 'Estado: {estado}' },
		{
			type: 'curve',
			points: [
				[80, 160],
				[110, 120],
				[150, 168],
				[190, 130],
			],
			color: '#66F3BF',
			stroke: 2,
		},
		{
			type: 'polygon',
			points: [
				[12, 162],
				[32, 126],
				[52, 162],
			],
			filled: true,
			fillColor: '#FF5050',
			visible: false,
			binds: { visible: 'alarma' },
		},
		{
			type: 'text',
			x: 26,
			y: 148,
			size: 1,
			color: '#FFFFFF',
			value: '!',
			visible: false,
			when: [{ key: 'alarma', op: 'truthy', set: { visible: true } }],
		},
		{ type: 'circle', x: 260, y: 66, r: 44, color: '#26395A', stroke: 3 },
		{ type: 'arc', x: 260, y: 66, r: 36, start: -90, end: 90, color: '#9568FF', stroke: 6, binds: { end: 'angulo' } },
		{ type: 'ellipse', x: 260, y: 124, rx: 34, ry: 5, filled: true, fillColor: '#151E36' },
		{ type: 'rect', x: 204, y: 138, w: 112, h: 28, radius: 6, color: '#9568FF', stroke: 2 },
		{
			type: 'button',
			x: 206,
			y: 140,
			w: 108,
			h: 24,
			size: 1,
			color: '#FFFFFF',
			fillColor: '#6240B4',
			value: 'BOTON 0',
		},
	],
	animation: {
		repeat: 0,
		frames: [
			{ ms: 500, elements: [{ type: 'circle', x: 190, y: 14, r: 4, filled: true, fillColor: '#66F3BF' }] },
			{ ms: 500, elements: [] },
		],
	},
	actions: [
		{
			id: 'pulsar',
			trigger: 'button',
			button: 0,
			press: 'short',
			x: 204,
			y: 138,
			w: 112,
			h: 28,
			mode: 'hybrid',
			event: 'data.set',
			payload: { estado: 'PULSADO', alarma: true },
			local: { kind: 'feedback', message: 'Enviando...' },
		},
		{
			id: 'restablecer',
			trigger: 'button',
			button: 0,
			press: 'long',
			mode: 'remote',
			event: 'data.set',
			payload: { estado: 'OK', alarma: false },
		},
		{ id: 'tocar', trigger: 'tap', x: 204, y: 138, w: 112, h: 28, mode: 'remote', event: 'data.refresh' },
	],
}

export const goalData: DisplayValues = {
	targetText: '$40.000.000',
	collectedText: '$2.500.000',
	progress: 6.25,
	daysText: 'DIA 4 / 120',
	percentageText: '6.25% COMPLETADO',
	serverStatus: 'EN LINEA',
}

// Valores de las variables que usa showcaseTemplate
export const showcaseData: DisplayValues = { temp: 21, nivel: 40, angulo: 90, alarma: false, estado: 'OK' }
