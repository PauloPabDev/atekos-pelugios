# Server Atekos Room — Análisis del proyecto

> Documento generado a partir de una lectura completa del código (`src/`, `test/`, `public/html`, configuración y despliegue) el 2026-11-07, sobre el commit `ef01c53` (rama `main`).

## 1. Qué es

Servidor Node.js/Express personal para proyectos de domótica, IoT y electrónica. Nació (enero 2024) para un caso concreto: **encender/apagar la luz de una habitación** desde el celular. El celular cambia una variable (`state`) de un *room* en el servidor y un ESP8266 con relé la consulta (HTTP) o la recibe (WebSocket) para actuar sobre el bombillo.

Con el tiempo creció con otros módulos que no tienen que ver con domótica:

| Módulo | Para qué sirve |
|---|---|
| **rooms** | Estado de dispositivos/habitaciones (luz on/off y datos arbitrarios). Núcleo original. |
| **imgs** | Subida y registro de imágenes (disco local o Google Cloud Storage). |
| **focusProjects** + **focusElement** | "Proyectos" que agrupan "elementos" multimedia (hoy sólo imágenes funcionan). |
| **links** | Acortador de enlaces con redirección (`/l/u/:id`). |
| **websocket** | Tiempo real: suscripción a cambios de rooms y acciones sobre rooms. |

Además sirve un frontend estático: un SPA compilado con Vite (`public/dist`, viene del repo `PedroPab/frontAtekos` vía `npm run build:front`) y páginas HTML sueltas en `public/html` para gestionar focus projects.

## 2. Stack

- **Runtime:** Node.js 18 (`engines`), ES Modules (`"type": "module"`), usa *top-level await*.
- **HTTP:** Express 4, `multer` (subida de archivos en memoria), `cors`, `@hapi/boom` (errores).
- **WebSocket:** `ws` montado sobre el mismo servidor HTTP.
- **Persistencia (intercambiable):** CouchDB (`nano`), MongoDB (`mongodb`), Firestore (`firebase-admin`) o un `Map` en memoria.
- **Archivos:** disco local (`public/img`) o Google Cloud Storage (`@google-cloud/storage`).
- **Otros:** `fluent-ffmpeg` (crear video a partir de imágenes, sin usar), `chalk` (logs con color), `dotenv`.
- **Dev:** Jest + Babel + Supertest, ESLint 9 (flat config) + Prettier, Nodemon.

## 3. Estructura de carpetas

```
dirname.js                 # "raíz" del proyecto = '.', es decir, el CWD
src/
  server.js                # crea http.Server, monta WebSocket, escucha en PORT
  app.js                   # app Express: CORS, logs, middlewares, rutas, estáticos, 404, errores
  routes/index.js          # monta los routers de cada módulo
  config/
    dotEnv.js              # carga .env.<NODE_ENV> y expone el objeto ENV
    couchDb.js             # conexión a CouchDB (top-level await, process.exit si falla)
    mongo/mongoConfig.js   # conexión a MongoDB (igual)
    firebase/config.js     # firebase-admin; fuera de producción apunta al emulador
  middlewares/             # json, logs por user-agent, errores, carpeta pública
  utilsShare/
    repositories/          # adaptadores genéricos: Couch, Mongo, Firebase, LocalMap
    generateIds.js         # id aleatorio alfanumérico (9 chars por defecto)
    const/status.js        # ACTIVE / INACTIVE
  utils/logColor/          # Logs.logInfo/logError/logSuccess/logDebugger
  <modulo>/                # rooms, imgs, focusProjects, focusElement, links
    domain/                # modelos + "interfaces" de repositorio (clases que lanzan 'not implemented')
    application/           # casos de uso (una clase por caso, método execute)
    infrastructure/
      controller/          # traduce req/res ↔ casos de uso
      dependencies/        # composición manual (instancia repos, casos de uso y controlador)
      repository/          # implementaciones por motor de BD
      routes/              # router Express
  websocket/               # setupWebSocket, handlers, estado en memoria (clients, subscriptions)
  functions/               # utilidades sueltas (createVideo, manejo de archivos) — no se usan
  class/Room/              # versión antigua del modelo Room — sólo la usa un test
public/                    # dist (SPA), html (páginas sueltas), img (subidas), vid
test/                      # tests Jest (varios obsoletos, ver §9)
```

## 4. Arquitectura

