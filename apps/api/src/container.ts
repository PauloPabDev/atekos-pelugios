import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { MongoClient } from 'mongodb'
import { createClient } from 'redis'
import type { Logger } from 'pino'
import type { Env } from './config/env'
import { ensureMongo } from './db/mongo'

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

	return {
		env,
		logger,
		pool,
		db,
		mongoClient,
		mongo,
		redis,
		close: async () => {
			await Promise.allSettled([pool.end(), mongoClient.close(), redis.close()])
		},
	}
}

export type Container = Awaited<ReturnType<typeof createContainer>>
