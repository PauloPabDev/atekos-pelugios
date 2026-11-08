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
import { CreateDevice } from './modules/devices/application/create-device'
import { DeleteDevice } from './modules/devices/application/delete-device'
import { GetDataKey } from './modules/devices/application/get-data-key'
import { GetDevice } from './modules/devices/application/get-device'
import { GetState } from './modules/devices/application/get-state'
import { ListDevices } from './modules/devices/application/list-devices'
import { ListEvents } from './modules/devices/application/list-events'
import { ListPublicDevices } from './modules/devices/application/list-public-devices'
import { makeOnDeviceChanged } from './modules/devices/application/on-device-changed'
import { PatchData } from './modules/devices/application/patch-data'
import { PatchDevice } from './modules/devices/application/patch-device'
import { SetState } from './modules/devices/application/set-state'
import { ToggleState } from './modules/devices/application/toggle-state'
import { makeMongoDeviceEventLog } from './modules/devices/infrastructure/mongo-device-event-log'
import { makePgDeviceRepository } from './modules/devices/infrastructure/pg-device-repository'
import { makeRedisDeviceCache } from './modules/devices/infrastructure/redis-device-cache'
import { makeRedisDeviceEventBus } from './modules/devices/infrastructure/redis-device-event-bus'
import { CreateDisplay } from './modules/displays/application/create-display'
import { DeleteDisplay } from './modules/displays/application/delete-display'
import { DeleteTemplate } from './modules/displays/application/delete-template'
import { GetDisplay } from './modules/displays/application/get-display'
import { ListDisplays } from './modules/displays/application/list-displays'
import { ListEvents as ListDisplayEvents } from './modules/displays/application/list-events'
import { ListTemplates } from './modules/displays/application/list-templates'
import { PatchData as PatchDisplayData } from './modules/displays/application/patch-data'
import { PatchDisplay } from './modules/displays/application/patch-display'
import { PutData } from './modules/displays/application/put-data'
import { PutTemplate } from './modules/displays/application/put-template'
import { PutTemplateById } from './modules/displays/application/put-template-by-id'
import { SendCommand } from './modules/displays/application/send-command'
import { makeMongoDisplayEventLog } from './modules/displays/infrastructure/mongo-display-event-log'
import { makePgDisplayRepository } from './modules/displays/infrastructure/pg-display-repository'
import { makeRedisDisplayOutbox } from './modules/displays/infrastructure/redis-display-outbox'
import { makeRedisDisplayPresence } from './modules/displays/infrastructure/redis-display-presence'
import { IngestTelemetry } from './modules/telemetry/application/ingest-telemetry'
import { QueryTelemetry } from './modules/telemetry/application/query-telemetry'
import { makeMongoTelemetryRepository } from './modules/telemetry/infrastructure/mongo-telemetry-repository'

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
	// Conexión aparte para el bus: en modo subscribe una conexión no acepta otros comandos.
	const sub = redis.duplicate()
	sub.on('error', (err) => logger.error({ err }, 'redis sub'))
	await sub.connect()

	const users = makePgUserRepository(db)
	const sessions = makeRedisSessionStore(redis, env.SESSION_TTL_SECONDS)
	const repo = makePgTokenRepository(db)
	const hasher = makeTokenHasher(env.TOKEN_PEPPER)

	const deviceRepo = makePgDeviceRepository(db)
	const cache = makeRedisDeviceCache(redis)
	const bus = makeRedisDeviceEventBus(redis, sub)
	const eventLog = makeMongoDeviceEventLog(mongo)
	const onChanged = makeOnDeviceChanged({ cache, bus, eventLog, logger })
	const getDevice = new GetDevice({ repo: deviceRepo, cache })
	const telemetryRepo = makeMongoTelemetryRepository(mongo)

	const dd = {
		repo: makePgDisplayRepository(db),
		presence: makeRedisDisplayPresence(redis),
		outbox: makeRedisDisplayOutbox(redis, sub),
		eventLog: makeMongoDisplayEventLog(mongo),
	}

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
		devices: {
			bus,
			create: new CreateDevice({ repo: deviceRepo, onChanged }),
			get: getDevice,
			list: new ListDevices({ repo: deviceRepo }),
			listPublic: new ListPublicDevices({ repo: deviceRepo }),
			getState: new GetState({ repo: deviceRepo, cache }),
			setState: new SetState({ repo: deviceRepo, onChanged }),
			toggle: new ToggleState({ repo: deviceRepo, onChanged }),
			patch: new PatchDevice({ repo: deviceRepo, onChanged }),
			patchData: new PatchData({ repo: deviceRepo, onChanged }),
			getDataKey: new GetDataKey({ get: getDevice }),
			listEvents: new ListEvents({ get: getDevice, eventLog }),
			delete: new DeleteDevice({ repo: deviceRepo, cache, eventLog, redis, logger }),
		},
		// MetaDisplay (docs/metadisplay/DISENO.md). repo/presence/outbox/eventLog los usa también /ws/device.
		displays: {
			...dd,
			create: new CreateDisplay(dd),
			list: new ListDisplays(dd),
			get: new GetDisplay(dd),
			patch: new PatchDisplay(dd),
			delete: new DeleteDisplay({ ...dd, redis }),
			putTemplate: new PutTemplate(dd),
			putTemplateById: new PutTemplateById(dd),
			listTemplates: new ListTemplates(dd),
			deleteTemplate: new DeleteTemplate(dd),
			putData: new PutData(dd),
			patchData: new PatchDisplayData(dd),
			listEvents: new ListDisplayEvents(dd),
			sendCommand: new SendCommand(dd),
		},
		telemetry: {
			ingest: new IngestTelemetry({ get: getDevice, repo: telemetryRepo }),
			query: new QueryTelemetry({ get: getDevice, repo: telemetryRepo }),
		},
		close: async () => {
			await Promise.allSettled([pool.end(), mongoClient.close(), redis.close(), sub.close()])
		},
	}
}

export type Container = Awaited<ReturnType<typeof createContainer>>
