# Guía: replicar el sistema de domótica como monorepo nuevo

> Instrucciones para construir desde cero **atekos-domotica**: un monorepo que replica la lógica IoT/domótica de `serverAtekosRoom` (rooms, toggle de luz, lectura de estado por el ESP8266 y actualizaciones por WebSocket) y corrige los problemas descritos en [`ANALISIS_PROYECTO.md`](./ANALISIS_PROYECTO.md).
> Alcance: **solo domótica**. Imágenes, links y focus projects quedan fuera.

---

## 1. Objetivo y alcance

**Qué se replica:**
- Un *room* de hoy pasa a ser un **device**: un estado on/off (`state`) más datos libres en JSON (`data`).
- El celular o la web cambian el estado; el ESP8266 lo lee por HTTP o lo recibe en vivo por WebSocket.
- La arquitectura hexagonal por módulo (`domain` / `application` / `infrastructure`) que ya usas.

**Qué se agrega:** usuarios, dispositivos públicos y privados, tokens de API, credenciales cifradas, persistencia real, caché, historial y Docker de dev y de prod detrás de un proxy.

### Checklist de requisitos

| Requisito | Cómo se cumple | Sección |
|---|---|---|
| Monorepo, todo en un repo | pnpm workspaces: `apps/api`, `apps/web`, `packages/shared`, `infra/` | §4, §14 |
| Tests integrados | Vitest; integración con Testcontainers (PG, Mongo y Redis reales); CI | §11 |
| Volúmenes persistentes | Volúmenes con nombre `pg_data`, `mongo_data`, `redis_data`, `caddy_data`, `caddy_config` | §10 |
| BD ligera SQL | PostgreSQL 17 alpine: usuarios, dispositivos y tokens; `data` en JSONB | §5 |
| Mongo | Colecciones *time-series* para historial de eventos y telemetría | §5 |
| Imagen Docker de dev y de prod | Dockerfiles multi-stage con targets `dev` y `prod` | §10 |
| Framework JS | React + Vite + TypeScript | §12 |
| Proxy | Caddy 2 (HTTPS automático, WebSocket transparente) | §10 |
| Servidor HTTP y WS | Express 5 + `ws` en el mismo puerto (`/api/v1/*` y `/ws`) | §6, §8 |
| Público y privado por usuario | `devices.visibility` + política `canRead` / `canWrite` | §7.3 |
| Credenciales cifradas | argon2id (contraseñas), HMAC-SHA256 con pepper (tokens), AES-256-GCM (secretos recuperables) | §7.5 |
| Tokens para la API | `Bearer dmt_…` con scopes; opcionalmente ligado a un solo dispositivo | §7.4 |
| Caché Redis (imagen Docker) | `redis:8.2-alpine` con AOF: estado en caliente, sesiones, rate limit y pub/sub | §5, §7.2, §10 |

---

## 2. Lecciones del sistema actual

Cada regla de esta tabla evita un problema concreto encontrado en `ANALISIS_PROYECTO.md`.

| Problema actual | Regla en el sistema nuevo |
|---|---|
| Un mensaje WS que no es JSON tumba el proceso (§9.5) | `JSON.parse` + zod dentro de `try/catch`; un mensaje inválido recibe `{type:'error'}` y la conexión sigue viva. |
| `errorHandler` con 3 parámetros nunca se ejecuta (§9.6) | Un único middleware de error con **4 parámetros** que distingue `AppError` / `ZodError` / error desconocido. |
| Los errores se lanzan como strings (§9.12) | Siempre `AppError(status, code, message)`. |
| Rooms en memoria: el estado se pierde al reiniciar (§9.13) | PostgreSQL como fuente de verdad y Redis como caché. |
| Las conexiones a BD se abren al importar y hacen `process.exit` (§9.15); por eso los tests no pueden importar `app.js` (§8) | Las conexiones se abren en `createContainer(env)`, que llama `main.ts`. `buildApp(container)` no tiene efectos secundarios y los tests la usan directamente. |
| `SERVICE_ACCOUNT` es obligatoria aunque no se use (§9.14) | El env se valida con zod al arrancar y solo se exige lo que se usa. |
| Id de cliente WS = file descriptor (§9.17) | El socket es la propia clave del `Map`; no hace falta un id. |
| Hay que enviar `identify` antes de `subscribe`; si no, el cliente no recibe nada (§7) | No hay paso `identify`: la identidad se resuelve en el handshake. |
| El toggle lee, modifica y escribe (posible carrera entre dos clientes) | Toggle atómico: `UPDATE … SET state = NOT state … RETURNING *`. |
| `switchLight` es un **GET** que cambia estado | Cambiar estado siempre es `POST` / `PUT` / `PATCH`. |
| Get-or-create implícito: cualquier id crea un room | Los dispositivos los crea su dueño de forma explícita; un id desconocido da 404. |
| Sin autenticación y con CORS `*` (§9.3) | Sesión por cookie para la web y tokens para los dispositivos. La web y la API comparten origin detrás del proxy, así que no hace falta CORS. |
| Credenciales en git y en los logs (§9.1–9.2) | `.env` fuera de git y `.env.example` versionado. pino con `redact` para `authorization` y `cookie`. |
| El evento `room.create` nunca se emite | Todo cambio pasa por un único `onDeviceChanged` (caché → pub/sub → historial). |
| Imágenes `couchdb:latest` | Versiones fijas; se actualizan a propósito. |
| Tests rotos que nadie ejecuta; 4 mecanismos de despliegue (§8) | La CI obliga a que pasen lint, typecheck y tests, y hay un solo despliegue: `compose.prod.yml`. |

---

## 3. Arquitectura

```mermaid
flowchart LR
  B[Navegador<br/>React SPA] -->|HTTPS / WSS| P[Caddy]
  E[ESP8266 / scripts] -->|HTTP(S) / WS + Bearer| P
  P -->|/ estáticos| S[(web/dist)]
  P -->|/api/* y /ws| A[api<br/>Express 5 + ws]
  A --> PG[(PostgreSQL<br/>users · devices · api_tokens)]
  A --> M[(MongoDB<br/>device_events · telemetry)]
  A <--> R[(Redis<br/>caché · sesiones · rate limit · pub/sub)]
```

- **Una sola app de backend** sirve HTTP y WS en el mismo puerto, como hoy hacen `server.js` + `setupWebSocket`.
- **Redis pub/sub** reparte los cambios: si mañana corres 2 instancias de la API, un cambio en una llega a los sockets conectados a la otra.
- **Hexagonal por módulo.** `domain/` tiene tipos, la política y los puertos (interfaces). `application/` tiene un caso de uso por archivo. `infrastructure/` tiene los adaptadores (pg, mongo, redis, http).
- **Un solo composition root** (`apps/api/src/container.ts`) reemplaza los muchos `init*.js` y `*RepositoryFactory.js` de hoy. Ya no hay switch de motor por env: cada dato tiene su motor fijo.

