import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Sin `globals: true`, Testing Library no limpia sola entre tests
afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})
