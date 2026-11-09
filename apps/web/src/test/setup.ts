import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom no implementa scrollIntoView (SectionTabs centra la pestaña activa)
Element.prototype.scrollIntoView = () => {}

// Sin `globals: true`, Testing Library no limpia sola entre tests; los borradores (useDraft) tampoco pasan de uno a otro
afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	sessionStorage.clear()
})