---

## 4. Estructura del monorepo

```
atekos-domotica/
├─ apps/
│  ├─ api/                      # Express 5 + ws (TS). tsx en dev, tsup en build
│  │  ├─ src/
│  │  │  ├─ main.ts             # env → container → http + ws → listen → shutdown
│  │  │  ├─ app.ts              # buildApp(container): Express sin efectos secundarios
│  │  │  ├─ container.ts        # conecta PG/Mongo/Redis, migra, arma casos de uso
│  │  │  ├─ config/env.ts       # esquema zod del entorno
│  │  │  ├─ db/schema.ts        # tablas Drizzle
│  │  │  ├─ db/mongo.ts         # ensureMongo(): colecciones time-series
│  │  │  ├─ shared/             # errors.ts, crypto.ts, rate-limit.ts, auth.ts
│  │  │  ├─ modules/
│  │  │  │  ├─ auth/            # register, login, logout, me (sesiones en Redis)
│  │  │  │  ├─ tokens/          # crear, listar, revocar, verificar
│  │  │  │  ├─ devices/         # CRUD, state, toggle, data, events
│  │  │  │  └─ telemetry/       # ingesta y consulta
│  │  │  └─ ws/server.ts        # attachWebSocket(server, container)
│  │  ├─ drizzle/               # migraciones SQL generadas (versionadas)
│  │  ├─ test/                  # integración (Testcontainers)
│  │  ├─ Dockerfile
│  │  ├─ drizzle.config.ts  tsup.config.ts  tsconfig.json  package.json
│  └─ web/                      # React + Vite
│     ├─ src/  Dockerfile  vite.config.ts  package.json
├─ packages/
│  └─ shared/                   # esquemas zod: Device, mensajes WS, DTOs, scopes
│     └─ src/index.ts
├─ infra/proxy/
│  ├─ Caddyfile                 # prod
│  └─ Caddyfile.dev             # dev (proxy a Vite con HMR)
├─ compose.yml  compose.dev.yml  compose.prod.yml
├─ pnpm-workspace.yaml  package.json  tsconfig.base.json  eslint.config.js  .prettierrc
├─ .env.example  .gitignore  .dockerignore
└─ .github/workflows/ci.yml
```

Estructura de un módulo (ejemplo `devices`):

```
modules/devices/
├─ domain/
│  ├─ policy.ts                 # canRead / canWrite (funciones puras)
│  └─ ports.ts                  # DeviceRepository, DeviceCache, DeviceEventLog, DeviceEventBus
├─ application/
│  ├─ create-device.ts  get-device.ts  get-state.ts  set-state.ts  toggle-state.ts
│  ├─ patch-device.ts  patch-data.ts  get-data-key.ts  list-events.ts
│  └─ on-device-changed.ts      # caché → pub/sub → historial
└─ infrastructure/
   ├─ pg-device-repository.ts  redis-device-cache.ts  redis-device-event-bus.ts
   ├─ mongo-device-event-log.ts
   └─ http-routes.ts
```

---

## 5. Modelo de datos

### PostgreSQL (fuente de verdad)

`apps/api/src/db/schema.ts`:

```ts
import { pgTable, pgEnum, uuid, text, boolean, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const visibility = pgEnum('visibility', ['public', 'private'])
export const deviceType = pgEnum('device_type', ['light', 'switch', 'sensor', 'generic'])
export const deviceStatus = pgEnum('device_status', ['active', 'inactive'])

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(), // se guarda en minúsculas
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(), // argon2id
  createdAt: createdAt(),
})

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(), // "cuarto", único por dueño
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    type: deviceType('type').notNull().default('generic'),
    state: boolean('state').notNull().default(false),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    visibility: visibility('visibility').notNull().default('private'),
    status: deviceStatus('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('devices_owner_slug').on(t.ownerId, t.slug)],
)

export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }), // null = todos mis dispositivos
  name: text('name').notNull(), // "ESP cuarto"
  prefix: text('prefix').notNull(), // "dmt_AbC12": para reconocerlo en la UI
  tokenHash: text('token_hash').notNull().unique(), // HMAC-SHA256; el token en claro nunca se guarda
  scopes: text('scopes').array().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
})
```

Diferencia con hoy: un dispositivo nuevo nace **apagado** (`state = false`); el `Room` actual nacía en `true`.

### MongoDB (historial y telemetría)

Son colecciones *time-series* con caducidad. Las crea `ensureMongo()` al arrancar:

```ts
import type { Db } from 'mongodb'

const DAY = 60 * 60 * 24

export async function ensureMongo(db: Db) {
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name))
  if (!names.has('device_events'))
    await db.createCollection('device_events', {
      timeseries: { timeField: 'ts', metaField: 'deviceId', granularity: 'seconds' },
      expireAfterSeconds: 180 * DAY,
    })
  if (!names.has('telemetry'))
    await db.createCollection('telemetry', {
      timeseries: { timeField: 'ts', metaField: 'deviceId', granularity: 'minutes' },
      expireAfterSeconds: 365 * DAY,
    })
}
```

| Colección | Documento |
|---|---|
| `device_events` | `{ ts, deviceId, ownerId, type: 'device.created' \| 'device.updated' \| 'state.changed' \| 'data.changed' \| 'device.deleted', before, after, actor: { kind, id }, source: 'http' \| 'ws' }` |
| `telemetry` | `{ ts, deviceId, values: { temp: 22.5, hum: 41 } }` |

### Redis

| Clave / canal | Valor | TTL |
|---|---|---|
| `sess:{sid}` | `userId` | `SESSION_TTL_SECONDS` (7 días) |
| `device:{id}` | JSON del `Device` completo (incluye `ownerId` y `visibility`, para aplicar la política desde la caché) | 1 h, y se reescribe en cada cambio |
| `tok:{hash}` | JSON del token verificado | 60 s; se borra al revocar |
| `rl:{clave}:{ventana}` | contador | duración de la ventana |
| canal `device-events` | `Device` en JSON después del cambio | — |

---

## 6. API HTTP v1

Base `/api/v1`. Los cuerpos son JSON validados con los esquemas de `packages/shared`. Los errores tienen la forma `{ "error": "<code>", "message": "..." }`.

**Quién puede llamar cada endpoint:**
- **Sesión:** solo con la cookie `sid` (usuario logueado en la web).
- **Dueño:** el dueño con sesión, o un token suyo con el scope indicado (y, si el token está ligado a un dispositivo, solo para ese).
- **Lector:** cualquiera si el dispositivo es público; si es privado, solo el dueño.

