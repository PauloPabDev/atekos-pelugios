import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { base, detail, inicio, mockDisplay, noche, page } from '../../test/display'
import { renderApp } from '../../test/utils'

test('la activa va marcada y no se borra; las demás se activan o se borran con confirmación', async () => {
	let templates = [inicio, noche]
	const calls: string[] = []
	mockDisplay({
		[`GET ${base}`]: () => ({ body: { ...detail, templates: templates.map(({ id, version }) => ({ id, version })) } }),
		[`GET ${base}/templates`]: () => ({ body: templates }),
		[`PATCH ${base}`]: (init) => {
			calls.push(`PATCH ${String(init?.body)}`)
			return { body: detail }
		},
		[`DELETE ${base}/templates/noche`]: () => {
			calls.push('DELETE noche')
			templates = [inicio]
			return { status: 204 }
		},
	})
	renderApp(`${page}/plantillas`)

	expect(await screen.findByText('Activa')).toBeInTheDocument()
	expect(screen.getByRole('link', { name: 'Editar «inicio»' })).toHaveAttribute('href', `${page}/plantillas/inicio`)
	expect(screen.queryByRole('button', { name: /«inicio»/ })).toBeNull()
	expect(screen.getByRole('link', { name: 'Nueva plantilla' })).toHaveAttribute('href', `${page}/plantillas/nueva`)

	await userEvent.click(screen.getByRole('button', { name: 'Activar «noche»' }))
	expect(await screen.findByText('Plantilla activada.')).toBeInTheDocument()
	expect(calls).toEqual(['PATCH {"activeTemplateId":"noche"}'])

	await userEvent.click(screen.getByRole('button', { name: 'Borrar… «noche»' }))
	expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
	await userEvent.click(screen.getByRole('button', { name: 'Sí, borrar' }))
	expect(await screen.findByRole('heading', { name: 'Plantillas' })).toHaveFocus()
	expect(calls).toEqual(['PATCH {"activeTemplateId":"noche"}', 'DELETE noche'])
	expect(screen.queryByText('noche')).toBeNull()
})
