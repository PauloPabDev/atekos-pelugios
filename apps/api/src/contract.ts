import { metaDisplayAsyncApi, metaDisplayOpenApi } from '@atekos/shared/contract'

// Contrato MetaDisplay (docs/metadisplay/README.md) tal como lo publica este despliegue: la REST y el MCP.
const build = { 'asyncapi.json': metaDisplayAsyncApi, 'openapi.json': metaDisplayOpenApi }
export type ContractFile = keyof typeof build
export const CONTRACT_FILES = Object.keys(build) as ContractFile[]

const cache = new Map<string, string>()
// Se genera una vez por origen: los esquemas no cambian mientras el proceso vive.
export function contractJson(file: ContractFile, origin: string) {
	const key = `${file} ${origin}`
	let json = cache.get(key)
	if (!json) {
		if (cache.size >= 8) cache.clear() // sin PUBLIC_URL el origen sale del Host del cliente: que no crezca sin límite
		cache.set(key, (json = JSON.stringify(build[file](origin))))
	}
	return json
}