### Auth y tokens

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| `POST` | `/auth/register` | público | `{ email, username, password }` → 201 y deja la sesión iniciada (cookie `sid`). |
| `POST` | `/auth/login` | público, con rate limit | `{ email, password }` → cookie `sid`. |
| `POST` | `/auth/logout` | sesión | Borra `sess:{sid}`. |
| `GET` | `/auth/me` | sesión o token | `{ id, email, username }`. |
| `GET` | `/tokens` | sesión | Lista los tokens (prefix, scopes, deviceId, último uso), nunca el valor. |
| `POST` | `/tokens` | sesión | `{ name, scopes, deviceId?, expiresInDays? }` → 201 con **`token` en claro una sola vez**. |
| `DELETE` | `/tokens/:id` | sesión | Revoca el token: `revoked_at` + borra `tok:{hash}`. |

### Dispositivos

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| `GET` | `/devices` | sesión o token `devices:read` | Mis dispositivos. |
| `POST` | `/devices` | sesión | `{ slug, name, type, visibility, description?, data? }` → 201. |
| `GET` | `/public/devices?page&limit` | público | Lista los dispositivos públicos de todos los usuarios. |
| `GET` | `/devices/:id` | lector | El dispositivo. Si es privado y no eres el dueño, la respuesta es **404**, no 403, para no revelar que existe. |
| `PATCH` | `/devices/:id` | sesión (dueño) | `{ name?, description?, type?, visibility?, status? }`. |
| `DELETE` | `/devices/:id` | sesión (dueño) | Borra el dispositivo, su caché y sus tokens ligados (cascade). |
| `GET` | `/devices/:id/state` | lector | **El endpoint que consulta el ESP.** Responde `true` o `false` (JSON plano, igual que hoy `findParam`). Lee primero de Redis. |
| `PUT` | `/devices/:id/state` | dueño · `devices:write` | `{ state: boolean }`. |
| `POST` | `/devices/:id/toggle` | dueño · `devices:write` | Invierte el estado de forma atómica y devuelve el `Device`. |
| `GET` | `/devices/:id/data/:key` | lector | Valor de `data[key]`; 404 si no existe. |
| `PATCH` | `/devices/:id/data` | dueño · `devices:write` | `{ "brillo": 80, "modo": "noche" }` → merge sobre `data` (jsonb `\|\|`). |
| `GET` | `/devices/:id/events?limit=50` | lector | Historial desde Mongo, más reciente primero. |
| `POST` | `/devices/:id/telemetry` | dueño · `telemetry:write` | `{ values: {...}, ts? }`, con rate limit por token. |
| `GET` | `/devices/:id/telemetry?from&to&limit` | lector | Lecturas en un rango. |
| `GET` | `/health` | público | Hace ping a PG, Mongo y Redis; responde 200 o 503. Lo usa el healthcheck de Docker. |

### Equivalencias con el sistema actual

| Hoy (`/api/v1/rooms`, WS) | Nuevo | Cambio de comportamiento |
|---|---|---|
| `POST /rooms`, `GET /rooms/create?id=` | `POST /devices` | Requiere sesión; el dispositivo queda a nombre del usuario. |
| `GET /rooms` | `GET /devices` + `GET /public/devices` | Se separan "los míos" y "los públicos". |
| `GET /rooms/:id` | `GET /devices/:id` | Respeta la visibilidad. |
| `GET /rooms/:id/findParam?param=state` | `GET /devices/:id/state` | Para otros campos: `GET /devices/:id/data/:key`. |
| `GET /rooms/:id/switchLight` | `POST /devices/:id/toggle` | Es POST y es atómico; ya no crea el dispositivo si no existe. |
| `POST /rooms/:id/modify?key&value&type` | `PATCH /devices/:id/data` | El tipo lo da el propio JSON; ya no hace falta `type`. |
| `PUT /rooms/:id` | `PATCH /devices/:id` / `PUT /devices/:id/state` | Se separan los metadatos y el estado. |
| WS `identify` | — | La identidad se resuelve en el handshake. |
| WS `subscribe {event, room}` | `{ type: 'subscribe', deviceId }` | |
| WS `action room.update` / `room.switchLight` | `{ type: 'set', deviceId, state }` / `{ type: 'toggle', deviceId }` | |
| Evento `{ event: 'room.update', data }` | `{ type: 'device.updated', device }` | |

---

## 7. Flujos clave

### 7.1 Escritura (toggle, set, patch)

```
autorizar → UPDATE atómico en PG → onDeviceChanged:
   1. SET device:{id} en Redis
   2. PUBLISH device-events
   3. insertar en Mongo device_events   (si falla: se registra en el log y la request no falla)
```

`modules/devices/application/toggle-state.ts`:

```ts
import { canRead, canWrite, type Actor } from '../domain/policy'
import type { DeviceRepository } from '../domain/ports'
import type { OnDeviceChanged, Source } from './on-device-changed'
import { NotFound, Forbidden } from '../../../shared/errors'

export class ToggleState {
  constructor(private deps: { repo: DeviceRepository; onChanged: OnDeviceChanged }) {}

  async execute(actor: Actor, deviceId: string, source: Source) {
    const before = await this.deps.repo.findById(deviceId)
    if (!before || !canRead(actor, before)) throw NotFound('dispositivo')
    if (!canWrite(actor, before, 'devices:write')) throw Forbidden()
    const after = await this.deps.repo.toggleState(deviceId)
    await this.deps.onChanged({ type: 'state.changed', before, after, actor, source })
    return after
  }
}
```

En el repositorio PG, el toggle y el merge de `data` son una sola sentencia:

```ts
toggleState(id: string) {
  return this.one(
    this.db.update(devices)
      .set({ state: sql`NOT ${devices.state}`, updatedAt: sql`now()` })
      .where(eq(devices.id, id))
      .returning(),
  )
}

mergeData(id: string, patch: Record<string, unknown>) {
  return this.one(
    this.db.update(devices)
      .set({ data: sql`${devices.data} || ${JSON.stringify(patch)}::jsonb`, updatedAt: sql`now()` })
      .where(eq(devices.id, id))
      .returning(),
  )
}
// one(): toma la primera fila y la convierte a DTO (fechas en ISO). Así el JSON es igual venga de PG o de Redis.
```

`on-device-changed.ts`:

```ts
export type Source = 'http' | 'ws'
export type DeviceChange = { type: DeviceEventType; before: Device | null; after: Device; actor: Actor; source: Source }
export type OnDeviceChanged = (change: DeviceChange) => Promise<void>

export const makeOnDeviceChanged =
  ({ cache, bus, eventLog, logger }: Deps): OnDeviceChanged =>
  async (change) => {
    await cache.set(change.after)
    await bus.publish(change.after)
    await eventLog.append(toEvent(change)).catch((err) => logger.error({ err }, 'no se pudo guardar el evento'))
  }
```

### 7.2 Lectura en caliente (polling del ESP)

