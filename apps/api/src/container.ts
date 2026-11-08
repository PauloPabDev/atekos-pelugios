import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { MongoClient } from 'mongodb'
import { createClient } from 'redis'
import type { Logger } from 'pino'
import type { Env } from './config/env'
import { ensureMongo } from './db/mongo'
import { makeTokenHasher } from './shared/crypto'
import { Login } from './modules/auth/application/login'
import { Logout } from './modules/auth/application/logout'
import { Me } from './modules/auth/application/me'
import { Register } from './modules/auth/application/register'
import { makePgUserRepository } from './modules/auth/infrastructure/pg-user-repository'
import { makeRedisSessionStore } from './modules/auth/infrastructure/redis-session-store'
import { CreateToken } from './modules/tokens/application/create-token'
import { ListTokens } from './modules/tokens/application/list-tokens'
import { RevokeToken } from './modules/tokens/application/revoke-token'
import { VerifyToken } from './modules/tokens/application/verify-token'
import { makePgTokenRepository } from './modules/tokens/infrastructure/pg-token-repository'

// Relativa a este archivo, no al cwd: vale igual desde src/container.ts que desde dist/main.js.
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

export async function createContainer(env: Env, logger: Logger) {
	const pool = new pg.Pool({ connectionString: env.DATABASE_URL })
	// Sin listener, el error de un cliente inactivo (p. ej. PG reiniciado) tumba el proceso.
	pool.on('error', (err) => logger.error({ err }, 'postgres'))
	const db = drizzle({ client: pool })
	await migrate(db, { migrationsFolder })

	const mongoClient = await new MongoClient(env.MONGO_URL).connect()
	const mongo = mongoClient.db(env.MONGO_DB)
	await ensureMongo(mongo)

	const redis = createClient({ url: env.REDIS_URL })
	// Igual que en pg: node-redis emite 'error' al reconectar y sin listener el proceso cae.
	redis.on('error', (err) => logger.error({ err }, 'redis'))
	await redis.connect()

	const users = makePgUserRepository(db)
	const sessions = makeRedisSessionStore(redis, env.SESSION_TTL_SECONDS)
	const repo = makePgTokenRepository(db)
	const hasher = makeTokenHasher(env.TOKEN_PEPPER)

	return {
		env,
		logger,
		pool,
		db,
		mongoClient,
		mongo,
		redis,
		auth: {
			sessions,
			register: new Register({ users, sessions }),
			login: new Login({ users, sessions }),
			logout: new Logout({ sessions }),
			me: new Me({ users }),
		},
		tokens: {
			create: new CreateToken({ repo, hasher }),
			list: new ListTokens({ repo }),
			revoke: new RevokeToken({ repo, redis }),
			verify: new VerifyToken({ repo, redis, hasher }),
		},
		close: async () => {
			await Promise.allSettled([pool.end(), mongoClient.close(), redis.close()])
		},
	}
}

export type Container = Awaited<ReturnType<typeof createContainer>>
