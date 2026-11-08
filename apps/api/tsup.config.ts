import { defineConfig } from 'tsup'
export default defineConfig({
	entry: ['src/main.ts'],
	format: 'esm',
	target: 'node24',
	noExternal: ['@atekos/shared'],
	clean: true,
})