Cada módulo sigue **arquitectura hexagonal / clean architecture** con inyección de dependencias manual:

```mermaid
flowchart LR
  R[routes] --> C[controller] --> UC[casos de uso<br/>application] --> RI[repositorio<br/>domain interface]
  RI -.implementa.-> RC[Couch / Mongo / Firebase / LocalMap<br/>infrastructure/repository]
  RC --> G[utilsShare/repositories<br/>adaptador genérico] --> DB[(BD)]
  D[dependencies/init*.js] -. construye .-> C & UC & RC
```

- **Elección del motor por variable de entorno.** Los `*RepositoryFactory.js` hacen `switch (ENV.X_REPOSITORY)` y un `await import(...)` dinámico, así sólo se carga (y se conecta) el motor elegido.
- **Adaptadores genéricos** en `src/utilsShare/repositories/` con la misma interfaz: `save(key, value)`, `get(key)`, `getAll({page, limit})`, `getByFilter({key, option, value}, {page, limit})`, `update`, `delete`. `option` acepta `== != > >= < <=`.
  - En **CouchDB** no hay colecciones: todo vive en la BD `couchdb` y el `_id` se prefija `"<coleccion>:<id>"` (p. ej. `links:abc123`). Los filtros usan Mango (`db.find`) con `$regex` sobre `_id`.
  - En **Mongo** la BD es `mongodb` y cada módulo usa su colección.
  - **LocalMap** es un `Map` en memoria: se pierde al reiniciar.
- **Eventos:** `rooms` expone un `EventEmitter` (`eventRoom`). `UpdateRoom` emite `room.update`; el WebSocket lo escucha y lo reenvía a los suscriptores.

### Arranque

1. `server.js` importa `app.js` → `routes/index.js` → cada `initX.js`. Al importarse, los factories leen `ENV`, cargan el repositorio y **se conectan a la BD con top-level await**. Si CouchDB o Mongo no responden, el proceso termina (`process.exit(1)`).
2. `links` además precarga toda la colección en una caché en memoria (`LinkFirebaseCacheRepository.initialize()`).
3. Se crea el `WebSocketServer` sobre el mismo `http.Server` y se escucha en `ENV.PORT` (3012 por defecto).

### Orden de middlewares en `app.js`

CORS manual (`*`) → `console.table` de cada request → `express.json` → log detallado si el `user-agent` es Postman/Arduino/ESP32/axios → rutas → estáticos (`public/dist`, `public`) → `GET *` devuelve `public/dist/index.html` (fallback del SPA) → 404 HTML → manejadores de error.

## 5. Configuración (variables de entorno)

`src/config/dotEnv.js` carga `.env.development` o `.env.production` según `NODE_ENV`. Ambos archivos están en el disco pero **no** en git.

| Variable | Default | Uso |
|---|---|---|
| `NODE_ENV` | `development` | Selecciona el `.env` y si Firestore usa emulador. |
| `PORT` / `HOST` | `3012` / `localhost` | Servidor HTTP + WS. |
| `IMG_REPOSITORY` | `couch` | `firebase` \| `local` \| `mongo` \| `couch`. |
| `PUBLISH_REPOSITORY` | `local` | Dónde se guardan los archivos: `local` \| `google-bucket`. |
| `FOCUS_PROJECT_REPOSITORY` | `couch` | Igual que arriba. |
| `FOCUS_ELEMENT_REPOSITORY` | `local` | Igual que arriba. |
| `LINKS_REPOSITORY` | `couch` | Igual que arriba (no está en ningún `.env`, así que siempre es `couch`). |
| `COUCHDB_URI` | `http://admin:password@127.0.0.1:5984` | Conexión CouchDB. |
| `MONGO_URI` | `mongodb://localhost:27017` | Conexión Mongo. |
| `SERVICE_ACCOUNT` | — (**obligatoria**) | JSON de la cuenta de servicio de Firebase. Si falta, `JSON.parse(undefined)` rompe el arranque. |
| `SERVICES_KEY_BUCKET` | `{}` | JSON de credenciales para Google Cloud Storage. |
| `PROJECT_ID`, `BUCKET_NAME` | `atekos`, `server-bucket` | Bucket de GCS. |
| `PORT_DATABASE` | `8087` | Puerto del emulador de Firestore usado por `firebase/config.js`. |
| `FIRESTORE_EMULATOR_HOST` | `localhost:8097` | Definida pero no se usa (el emulador real está en 8097 según `firebase.json`). |

