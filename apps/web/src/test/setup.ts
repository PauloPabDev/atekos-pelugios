import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom no implementa scrollIntoView (SectionTabs centra la pestaña activa)
Element.prototype.scrollIntoView = () => {}
// Ni <dialog> modal (el Lienzo del editor de plantillas): basta con abrirlo y avisar al cerrarlo
HTMLDialogElement.prototype.showModal = function () {
	this.open = true
}
HTMLDialogElement.prototype.close = function () {
	this.open = false
	this.dispatchEvent(new Event('close'))
}

// Sin `globals: true`, Testing Library no limpia sola entre tests; los borradores (useDraft) tampoco pasan de uno a otro
afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	sessionStorage.clear()
})