```ts
// get-state.ts
async execute(actor: Actor, id: string) {
  let device = await this.deps.cache.get(id)
  if (!device) {
    device = await this.deps.repo.findById(id)
    if (device) await this.deps.cache.set(device)
  }
  if (!device || !canRead(actor, device)) throw NotFound('dispositivo')
  return device.state
}
```

Un ESP que consulta cada 2 s pega en Redis (con un `tok:{hash}` también en caché), no en Postgres.

### 7.3 Público y privado: la política

`modules/devices/domain/policy.ts`. Es una función pura y es lo primero que se cubre con tests unitarios.

```ts
import type { Scope } from '@atekos/shared'

export type Actor =
  | { kind: 'anonymous' }
  | { kind: 'user'; userId: string }
  | { kind: 'token'; userId: string; tokenId: string; scopes: Scope[]; deviceId: string | null }

type Target = { id: string; ownerId: string; visibility: 'public' | 'private' }

export function canRead(actor: Actor, d: Target) {
  return d.visibility === 'public' || ownerWith(actor, d, 'devices:read')
}

export function canWrite(actor: Actor, d: Target, scope: Scope) {
  return ownerWith(actor, d, scope)
}

function ownerWith(actor: Actor, d: Target, scope: Scope) {
  if (actor.kind === 'anonymous' || actor.userId !== d.ownerId) return false
  if (actor.kind === 'user') return true
  return actor.scopes.includes(scope) && (actor.deviceId === null || actor.deviceId === d.id)
}
```

Las acciones de administración (crear, borrar o cambiar la visibilidad de un dispositivo, y crear tokens) exigen `actor.kind === 'user'`: un token nunca puede crear otro token.

### 7.4 Autenticación: sesión web y tokens de API

- **Web:** al hacer login se genera `sid = randomBytes(32).toString('base64url')`, se guarda `SET sess:{sid} userId EX <ttl>` y se envía la cookie `sid` con `HttpOnly`, `SameSite=Lax`, `Path=/` y `Secure` en producción. Revocar una sesión es borrar la clave.
- **Dispositivos y scripts:** usan el header `Authorization: Bearer dmt_<43 chars>`. El token se genera con 32 bytes aleatorios y en la BD solo se guarda su HMAC.

`apps/api/src/shared/auth.ts`, compartido por HTTP y WS:

```ts
import { parse as parseCookie } from 'cookie'

export async function resolveActor(c: Container, authorization?: string, cookieHeader?: string): Promise<Actor> {
  if (authorization?.startsWith('Bearer ')) {
    const t = await c.tokens.verify.execute(authorization.slice(7))
    if (!t) throw Unauthorized('token inválido, vencido o revocado')
    return { kind: 'token', userId: t.userId, tokenId: t.id, scopes: t.scopes, deviceId: t.deviceId }
  }
  const sid = parseCookie(cookieHeader ?? '').sid
  const userId = sid ? await c.auth.sessions.get(sid) : null
  return userId ? { kind: 'user', userId } : { kind: 'anonymous' }
}

// Express 5 reenvía al middleware de error las promesas rechazadas
export const authenticate = (c: Container): RequestHandler => async (req, _res, next) => {
  req.actor = await resolveActor(c, req.headers.authorization, req.headers.cookie)
  next()
}
```

Verificación del token, con caché de 60 s (`tokens/application/verify-token.ts`):

```ts
async execute(plain: string) {
  const hash = this.deps.hasher.hash(plain)
  const cached = await this.deps.redis.get(`tok:${hash}`)
  if (cached) return JSON.parse(cached) as VerifiedToken
  const token = await this.deps.repo.findActiveByHash(hash) // revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
  if (!token) return null
  await this.deps.redis.set(`tok:${hash}`, JSON.stringify(token), { EX: 60 })
  await this.deps.repo.touchLastUsed(token.id) // como mucho una escritura por minuto por token
  return token
}
```

`req.actor` se tipa con una ampliación de los tipos de Express (`src/types/express.d.ts`):

```ts
import type { Actor } from '../modules/devices/domain/policy'
declare global { namespace Express { interface Request { actor: Actor } } }
export {}
```

### 7.5 Cifrado de credenciales

`apps/api/src/shared/crypto.ts`:

```ts
import { randomBytes, createHmac, createCipheriv, createDecipheriv } from 'node:crypto'
export { hash as hashPassword, verify as verifyPassword } from '@node-rs/argon2' // argon2id por defecto

// Tokens: tienen mucha entropía, así que basta un HMAC rápido. El pepper vive solo en el env:
// si alguien roba la BD, no puede verificar tokens sin él.
export const makeTokenHasher = (pepper: string) => ({
  hash: (plain: string) => createHmac('sha256', pepper).update(plain).digest('hex'),
  create() {
    const plain = `dmt_${randomBytes(32).toString('base64url')}`
    return { plain, prefix: plain.slice(0, 10), hash: this.hash(plain) }
  },
})

// Secretos que el sistema necesita volver a leer (p. ej. la clave de una integración externa).
// En la fase de domótica no hay ninguno; el día que aparezca, va en una columna `<algo>_enc` usando esto.
export const makeCipher = (keyB64: string) => {
  const key = Buffer.from(keyB64, 'base64') // 32 bytes: openssl rand -base64 32
  return {
    encrypt(plain: string) {
      const iv = randomBytes(12)
      const c = createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
      return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.')
    },
    decrypt(box: string) {
      const [iv, tag, data] = box.split('.').map((s) => Buffer.from(s, 'base64url'))
      const d = createDecipheriv('aes-256-gcm', key, iv!)
      d.setAuthTag(tag!)
      return Buffer.concat([d.update(data!), d.final()]).toString('utf8')
    },
  }
}
```

Reglas:
- Las contraseñas se guardan solo con argon2id, con un mínimo de 10 caracteres.
- Los tokens se guardan solo como HMAC; el token en claro se muestra una sola vez.
- Ningún secreto va en el código, en git ni en los logs.

---

## 8. Protocolo WebSocket

**Conexión:** `wss://<host>/ws`. La identidad se resuelve en el handshake con `resolveActor`, en este orden:

1. Header `Authorization: Bearer …` (ESP8266 con `arduinoWebSockets`, scripts).
2. Cookie `sid` (el navegador la envía sola por ser el mismo origin).
3. `?token=` en la URL, solo si el cliente no puede enviar headers. Ojo: la URL termina en los logs del proxy.
4. Sin credenciales: el cliente queda **anónimo** y solo puede suscribirse a dispositivos públicos.

Un token inválido recibe `401` y no llega a abrirse el WebSocket.

**Mensajes** (esquemas zod en `packages/shared`):