**Rooms no tiene factory:** siempre usa `RoomLocalMapRepository` (memoria). El estado de las luces se pierde en cada reinicio.

## 6. API HTTP

Base: `/api/v1`. No hay autenticación en ningún endpoint.

### Rooms — `/api/v1/rooms`

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/` | Crea un room con el body (`id` opcional; si no, se genera). |
| `GET` | `/create?id=...&name=...` | Crea un room desde query params (pensado para dispositivos simples). |
| `GET` | `/` | Lista todos los rooms. |
| `GET` | `/:id` | Obtiene un room. |
| `GET` | `/:id/findParam?param=state` | Devuelve sólo el valor de un campo. **Es lo que consulta el ESP8266.** |
| `GET` | `/:id/switchLight` | Invierte `state` (si el room no existe, lo crea). Devuelve el nuevo valor. |
| `POST` | `/:id/modify?key=...&value=...&type=string\|boolean\|number` | Cambia un campo con tipado desde query. |
| `PUT` | `/:id` | Actualiza con el body (si no existe, lo crea). Emite `room.update`. |

Modelo `Room` (`src/rooms/domain/models/RoomModel.js`): `id, name, description, data{}, status ('active'), state (bool, default true), dateCreate, dateUpdate`.

### Imágenes — `/api/v1/imgs`

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/Hello` | Ping. |
| `GET` | `/` | Lista imágenes. |
| `GET` | `/:id` | Una imagen (metadatos + `urlPublic` / `urlPrivate`). |
| `POST` | `/` | `multipart/form-data` con campo `photo`. El id y el nombre de archivo son `<timestamp>-<nombreOriginal>`. |

Con `PUBLISH_REPOSITORY=local` el archivo va a `public/img/` y la URL es `/img/<archivo>`; con `google-bucket` se sube a GCS, se hace público y se genera además una URL firmada de 1 hora.

### Focus projects — `/api/v1/focusProjects`

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/?page=1&limit=10` | Lista proyectos. |
| `GET` | `/:id` | Un proyecto. |
| `POST` | `/` | Crea proyecto (`id` opcional, `name`, `description`, `data`). |
| `POST` | `/:id/elements` | `multipart` con `photo` + `type=img` (+ `name`, `description`). Crea la imagen y un `FocusElement` que la referencia por `elementPureId`. |
| `GET` | `/:id/elements?page=&limit=` | Elementos de un proyecto (filtro `focusProjectId ==`). |

`FocusElement.type` debe ser `img | video | text | link`, pero sólo `img` está implementado.

### Links — `/links`, `/l` y también `/api/v1/links`, `/api/v1/l`

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/` | Crea `{ id, url, title, description }`. **`id` es obligatorio** (no se autogenera). |
| `GET` | `/` | Lista (lee de la BD). |
| `GET` | `/:id` | Un link (lee de la caché en memoria). |
| `GET` | `/u/:id` | **Redirige** a `url`. Ej.: `https://host/l/u/abc`. |
| `PUT` | `/:id` | Actualizar — hoy siempre falla (ver §9). |

## 7. WebSocket

Mismo puerto que HTTP. Mensajes JSON con campo `type`:

| `type` | Payload | Efecto |
|---|---|---|
| `identify` | — | Registra la conexión en `clients[userId]` (userId = file descriptor del socket). |
| `subscribe` | `{ event: 'room.update', room: '<id>' }` | Agrega al cliente a `subscriptions[event][roomId]`. |
| `action` | `{ event: 'room.update', room, data }` | Ejecuta `UpdateRoom`. |
| `action` | `{ event: 'room.switchLight', room }` | Ejecuta `SwitchLightRoom`. |
| `message` | `{ event, ... }` | Reenvío a suscriptores (roto, ver §9). |

Cuando un room se actualiza (por HTTP o WS), todos los suscritos a `room.update` de ese room reciben `{ event: 'room.update', data: <room> }`. **Importante:** hay que enviar `identify` antes de `subscribe`; si no, el cliente queda suscrito pero no está en `clients` y no recibe nada. Existe un handler para `room.create`, pero ese evento nunca se emite.

Flujo típico del dispositivo:

