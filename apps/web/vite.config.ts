import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
	plugins: [react()],
	// En dev la web va detrás de Caddy en :8080 (§10.4), así que el HMR tiene que salir por ese puerto
	server: { host: true, port: 5173, hmr: { clientPort: 8080 } },
	test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
})
