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

export const goalData: DisplayValues = {
	targetText: '$40.000.000',
	collectedText: '$2.500.000',
	progress: 6.25,
	daysText: 'DIA 4 / 120',
	percentageText: '6.25% COMPLETADO',
	serverStatus: 'EN LINEA',
}
