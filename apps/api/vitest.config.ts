import { defineConfig } from 'vitest/config'

// Testcontainers descarga y arranca imágenes: los hooks pueden tardar.
export default defineConfig({ test: { hookTimeout: 180_000, testTimeout: 30_000 } })
