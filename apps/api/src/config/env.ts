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
})
export type Env = z.infer<typeof Env>
export const loadEnv = (src: NodeJS.ProcessEnv = process.env) => Env.parse(src)