| Dirección | Mensaje | Efecto |
|---|---|---|
| cliente → servidor | `{ type: 'subscribe', deviceId }` | Comprueba `canRead`; responde `subscribed` o `error`. |
| cliente → servidor | `{ type: 'unsubscribe', deviceId }` | Deja de recibir ese dispositivo. |
| cliente → servidor | `{ type: 'toggle', deviceId }` | Mismo caso de uso que `POST /toggle`. |
| cliente → servidor | `{ type: 'set', deviceId, state }` | Mismo caso de uso que `PUT /state`. |
| cliente → servidor | `{ type: 'ping' }` | Responde `pong` (latido a nivel de aplicación, para clientes que no manejan ping/pong del protocolo). |
| servidor → cliente | `{ type: 'device.updated', device }` | Cualquier cambio de un dispositivo al que estás suscrito. |
| servidor → cliente | `{ type: 'subscribed', deviceId }` · `{ type: 'pong' }` | Confirmaciones. |
| servidor → cliente | `{ type: 'error', code, message }` | JSON inválido, sin permiso o no encontrado. **La conexión sigue abierta.** |

`packages/shared/src/index.ts` (fragmento):

```ts
import { z } from 'zod'

export const SCOPES = ['devices:read', 'devices:write', 'telemetry:write'] as const
export const Scope = z.enum(SCOPES)
export type Scope = z.infer<typeof Scope>

export const Device = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  slug: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  type: z.enum(['light', 'switch', 'sensor', 'generic']),
  state: z.boolean(),
  data: z.record(z.string(), z.unknown()),
  visibility: z.enum(['public', 'private']),
  status: z.enum(['active', 'inactive']),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Device = z.infer<typeof Device>

export const WsClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), deviceId: z.uuid() }),
  z.object({ type: z.literal('unsubscribe'), deviceId: z.uuid() }),
  z.object({ type: z.literal('toggle'), deviceId: z.uuid() }),
  z.object({ type: z.literal('set'), deviceId: z.uuid(), state: z.boolean() }),
  z.object({ type: z.literal('ping') }),
])

export const WsServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('device.updated'), device: Device }),
  z.object({ type: z.literal('subscribed'), deviceId: z.uuid() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({ type: z.literal('pong') }),
])
export type WsServerMessage = z.infer<typeof WsServerMessage>
```

`apps/api/src/ws/server.ts`:

```ts
import type { Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { WsClientMessage, type WsServerMessage } from '@atekos/shared'

export function attachWebSocket(server: Server, c: Container) {
  const wss = new WebSocketServer({ noServer: true })
  const subscribers = new Map<string, Map<WebSocket, Actor>>() // deviceId → socket → actor
  const send = (ws: WebSocket, msg: WsServerMessage) => ws.send(JSON.stringify(msg))

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname !== '/ws') return socket.destroy()
    const qToken = url.searchParams.get('token')
    try {
      const actor = await resolveActor(c, req.headers.authorization ?? (qToken ? `Bearer ${qToken}` : undefined), req.headers.cookie)
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, actor))
    } catch {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
    }
  })

  function onConnection(ws: WebSocket, actor: Actor) {
    const mine = new Set<string>()
    let alive = true
    ws.on('pong', () => (alive = true))
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate() // ESP sin WiFi: se limpia solo
      alive = false
      ws.ping()
    }, 30_000)

    ws.on('message', async (raw) => {
      let msg
      try {
        msg = WsClientMessage.parse(JSON.parse(raw.toString()))
      } catch {
        return send(ws, { type: 'error', code: 'bad_message', message: 'JSON inválido o tipo desconocido' })
      }
      try {
        switch (msg.type) {
          case 'ping':
            return send(ws, { type: 'pong' })
          case 'subscribe':
            await c.devices.get.execute(actor, msg.deviceId) // lanza NotFound si no puede leer
            mine.add(msg.deviceId)
            if (!subscribers.has(msg.deviceId)) subscribers.set(msg.deviceId, new Map())
            subscribers.get(msg.deviceId)!.set(ws, actor)
            return send(ws, { type: 'subscribed', deviceId: msg.deviceId })
          case 'unsubscribe':
            mine.delete(msg.deviceId)
            subscribers.get(msg.deviceId)?.delete(ws)
            return
          case 'toggle':
            await c.devices.toggle.execute(actor, msg.deviceId, 'ws')
            return
          case 'set':
            await c.devices.setState.execute(actor, msg.deviceId, msg.state, 'ws')
            return
        }
      } catch (err) {
        send(ws, toWsError(err)) // AppError → { type: 'error', code, message }
      }
    })

    ws.on('close', () => {
      clearInterval(heartbeat)
      for (const id of mine) subscribers.get(id)?.delete(ws)
    })
  }

  // Cada instancia de la API recibe todos los cambios vía Redis y reenvía a sus sockets.
  // Se vuelve a comprobar canRead por si el dispositivo pasó de público a privado.
  c.devices.bus.subscribe((device) => {
    for (const [ws, actor] of subscribers.get(device.id) ?? [])
      if (canRead(actor, device)) send(ws, { type: 'device.updated', device })
  })

  return wss
}
```

El bus de Redis necesita **dos conexiones**, porque una conexión en modo subscribe no puede ejecutar otros comandos:

```ts
// redis-device-event-bus.ts
publish = (d: Device) => this.redis.publish('device-events', JSON.stringify(d)).then(() => {})
subscribe = (fn: (d: Device) => void) => this.sub.subscribe('device-events', (raw) => fn(JSON.parse(raw)))
```

**Flujo de punta a punta:**

```mermaid
sequenceDiagram
  participant ESP as ESP8266 (token del device)
  participant API as api
  participant R as Redis
  participant Cel as Celular (sesión)
  ESP->>API: WS /ws  Authorization: Bearer dmt_…
  ESP->>API: {type:'subscribe', deviceId}
  API-->>ESP: {type:'subscribed'}
  Cel->>API: POST /api/v1/devices/:id/toggle (cookie sid)
  API->>API: UPDATE … SET state = NOT state RETURNING *
  API->>R: SET device:{id} · PUBLISH device-events
  R-->>API: mensaje device-events (a todas las instancias)
  API-->>ESP: {type:'device.updated', device:{state:true…}}
  API-->>Cel: 200 Device
```

> Limitación conocida: revocar un token no cierra los WebSockets ya abiertos con ese token. Si hace falta, se publica `token.revoked` y se cierran esos sockets.

---

## 9. Seguridad

- `helmet()`, `express.json({ limit: '32kb' })` y `trust proxy` = 1 (detrás de Caddy, para leer la IP real).
- **Rate limit con Redis**, sin librería (`shared/rate-limit.ts`):

  ```ts
  export const rateLimit = (redis: Redis, o: { name: string; windowSec: number; max: number; key: (r: Request) => string }): RequestHandler =>
    async (req, _res, next) => {
      const k = `rl:${o.name}:${o.key(req)}:${Math.floor(Date.now() / 1000 / o.windowSec)}`
      const n = await redis.incr(k)
      if (n === 1) await redis.expire(k, o.windowSec)
      if (n > o.max) throw TooManyRequests()
      next()
    }
  ```

  Límites: login, 5 por minuto por IP + email. Telemetría, 60 por minuto por token. Resto de la API, 300 por minuto por actor o IP.
