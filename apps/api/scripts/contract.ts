// pnpm contract: regenera docs/metadisplay/generado/ desde los esquemas de @atekos/shared (fuente de verdad).
// Si el contenido cambia y METADISPLAY_CONTRACT.version no, se niega: cada cambio del contrato lleva versión y fecha.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { METADISPLAY_CONTRACT, metaDisplayAsyncApi, metaDisplayOpenApi } from '@atekos/shared/contract'

const ORIGIN = 'https://atekos.toxolinko.site' // el despliegue público; la API sirve el suyo con PUBLIC_URL
const dir = new URL('../../../docs/metadisplay/generado/', import.meta.url)
const files = { 'asyncapi.json': metaDisplayAsyncApi(ORIGIN), 'openapi.json': metaDisplayOpenApi(ORIGIN) }

type Doc = { info: Record<string, unknown> }
const content = (d: Doc) => JSON.stringify({ ...d, info: { ...d.info, version: null, 'x-updated': null } })

mkdirSync(dir, { recursive: true })
for (const [name, doc] of Object.entries(files)) {
	const file = new URL(name, dir)
	const old = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Doc) : null
	if (old && content(old) !== content(doc as Doc) && old.info.version === METADISPLAY_CONTRACT.version) {
		console.error(
			`${name} cambia pero la versión sigue en ${METADISPLAY_CONTRACT.version}: sube METADISPLAY_CONTRACT.version y updatedAt en packages/shared/src/contract.ts`,
		)
		process.exit(1)
	}
	writeFileSync(file, `${JSON.stringify(doc, null, '\t')}\n`)
	console.log(
		`docs/metadisplay/generado/${name} · v${METADISPLAY_CONTRACT.version} (${METADISPLAY_CONTRACT.updatedAt})`,
	)
}