```
ESP8266  --ws-->  {type:'identify'}
ESP8266  --ws-->  {type:'subscribe', event:'room.update', room:'cuarto'}
Celular  --http-> GET /api/v1/rooms/cuarto/switchLight
Servidor --ws-->  ESP8266 {event:'room.update', data:{id:'cuarto', state:false, ...}}
```

## 8. Desarrollo, tests y despliegue

**Local**

```bash
npm i
npm run dev            # nodemon, NODE_ENV=development
npm run dev:docker     # backend + CouchDB con docker-compose.yml
npm run emulator       # emulador de Firestore (puerto 8097, UI habilitada)
npm test               # jest
npm run lint           # eslint (sin punto y coma, comillas simples, tabs)
```

Hay que ejecutar todo desde la raíz del repo: `dirname.js` devuelve `'.'`, así que las rutas (`.env.*`, `public/`) son relativas al directorio actual.

**Despliegue:** conviven cuatro mecanismos y no está claro cuál es el vigente:

1. **Docker Compose en servidor propio** — `npm run start:docker` con `docker-compose.prod.yml` (imagen `atekos-img:latest` + CouchDB, datos en `/home/couchdb/data`). Los commits más recientes apuntan a este.
2. **Google Cloud Run** — `npm run full-deploy` (build → push a `gcr.io` → `gcloud run deploy`), variables en `.initConst.sh`.
3. **Google App Engine flex** — `app.yaml` + `npm run deploy:engine`.
4. **Railway** — `.github/workflows/deployrailway.yaml` en cada push a `main` (el workflow usa `railway login`/`railway up` sin instalar el CLI explícitamente; probablemente no funciona).

El `Dockerfile` es multi-stage con `node:18-alpine` e instala sólo dependencias de producción.

**Tests** (ejecutados hoy): **18 suites, 8 pasan y 10 fallan; 33 tests, 29 pasan y 4 fallan.**

- Pasan: modelo `Room`, `generateId`, `CreateRoom`, `GetAllRooms`, middlewares de errores y respuesta, clase antigua `Room`, `sum`.
- Fallan por importar módulos que ya no existen (`src/controllers/...`, `src/utils/files/getRootPath.js`, `ImgLocalFilesRepository.js`).
- `app.test.js` y `routes.test.js` fallan porque Babel transforma a CommonJS y el *top-level await* de los factories/configs no es válido ahí.
- `CreateFocusProject.test.js` espera mensajes de error y llamadas que ya no coinciden con el código.
- `routes.test.js` usa `/imgsAtekos/Hello`, pero la ruta real es `/imgs/Hello`.

## 9. Problemas detectados

Ordenados por gravedad. Ninguno se ha corregido; esto es sólo el diagnóstico.

### Seguridad

1. **Credenciales de CouchDB de producción en git**: `docker-compose.prod.yml:10` y `:24` (archivo versionado). Si el repo es o fue público, hay que rotarlas y moverlas a `.env.production`.
2. **La URI de CouchDB, con usuario y contraseña, se imprime en los logs**: `src/config/couchDb.js:15`.
3. **Sin autenticación**: cualquiera que llegue al servidor puede cambiar rooms (luces), subir archivos o crear links que redirigen a cualquier sitio (riesgo de *open redirect* / phishing con tu dominio). CORS `*`. `firestore.rules` permite leer y escribir todo.
4. Subida de archivos sin límite de tamaño ni validación de tipo (`multer.memoryStorage()` sin `limits`): un archivo grande vive entero en RAM.

### Bugs que rompen funcionalidad

5. **Un mensaje WS que no sea JSON tumba el servidor**: `JSON.parse` sin `try/catch` dentro del listener (`src/websocket/handlers/connectionHandlers.js:15`). La excepción no se captura y el proceso termina.
6. **`errorHandler` nunca actúa**: tiene 3 parámetros (`src/middlewares/errorHandler/index.js:15`) y Express sólo reconoce como middleware de error a las funciones con 4 (`err, req, res, next`).
7. **`PUT /links/:id` siempre falla**: `UpdateLink` llama `update(newLink)` con un solo argumento (`src/links/application/UpdateLink.js:12`) y el repositorio exige `(id, data)`.
8. **`type: 'message'` por WS lanza `TypeError`**: hace `.forEach` sobre un objeto (`src/websocket/handlers/messageHandlers.js:41`).
9. **`IMG_REPOSITORY=mongo` usa en realidad el repositorio en memoria** (`src/imgs/infrastructure/dependencies/ImgRepositoryFactory.js:17-18`).
10. **Focus elements `video`/`text`/`link`**: llaman a métodos que no existen (`src/focusElement/application/CreateFocusElement.js:43-47`).
11. **`viewElements.html` pide `/focusProjects/:id/element`** (en singular, `public/html/viewElements.html:125`); la ruta real es `/elements`. Esa petición cae en el fallback del SPA y devuelve HTML.
12. **`GET /rooms/:id/findParam` con room o parámetro inexistente** responde `404 {}` sin mensaje: se lanzan strings en lugar de `Error` (`src/rooms/application/GetParamRoom.js:11,14`).