- **Middleware de error único** (`app.ts`), con 4 parámetros:

  ```ts
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.code, message: err.message })
    if (err instanceof ZodError) return res.status(400).json({ error: 'validation', issues: err.issues })
    req.log.error({ err }, 'error no controlado')
    res.status(500).json({ error: 'internal', message: 'Error interno' })
  })
  ```

- **Logs:** `pino-http` con `redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]']`. Nunca se loguean URLs de conexión.
- **Entorno validado al arrancar** (`config/env.ts`); si falta algo, el proceso termina con un mensaje claro *antes* de conectar a nada:

  ```ts
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
  ```

- **Bases de datos:** todas con contraseña. Redis con `--requirepass`. En prod **no se publica ningún puerto de BD**: solo Caddy expone 80 y 443.
- **CSRF:** la cookie es `SameSite=Lax` y la API solo acepta `application/json` en las escrituras, lo que basta para un solo origin.
- **TLS y ESP8266:** BearSSL en el ESP8266 es pesado. Hay dos opciones:
  - Usar `https` con `client.setFingerprint(...)` (hay que actualizar la huella cuando renueva el certificado).
  - Abrir un listener **HTTP solo para la LAN** en Caddy (ver §10.4). El token sigue siendo obligatorio.

---

## 10. Docker y proxy

### 10.1 `.env.example` (versionado; el `.env` real no)

```bash
# Genera las contraseñas con: openssl rand -hex 24  (hex: sin caracteres que haya que escapar en URLs)
POSTGRES_USER=atekos
POSTGRES_PASSWORD=cambia-esto
POSTGRES_DB=domotica
MONGO_USER=atekos
MONGO_PASSWORD=cambia-esto
REDIS_PASSWORD=cambia-esto
# openssl rand -base64 48
TOKEN_PEPPER=cambia-esto-por-al-menos-32-caracteres-aleatorios
# localhost en dev; tu dominio en prod (Caddy saca el certificado solo)
DOMAIN=localhost
```

### 10.2 `apps/api/Dockerfile`

