import { defineConfig } from 'tsup'
export default defineConfig({
	entry: ['src/main.ts'],
	format: 'esm',
	target: 'node24',
	// Todo en dist/main.js para que la imagen no lleve node_modules; argon2 es un addon nativo (.node) y se copia aparte.
	noExternal: [/^(?!@node-rs\/argon2)/],
	// Las dependencias CommonJS empaquetadas en ESM llaman a require() de los módulos de Node.
	banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
	shims: true,
	clean: true,
})