### Fragilidad y comportamiento sorprendente

13. **Rooms en memoria**: el estado de las luces se reinicia (`state: true`) en cada reinicio o despliegue.
14. **Falta `SERVICE_ACCOUNT` → el servidor no arranca**, aunque no uses Firebase (`src/config/dotEnv.js:28`).
15. **CouchDB caído → `process.exit(1)` al importar**. Ocurre siempre que algún módulo use Couch (por defecto lo usan imgs, focusProjects y links).
16. **Caché de links**: `initialize()` no se espera (`src/links/infrastructure/dependencies/initLinks.js:16`). Además, `GET /:id` lee sólo de la caché y `GET /` sólo de la BD. Un link creado directamente en la BD no se ve hasta reiniciar. El nombre `LinkFirebaseCacheRepository` engaña: usa el motor del factory, no necesariamente Firebase.
17. **Id de cliente WS = file descriptor** (`connectionHandlers.js:11`): API interna de Node, y el número se reutiliza tras una desconexión.
18. **El `GET *` del SPA** (`src/middlewares/setPublicFolder/setPublicFolder.js:13`) captura todo, así que el 404 HTML de `app.js` nunca se ve en GET. Si falta `public/dist`, falla con error.
19. **El log `console.table` de `app.js:18`** corre antes de `express.json`, así que `body` siempre sale `undefined`.
20. **`ImgArtikuz.state = state || true`** es siempre `true` (`src/imgs/domain/models/ImgModel.js:19`). Al subir a GCS el `contentType` está fijo en `image/jpeg`.
21. **Inconsistencias de interfaz**: `FocusElementMongoRepository` define `getId` en lugar de `getById`, y `FocusElementFirebaseRepository` hereda de `FocusProjectRepository`.
22. **Node 18 ya no tiene soporte** (fin de vida: abril de 2025).

### Código muerto

- `src/class/Room/Room.js`: sólo lo usa un test.
- `src/rooms/infrastructure/repository/localRoomRepository.js`, `src/rooms/domain/services/RoomService.js`.
- `src/imgs/infrastructure/repository/repositories/LocalMapRepository.js`: duplicado del de `utilsShare`.
- `src/middlewares/returnsData` (sólo lo usan los tests), `src/functions/**`, `src/utils/collectionNames`.
- `src/middlewares/crossOriginIsolated`: crea `cors()` pero nunca lo registra con `app.use` (el CORS real está a mano en `app.js`).
- Dependencia `multer-cloud-storage`: no se usa en `src/`.
- `thunder-collection_Api room.json`: rutas de la API antigua (`/room/...`), ya no coinciden.

## 10. Recomendaciones (por prioridad)

1. Rotar las credenciales de CouchDB, sacarlas de `docker-compose.prod.yml` y quitar el log de `couchDb.js`.
2. Poner `try/catch` al `JSON.parse` del WebSocket y añadir el 4.º parámetro (`next`) a `errorHandler`.
3. Agregar una autenticación mínima (por ejemplo, un header con API key compartida) al menos para escribir en rooms y para crear links.
4. Darle a rooms un repositorio persistente con el mismo patrón de factory (`ROOM_REPOSITORY`).
5. Hacer opcional `SERVICE_ACCOUNT` (parsear sólo si existe).
6. Arreglar `UpdateLink` (`update(id, newLink)`) y el `case 'mongo'` de imágenes.
7. Borrar el código muerto y los tests obsoletos, y quitar `"@babel/plugin-transform-modules-commonjs"` o pasar Jest a ESM nativo para que los tests de integración vuelvan a correr.
8. Elegir un único mecanismo de despliegue y eliminar los demás.
9. Subir a Node 20/22 LTS.