```dockerfile
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @atekos/api...

# --- desarrollo: tsx watch; compose.dev monta src/ encima
FROM deps AS dev
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /repo/apps/api
CMD ["pnpm", "dev"]

FROM dev AS build
RUN pnpm build

FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @atekos/api...

# --- producción: solo dist + dependencias de prod, usuario sin privilegios
FROM node:24-alpine AS prod
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod-deps /repo /repo
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

`tsup.config.ts` mete `@atekos/shared` dentro del bundle, así que la imagen de prod no necesita el código fuente de `shared`:

```ts
import { defineConfig } from 'tsup'
export default defineConfig({ entry: ['src/main.ts'], format: 'esm', target: 'node24', noExternal: ['@atekos/shared'], clean: true })
```

Las migraciones (`apps/api/drizzle/*.sql`) se aplican al arrancar desde `createContainer` con `migrate(db, { migrationsFolder: 'drizzle' })` de `drizzle-orm/node-postgres/migrator`.

### 10.3 `apps/web/Dockerfile` (web de dev, build y la imagen del proxy)

```dockerfile
FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @atekos/web...

FROM deps AS dev
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
WORKDIR /repo/apps/web
CMD ["pnpm", "dev", "--host", "0.0.0.0"]

FROM dev AS build
RUN pnpm build

# --- proxy de desarrollo: reenvía a Vite
FROM caddy:2.10-alpine AS proxy-dev
COPY infra/proxy/Caddyfile.dev /etc/caddy/Caddyfile

# --- proxy de producción: sirve el build y reenvía /api y /ws
FROM caddy:2.10-alpine AS prod
COPY infra/proxy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
```

`.dockerignore` (sin esto, `COPY apps/api` copiaría los `node_modules` del host, que tienen binarios de glibc y no de musl):

```
**/node_modules
**/dist
.env
.git
coverage
```

### 10.4 Caddy

`infra/proxy/Caddyfile.dev`:

```caddyfile
:80 {
	handle /api/* {
		reverse_proxy api:3000
	}
	handle /ws {
		reverse_proxy api:3000
	}
	handle {
		reverse_proxy web:5173
	}
}
```

`infra/proxy/Caddyfile` (prod):

```caddyfile
{$DOMAIN} {
	encode zstd gzip
	header -Server

	handle /api/* {
		reverse_proxy api:3000
	}
	handle /ws {
		reverse_proxy api:3000
	}
	handle {
		root * /srv
		try_files {path} /index.html
		file_server
	}
}

# Opcional: HTTP sin TLS solo para dispositivos de la LAN (ESP8266). El token sigue siendo obligatorio.
# Publica "8081:8081" en compose.prod.yml para usarlo.
http://:8081 {
	@lan remote_ip private_ranges
	handle @lan {
		reverse_proxy api:3000
	}
	respond 403
}
```

Caddy reenvía el upgrade de WebSocket sin configuración extra. En dev, `vite.config.ts` necesita `server: { host: true, hmr: { clientPort: 8080 } }` para que el HMR pase por el proxy.

### 10.5 `compose.yml` (base común)

```yaml
name: atekos-domotica

services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20

  mongo:
    image: mongo:8.0
    environment:
      MONGO_INITDB_ROOT_USERNAME: ${MONGO_USER}
      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD}
    volumes:
      - mongo_data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping').ok"]
      interval: 5s
      timeout: 5s
      retries: 20

  redis:
    image: redis:8.2-alpine
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD}"]
    environment:
      REDISCLI_AUTH: ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    environment:
      PORT: 3000
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      MONGO_URL: mongodb://${MONGO_USER}:${MONGO_PASSWORD}@mongo:27017/?authSource=admin
      MONGO_DB: domotica
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      TOKEN_PEPPER: ${TOKEN_PEPPER}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/api/v1/health"]
      interval: 10s
      timeout: 3s
      retries: 10
      start_period: 20s
    depends_on:
      postgres: { condition: service_healthy }
      mongo: { condition: service_healthy }
      redis: { condition: service_healthy }

  proxy:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    environment:
      DOMAIN: ${DOMAIN}
    volumes:
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      api: { condition: service_healthy }

volumes:
  pg_data:
  mongo_data:
  redis_data:
  caddy_data:
  caddy_config:
```

### 10.6 `compose.dev.yml`

```yaml
services:
  postgres:
    ports: ["5432:5432"]
  mongo:
    ports: ["27017:27017"]
  redis:
    ports: ["6379:6379"]

  api:
    build:
      target: dev
    environment:
      NODE_ENV: development
    volumes:
      - ./apps/api/src:/repo/apps/api/src
      - ./apps/api/drizzle:/repo/apps/api/drizzle
      - ./packages/shared/src:/repo/packages/shared/src

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      target: dev
    volumes:
      - ./apps/web/src:/repo/apps/web/src
      - ./packages/shared/src:/repo/packages/shared/src

  proxy:
    build:
      target: proxy-dev
    ports: ["8080:80"]
    depends_on:
      web: { condition: service_started }
```

Solo se montan carpetas `src/`, así que los `node_modules` son los de la imagen (Linux musl). Si agregas una dependencia, ejecuta `docker compose … build api` (o `web`).

### 10.7 `compose.prod.yml`

```yaml
services:
  postgres:
    restart: unless-stopped
  mongo:
    restart: unless-stopped
  redis:
    restart: unless-stopped
  api:
    build:
      target: prod
    environment:
      NODE_ENV: production
    restart: unless-stopped
  proxy:
    build:
      target: prod
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
```

### 10.8 Comandos (scripts del `package.json` raíz)

```json
{
  "scripts": {
    "dev": "docker compose -f compose.yml -f compose.dev.yml up --build",
    "dev:down": "docker compose -f compose.yml -f compose.dev.yml down",
    "prod": "docker compose -f compose.yml -f compose.prod.yml up -d --build",
    "prod:logs": "docker compose -f compose.yml -f compose.prod.yml logs -f api proxy",
    "lint": "eslint .",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "build": "pnpm -r build"
  }
}
```

- La app de dev queda en **http://localhost:8080**.
- Los datos sobreviven a `down`. Solo `down -v` borra los volúmenes; úsalo con cuidado.
- Backup: `docker compose exec postgres pg_dump -U atekos domotica > backup.sql` y `docker compose exec mongo mongodump --archive -u atekos -p … --authenticationDatabase admin > mongo.archive`.

---

## 11. Tests y CI

**Pirámide:**
1. **Unit** (rápidos, sin Docker): `policy.ts` (tabla de casos anónimo/dueño/otro usuario/token con y sin scope/token de otro dispositivo), `crypto.ts` (cifrar → descifrar, falla si se altera el texto cifrado), casos de uso con fakes en memoria de los puertos.
2. **Integración** (`apps/api/test/`): PG, Mongo y Redis **reales** con Testcontainers, más `buildApp` + `attachWebSocket` en un puerto aleatorio.
3. **Web:** Vitest + Testing Library (`jsdom`) para los componentes y el hook del socket.

`pnpm test` ejecuta `pnpm -r test`: cada paquete corre su propio Vitest desde su carpeta.

`apps/api/test/stack.ts`:

```ts
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import pino from 'pino'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { MongoDBContainer } from '@testcontainers/mongodb'
import { RedisContainer } from '@testcontainers/redis'

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
  attachWebSocket(server, c)
  await new Promise<void>((r) => server.listen(0, r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    c,
    url,
    stop: async () => {
      server.close()
      await c.close()
      await Promise.all([pg.stop(), mongo.stop(), redis.stop()])
    },
  }
}
```

Escenario de punta a punta (`apps/api/test/devices.e2e.test.ts`):

```ts
import request from 'supertest'
import WebSocket from 'ws'
import { once } from 'node:events'

let s: Awaited<ReturnType<typeof startStack>>
beforeAll(async () => { s = await startStack() }, 180_000)
afterAll(() => s.stop())

const nextMessage = (ws: WebSocket, type: string) =>
  new Promise<any>((resolve) => ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.type === type) resolve(m)
  }))

it('privado: anónimo no lo ve; el token del ESP hace toggle y el WS lo recibe', async () => {
  const owner = request.agent(s.url)
  await owner.post('/api/v1/auth/register').send({ email: 'a@x.com', username: 'a', password: 'clave-larga-123' }).expect(201)
  const { body: dev } = await owner.post('/api/v1/devices')
    .send({ slug: 'cuarto', name: 'Luz cuarto', type: 'light', visibility: 'private' }).expect(201)

  await request(s.url).get(`/api/v1/devices/${dev.id}/state`).expect(404)

  const { body: tok } = await owner.post('/api/v1/tokens')
    .send({ name: 'esp', scopes: ['devices:read', 'devices:write'], deviceId: dev.id }).expect(201)
  const auth = { authorization: `Bearer ${tok.token}` }

  const ws = new WebSocket(`${s.url.replace('http', 'ws')}/ws`, { headers: auth })
  await once(ws, 'open')
  ws.send(JSON.stringify({ type: 'subscribe', deviceId: dev.id }))
  await nextMessage(ws, 'subscribed')

  const updated = nextMessage(ws, 'device.updated')
  await request(s.url).post(`/api/v1/devices/${dev.id}/toggle`).set(auth).expect(200)

  expect((await updated).device.state).toBe(true)
  expect(await s.c.mongo.collection('device_events').countDocuments({ deviceId: dev.id, type: 'state.changed' })).toBe(1)
  expect(JSON.parse((await s.c.redis.get(`device:${dev.id}`))!)).toMatchObject({ state: true })
  ws.close()
})
```

Otros tests de integración obligatorios:
- Un mensaje WS `"no-json"` devuelve `error` y el socket sigue abierto.
- Un token revocado recibe 401 en menos de 60 s (se borra `tok:{hash}`).
- Un token ligado al dispositivo A no puede hacer toggle de B.
- Un dispositivo que pasa de público a privado deja de notificar a los suscriptores anónimos.
- Login con contraseña incorrecta 6 veces devuelve 429.

`.github/workflows/ci.yml`:

```yaml
name: ci
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4 # lee "packageManager" del package.json
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test # el runner trae Docker, así que Testcontainers funciona
      - run: cp .env.example .env && docker compose -f compose.yml -f compose.prod.yml build
```

---

## 12. Frontend (React + Vite)

- **Librerías:** React Router para rutas y TanStack Query para el estado del servidor. Los tipos vienen de `@atekos/shared`.
- **Páginas:**
  - `/login`, `/register`.
  - `/`: mis dispositivos, con un botón de toggle por dispositivo y el estado en vivo.
  - `/devices/:id`: detalle, edición de `data`, visibilidad e historial (`/events`).
  - `/tokens`: crear (con el token en claro mostrado **una vez**, con botón de copiar) y revocar.
  - `/p/:id`: vista pública de un dispositivo, sin login.
- **API:** `fetch('/api/v1/…', { credentials: 'same-origin' })`; la cookie viaja sola.
- **Tiempo real:** un hook que mantiene la caché de TanStack Query al día:

```ts
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { WsServerMessage } from '@atekos/shared'

export function useDeviceSocket(deviceIds: string[]) {
  const qc = useQueryClient()
  const key = deviceIds.join(',')
  useEffect(() => {
    if (!key) return
    // shortcut: sin reconexión automática; cuando moleste, reconectar con backoff en onclose
    const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`)
    ws.onopen = () => key.split(',').forEach((deviceId) => ws.send(JSON.stringify({ type: 'subscribe', deviceId })))
    ws.onmessage = (e) => {
      const msg = WsServerMessage.safeParse(JSON.parse(e.data))
      if (msg.success && msg.data.type === 'device.updated') qc.setQueryData(['device', msg.data.device.id], msg.data.device)
    }
    return () => ws.close()
  }, [key, qc])
}
```

---

## 13. Contrato para el firmware (ESP8266)

1. Crea el dispositivo en la web y luego un token con scopes `devices:read` + `devices:write` **ligado a ese dispositivo**.
2. Graba en el ESP `HOST`, `DEVICE_ID` y `TOKEN`.

```bash
TOKEN=dmt_xxx; ID=<uuid>
curl -H "Authorization: Bearer $TOKEN" https://casa.tudominio.com/api/v1/devices/$ID/state         # → true
curl -X POST -H "Authorization: Bearer $TOKEN" https://casa.tudominio.com/api/v1/devices/$ID/toggle
```

**Opción A: polling** (lo más simple; igual que hoy):

```cpp
http.begin(client, String(HOST) + "/api/v1/devices/" + DEVICE_ID + "/state");
http.addHeader("Authorization", String("Bearer ") + TOKEN);
if (http.GET() == 200) digitalWrite(RELAY_PIN, http.getString() == "true" ? LOW : HIGH);
http.end();
delay(2000);
```

**Opción B: WebSocket** (instantáneo; librería `arduinoWebSockets`):

```cpp
webSocket.setExtraHeaders((String("Authorization: Bearer ") + TOKEN).c_str());
webSocket.begin(HOST, 8081, "/ws");          // listener LAN de §10.4, o beginSSL(HOST, 443, "/ws")
webSocket.onEvent([](WStype_t type, uint8_t* payload, size_t len) {
  if (type == WStype_CONNECTED)
    webSocket.sendTXT(String("{\"type\":\"subscribe\",\"deviceId\":\"") + DEVICE_ID + "\"}");
  if (type == WStype_TEXT) {
    // parsear con ArduinoJson: si type == "device.updated", aplicar device.state al relé
  }
});
// en loop(): webSocket.loop();
```

---

## 14. Plan de implementación por fases

Cada fase termina con algo que corre y tiene su criterio de "terminado".

| # | Fase | Pasos | Terminado cuando |
|---|---|---|---|
| 0 | **Scaffold** | `mkdir atekos-domotica && cd $_ && git init` · `corepack enable` · `pnpm init` · `corepack use pnpm@latest` · `pnpm-workspace.yaml` (`packages: [apps/*, packages/*]`) · `tsconfig.base.json` (strict, `moduleResolution: Bundler`, `noUncheckedIndexedAccess`) · `eslint.config.js` (`@eslint/js` + `typescript-eslint` + `eslint-config-prettier`) · `.prettierrc` (`{ "semi": false, "singleQuote": true, "useTabs": true }`, tu estilo actual) · `.gitignore` · `.dockerignore` · `.env.example` | `pnpm lint` corre sin errores sobre un repo vacío. |
| 1 | **Infra** | `compose.yml` con postgres, mongo y redis (§10.5, sin api ni proxy todavía) | `docker compose up` deja los 3 servicios `healthy`; un `down` + `up` conserva los datos. |
| 2 | **shared** | `packages/shared` (`"exports": { ".": "./src/index.ts" }`) · `pnpm --filter @atekos/shared add zod` · esquemas de §8 | `pnpm typecheck` pasa. |
| 3 | **Esqueleto de la API** | `pnpm --filter @atekos/api add express ws zod pino pino-http helmet cookie drizzle-orm pg mongodb redis @node-rs/argon2 @atekos/shared@workspace:*` y `add -D typescript tsx tsup drizzle-kit vitest supertest testcontainers @testcontainers/postgresql @testcontainers/mongodb @testcontainers/redis @types/express @types/ws @types/pg @types/supertest` · `env.ts`, `errors.ts`, `container.ts`, `app.ts`, `main.ts`, `/health` · Dockerfile (§10.2) | `pnpm dev` → `curl localhost:8080/api/v1/health` responde 200; `stack.ts` arranca en un test. |
| 4 | **Esquema** | `db/schema.ts` · `drizzle.config.ts` (`dialect: 'postgresql'`, `schema`, `out: './drizzle'`) · `pnpm drizzle-kit generate` · `ensureMongo()` | Al arrancar se crean las tablas y las colecciones time-series. |
| 5 | **Auth y tokens** | register/login/logout/me · sesiones en Redis · tokens (crear, listar, revocar, verificar con caché) · `resolveActor` · rate limit en login | Tests: login ok/mal/429; un token revocado recibe 401. |
| 6 | **Devices** | Puertos, `policy.ts` + tests unitarios, repositorio PG, caché y bus Redis, event log Mongo, `onDeviceChanged`, casos de uso y rutas de §6 | La tabla de equivalencias de §6 funciona por HTTP. |
| 7 | **WebSocket** | `ws/server.ts` (§8) | Pasa el escenario de punta a punta de §11 y el test del mensaje inválido. |
| 8 | **Telemetría** | Ingesta y consulta en Mongo, rate limit por token | Un `POST` de 60 lecturas y su `GET` por rango funcionan. |
| 9 | **Web** | `pnpm create vite apps/web --template react-ts`, renombrar a `@atekos/web` · páginas de §12 · `useDeviceSocket` · Dockerfile (§10.3) | Toggle desde dos pestañas: la otra se actualiza sola. |
| 10 | **Proxy y prod** | Caddyfiles (§10.4), `compose.dev.yml`, `compose.prod.yml` | `pnpm prod` en el servidor: HTTPS con tu dominio, el ESP funciona y un reinicio conserva todo. |
| 11 | **CI** | `.github/workflows/ci.yml` (§11) | La CI queda en verde en `main`; un PR con un test roto queda en rojo. |

> pnpm 10 no ejecuta scripts de instalación por defecto. Si avisa por `esbuild`, ejecuta `pnpm approve-builds` una vez y versiona el cambio.

---

## 15. Fuera de alcance (para después)

- Compartir dispositivos con otros usuarios (tabla `device_members` con rol `viewer` / `operator`, y `ownerWith` pasa a consultarla).
- Notificar telemetría por WS en vivo; cerrar los sockets al revocar un token (§8).
- MQTT para dispositivos de muy bajo consumo; actualizaciones OTA del firmware.
- Migrar imágenes, links y focus projects del servidor actual.
- Turborepo (caché de builds), cuando el monorepo tenga más apps.
