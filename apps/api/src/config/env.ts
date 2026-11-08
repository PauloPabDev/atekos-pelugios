import { z } from 'zod'

const Env = z.object({
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
	PORT: z.coerce.number().default(3000),
	DATABASE_URL: z.string().startsWith('postgres'),
	MONGO_URL: z.string().startsWith('mongodb'),
	MONGO_DB: z.string().default('domotica'),
	REDIS_URL: z.string().startsWith('redis'),
	TOKEN_PEPPER: z.string().min(32),
	SESSION_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 7),
	// URL pública (https://casa.tudominio.com): issuer OAuth y base del MCP (docs/MCP.md). Sin ella no se montan.
	// compose pasa '' cuando no está definida.
	PUBLIC_URL: z.preprocess(
		(v) => (v === '' ? undefined : v),
		z
			.url({ protocol: /^https?$/ })
			.transform((u) => u.replace(/\/+$/, ''))
			.optional(),
	),
})
export type Env = z.infer<typeof Env>
export const loadEnv = (src: NodeJS.ProcessEnv = process.env) => Env.parse(src)
