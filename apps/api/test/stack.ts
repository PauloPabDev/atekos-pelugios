import http from 'node:http'
import type { AddressInfo } from 'node:net'
import pino from 'pino'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { MongoDBContainer } from '@testcontainers/mongodb'
import { RedisContainer } from '@testcontainers/redis'
import { loadEnv } from '../src/config/env'
import { createContainer } from '../src/container'
import { buildApp } from '../src/app'
import { attachWebSocket } from '../src/ws/server'
import { attachDeviceWebSocket } from '../src/ws/device-server'

export async function startStack() {
	const [pg, mongo, redis] = await Promise.all([
		new PostgreSqlContainer('postgres:17-alpine').start(),
		new MongoDBContainer('mongo:8.0').start(),
		new RedisContainer('redis:8.2-alpine').start(),
	])
	const env = loadEnv({
		NODE_ENV: 'test',
		DATABASE_URL: pg.getConnectionUri(),
		MONGO_URL: `${mongo.getConnectionString()}?directConnection=true`,
		REDIS_URL: redis.getConnectionUrl(),
		TOKEN_PEPPER: 'test-pepper-'.padEnd(40, 'x'),
	})
	const c = await createContainer(env, pino({ level: 'silent' }))
	const server = http.createServer(buildApp(c))
	const ws = await attachWebSocket(server, c)
	const deviceWs = await attachDeviceWebSocket(server, c)
	await new Promise<void>((r) => server.listen(0, r))
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
	return {
		c,
		url,
		stop: async () => {
			await Promise.all([ws.close(), deviceWs.close()])
			server.close()
			await c.close()
			await Promise.all([pg.stop(), mongo.stop(), redis.stop()])
		},
	}
}
