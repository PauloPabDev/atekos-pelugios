# MetaDisplay en atekos-pelugios: diseño de integración

> Lado **servidor** del protocolo MetaDisplay 1.0 ([`CONTRATO.md`](./CONTRATO.md), [`openapi.yaml`](./openapi.yaml), [`asyncapi.yaml`](./asyncapi.yaml)) integrado con los usuarios, tokens, PG, Mongo y Redis de atekos. El firmware ESP32-C6 queda fuera del repo.
> Este documento **manda sobre el contrato** donde se aparta de él. Cada desviación está marcada con **≠**.
> El contrato que implementa atekos se **genera de los esquemas zod** y se publica en `/contrato`, `/api/v1/contract/*.json` y el MCP: ver [`README.md`](./README.md).
> Desde el contrato **1.1** la plantilla tiene rotación, más formas, imágenes, animación, botones físicos y funciones sobre las variables de los datos. En la **1.2** se quitó `template.params`: las variables solo llegan por los datos. Cómo usarlo todo: [`PLANTILLAS.md`](./PLANTILLAS.md).

## 1. Decisiones

| Tema | Decisión |
|---|---|
| Identidad | Cada pantalla (*display*) la registra su dueño con su id de hardware `md-XXXXXXXXXXXX` (12 hex; se guarda con el hex en **mayúsculas**). Ese id es **único global** y es el `{deviceId}` de las rutas. |
| Token del dispositivo | Un token `dmt_` normal, **ligado a la pantalla** (`api_tokens.display_id`), con el scope `display:connect`. Es el `DEVICE_TOKEN` del contrato. |
| Token de administración | La sesión del dueño, o un token con el scope `displays:write` (ligado o no a una pantalla). Es el `ADMIN_TOKEN` del contrato. **≠** No hay tokens globales por env. |
| Separación | Un token no puede tener a la vez `display:connect` y `displays:write`. Un token con `displayId` solo admite esos dos scopes y no puede tener `deviceId`. `display:connect` exige `displayId`. Así, un token de dispositivo nunca sirve para administrar. |
| Rutas REST | **≠** `/api/v1/displays/{deviceId}/…` en lugar de `/api/v1/devices/{deviceId}/…`, porque esa ruta ya existe en atekos con otra semántica. Las formas, los límites y los códigos (400/401/404/409/413/422) siguen el contrato. |
| WSS | `/ws/device` **tal cual el contrato**: Bearer **solo en el header** (sin `?token=` ni cookie). Es un servidor WS aparte del `/ws` de la web. |
| Plantillas | Cada pantalla guarda **varias** plantillas (una por `template.id`) y una de ellas es la **activa**. Los valores (`values`) son **uno por pantalla**, compartidos entre sus plantillas, igual que en el demo. |
| Versionado | Al guardar una plantilla con un `id` que ya existe, su `version` debe ser **mayor** que la guardada; si no, 409 `version_not_incremented`. El dispositivo cachea por `id`+`version`, así que sin esta regla un cambio podría no llegarle nunca. |
| Toques | Hay **reglas declarativas** por `action.event` (§5). Dedupe por `eventId` en Redis, historial en Mongo. |
| Comandos | **≠** Solo `display.refresh`, `display.brightness` y `display.info` (1.3). Los comandos `trust.stage`, `trust.activate` y `ota.install` dan **422 `command_not_allowed`** hasta que el hardware esté homologado. |
| Web | Sección «Pantallas» con vista previa SVG (172×320 o 320×172, con animación), editores JSON, lista de las variables que usa la plantilla, Lienzo para importar fotos sin deformarlas, dibujar y editar las imágenes de la plantilla, estado online, eventos y comandos. Los datos en vivo se obtienen por **polling** cada 3 s (`refetchInterval`). **≠** No se extiende el protocolo de `/ws` web. |
| Varias instancias | Presencia en Redis y canal pub/sub `display-out`: cualquier instancia puede publicar hacia los sockets que tiene otra. |
| Rotación (1.1) | **≠** `template.rotation` 0/90/180/270: lienzo de 172×320 (vertical) o 320×172 (horizontal). Las coordenadas y los toques van en el sistema girado. Para cambiar de orientación se cambia de plantilla. |
| Elementos (1.1) | **≠** Además de los oficiales: `circle`, `ellipse`, `polygon`, `arc`, `curve` (Bézier de 3 o 4 puntos) e `image`, y `stroke` (grosor) en las líneas y las formas. **≠** No hay tope de elementos ni de acciones (el oficial era 45 y 24): limita el tamaño en bytes. |
| Imágenes (1.1) | **≠** Elemento `image` con píxeles RGB565 en base64, sin comprimir (`rgb565`) o en tramos RLE de 3 bytes (`rgb565-rle`). La API los decodifica al validar y exige exactamente w·h píxeles. Van dentro de la plantilla, así que se cachean con ella. |
| Tamaño (1.1) | **≠** Una plantilla (y cualquier mensaje a la pantalla) puede ocupar hasta `DISPLAY_MAX_TEMPLATE_BYTES`, 1 MB por defecto, que se cambia con una variable de entorno. Más grande → 413. El parser JSON de `/displays` y el del MCP usan ese tope; el resto de la API sigue en 32 KB. |
| Fragmentos (1.1) | **≠** Un mensaje de más de 8192 bytes viaja en mensajes `frag` seguidos (base64 de trozos de 6000 bytes del JSON) y la pantalla lo reensambla. Responde con `frag.ack`. Los dos son extensiones propias del protocolo oficial. |
| Variables (1.1, 1.2) | **≠** La plantilla usa las variables de los datos (`values`) por su nombre. Cualquier propiedad se puede ligar a una variable (`binds`), los textos tienen `format` y hay reglas `when` (si variable op valor → `set`). Semántica de referencia: `packages/shared/src/render.ts`. Los valores **solo** llegan por los datos (`PUT`/`PATCH /data` → `data.update`). La 1.1 tenía además `template.params` (tipos, `default` y `min`/`max`), que la 1.2 quitó porque duplicaba los datos. Una plantilla que aún lo lleve se acepta y `params` se descarta. |
| Animación (1.1) | **≠** `template.animation`: fotogramas con `ms`, dibujados encima de `elements`, y `repeat` (0 = siempre). |
| Ficha de la placa (1.3) | **≠** El `hello` puede traer `board` (modelo, chip, mac, flash, PSRAM), `display.driver` y `buttons` (`{ button, name, gpio }` por botón). El comando `display.info` pide la ficha y la placa responde con el mensaje nuevo `device.info` (los campos del hello sin `protocol` ni `template`). Se guarda la última en `displays.info` y `DisplayDetail.info` la devuelve; la web la enseña en la pestaña «En vivo» (tarjeta «Placa»). |
| Último contacto (1.3) | `displays.last_seen_at`: se apunta en el hello, como mucho una vez por minuto con los latidos y al cerrarse el socket. `Display.lastSeenAt` lo devuelve (null si nunca se conectó) y la web lo muestra como «última conexión» cuando está desconectada. No cambia `updatedAt`. |
| Botones físicos (1.1) | **≠** Acciones con `trigger: 'button'`, `button` 0..15 (índice lógico; el firmware sabe el GPIO), `press` short/long y zona resaltada opcional. Cualquier acción puede llevar un `payload`. El `touch.tap` dice `source`, `button` y `press`, y el historial lo guarda. |

## 2. Modelo de datos

**PostgreSQL** (migración nueva de Drizzle):

```ts
displays: {
  id: uuid pk defaultRandom,
  ownerId: uuid → users.id (cascade),
  hardwareId: text NOT NULL UNIQUE,        // 'md-34B7DA01ABCD' (hex en mayúsculas, lo normaliza DisplayHardwareId)
  name: text NOT NULL,
  activeTemplateId: text NOT NULL,         // id de la plantilla activa
  values: jsonb NOT NULL default {},
  createdAt, updatedAt (timestamptz)
}
display_templates: {
  displayId: uuid → displays.id (cascade),
  templateId: text,                        // template.id
  version: integer NOT NULL,
  body: jsonb NOT NULL,                    // la plantilla completa, ya validada
  updatedAt timestamptz,
  PRIMARY KEY (displayId, templateId)
}
api_tokens.display_id: uuid NULL → displays.id (cascade)   // columna nueva
```

Al crear una pantalla se inserta en la misma transacción una plantilla inicial `inicio` v1, que muestra el `name` y un texto ligado a `mensaje`, y queda como activa. Así el dispositivo dibuja algo desde el primer `hello`.

**MongoDB**: colección time-series `display_events` (`timeField: 'ts'`, `metaField: 'displayId'`, `expireAfterSeconds` de 90 días), creada en `ensureMongo()`. Hay dos tipos de documento:

- `{ ts, displayId, ownerId, kind: 'touch', eventId, actionId, name, x, y, templateId, templateVersion, status, toast }`.
- `{ ts, displayId, ownerId, kind: 'command', command: { type, percent? }, actor: { kind, id } }`. Es la auditoría de los comandos.

**Redis**:

| Clave / canal | Uso |
|---|---|
| `dpres:{displayId}` (ZSET) | Conexiones vivas: el miembro es el `connId` y el score es su expiración en ms. Online = `ZCOUNT dpres:{id} <ahora> +inf > 0`. Cada heartbeat la renueva (`ZADD`, expiración a 25 s), y el cierre la borra (`ZREM`). La clave entera lleva un `EXPIRE` de 120 s. |
| `dedup:{displayId}:{eventId}` | `SET … NX EX 86400`. Valor `pending` mientras se procesa y luego el `ui.result` en JSON. |
| canal `display-out` | `{ displayId, message }` → cada instancia lo envía a sus sockets de ese display. `message` puede ser `{ type: 'close' }`, que termina los sockets (borrado de la pantalla). |

## 3. API REST (`/api/v1`)

Acceso **admin** = sesión del dueño, o token del dueño con `displays:write` (y, si está ligado, solo para esa pantalla). Acceso **sesión** = solo la sesión del dueño. Si una pantalla es ajena o no existe → **404**. Si `{deviceId}` no cumple el formato `md-` + 12 hex → 404.

| Método | Ruta | Acceso | Cuerpo → Respuesta |
|---|---|---|---|
| `GET` | `/displays` | admin | `Display[]` del usuario. Un token ligado solo ve la suya. |
| `POST` | `/displays` | sesión | `{ deviceId, name }` → 201 `Display`. Si el `deviceId` ya existe → 409. La IA también puede darla de alta con la herramienta MCP `create_display`, con un grant OAuth con `displays:write` ([`../MCP.md`](../MCP.md)). |
| `GET` | `/displays/:deviceId` | admin | `DisplayDetail` (`Display` + `template` activa + `templates: [{id, version}]` + `values`). |
| `PATCH` | `/displays/:deviceId` | admin | `{ name?, activeTemplateId? }` → `Display`. Si cambia la activa: publica `template.set` + snapshot. Si la plantilla no existe → 422. |
| `DELETE` | `/displays/:deviceId` | sesión | 204. Los tokens ligados caen en cascada (y se borra su `tok:` en caché), y se publica `close`. |
| `PUT` | `/displays/:deviceId/template` | admin | `DisplayTemplate` → 200 `Display`. Guarda la plantilla **y la activa** (contrato §7); publica `template.set` + `data.update` snapshot. |
| `GET` | `/displays/:deviceId/templates` | admin | `DisplayTemplate[]`. |
| `PUT` | `/displays/:deviceId/templates/:templateId` | admin | `DisplayTemplate` (con `id === templateId`, si no 422) → 200. Guarda **sin activar**; si es la activa, publica. Sirve para las pantallas destino de `screen.*`. |
| `DELETE` | `/displays/:deviceId/templates/:templateId` | admin | 204. Si es la activa → 409. |
| `PUT` | `/displays/:deviceId/data` | admin | `DisplayValues` → 200 `{ values }`. Reemplaza los valores y publica `data.update` `snapshot`. |
| `PATCH` | `/displays/:deviceId/data` | admin | `DisplayValues` → 200 `{ values }`. Hace el merge (un `null` guarda `null`) y publica `data.update` `patch` **solo con las claves recibidas**. El resultado también debe cumplir ≤ 64 claves. |
| `GET` | `/displays/:deviceId/events?limit=100` | admin | `DisplayEvent[]` de toques, del más reciente al más antiguo (`limit` de 1 a 200; por defecto 100). |
| `POST` | `/displays/:deviceId/commands` | admin | `DisplayCommand` → 202 `{ ok: true }`. Sin conexión viva → 409 `device_offline`. Un tipo no permitido → 422 `command_not_allowed`. |

Errores dentro de `/displays`:
- Una plantilla o unos valores que no cumplen el esquema → **422** (`invalid_template` / `invalid_data`, con `issues`), no el 400 genérico de zod.
- Un cuerpo o un mensaje resultante (`template.set` o `data.update`) de más de **`DISPLAY_MAX_TEMPLATE_BYTES`** (1 MB por defecto) → **413** `message_too_large`. **≠** El oficial ponía el tope en 8192: lo que pasa de ahí viaja troceado (§4).

`Display` = `{ id, deviceId, name, activeTemplateId, online, lastSeenAt, createdAt, updatedAt }`. `DisplayDetail` añade `template`, `templates`, `values` e `info` (la ficha de la placa o null).

## 4. WebSocket del dispositivo: `/ws/device`

**Handshake**:
- Ruta exacta `/ws/device`.
- `Authorization: Bearer dmt_…` **obligatorio**: se verifica con `tokens.verify`. El token debe tener `display:connect` y `displayId`, y la pantalla debe existir. Si no se cumple → `401` y no se abre el WS.
- Un `?token=` o una cookie **no** sirven.
- `maxPayload: 8192`.

**Reglas de conexión**:
- Una trama binaria → `close(1003)`.
- Un JSON inválido → `close(1007)`, como el demo.
- Cualquier mensaje antes de un `device.hello` válido → `close(1008)`.
- Un `hello` con `deviceId` distinto (sin distinguir mayúsculas) del `hardwareId` de la pantalla del token → `close(1008)`. Lo mismo si `protocol !== 1`.
- Un `type` desconocido se ignora.
- Heartbeat: ping cada 10 s; sin pong → `terminate()`. En cada latido se renueva la presencia. Una placa que se apaga no cierra el TCP: así se da por desconectada en 20 s como mucho (antes, 60).

**`device.hello`**: registra el socket (`Map<displayId, Set<ws>>` local + `dpres`). Si `hello.template.id/version` no coincide con la plantilla activa → envía `template.set`. Después **siempre** envía `data.update` `snapshot`, con `templateVersion` de la activa. Guarda la ficha de la placa y el último contacto.

**`device.info`** (1.3): guarda la ficha. Un `deviceId` distinto → `close(1008)`.

**`template.ack` / `data.ack` / `frag.ack` / `trust.ack` / `ota.ack`**: se registran en el log, con `warn` si `ok:false`. No tienen más efectos.

**Fragmentos (1.1)**:
- Antes de enviar, si la trama serializada pasa de 8192 bytes, se trocea con `fragment()`: bytes UTF-8 en trozos de 6000, en base64, como `frag { id, seq, count, bytes, data }`.
- Se envían seguidos en un mismo tick, así que nada se intercala.
- Un mensaje mayor que el tope no se envía y queda en el log; no debería ocurrir, porque la REST ya lo rechaza con 413.

**Mensajes que se envían**: `template.set { template }`, `data.update { templateVersion, strategy, values }`, `ui.result { eventId, status, toast?, patch? }`, `event.ack { eventId }`, `display.refresh {}`, `display.brightness { percent }`, `display.info {}` (1.3) y, para lo que no cabe en una trama, `frag` (1.1). Cada trama ocupa como mucho 8192 bytes: lo que pasa de ahí se trocea. Los que van a todos los sockets de la pantalla (REST, comandos y navegación `screen.*`) pasan por `display-out`; las respuestas a un toque (`ui.result`, `event.ack` y el snapshot de `data.refresh`) van directas al socket que tocó.

## 5. Toques (`touch.tap`) y reglas declarativas

1. Se valida con zod (`DisplayTouchTap`). Si no es válido, se ignora.
2. **Dedupe**: `SET dedup:{displayId}:{eventId} pending NX EX 86400`.
   - Si ya existía con `pending` → `event.ack`.
   - Si ya existía con un JSON → se reenvía ese mismo `ui.result`.
   - En ningún caso se reprocesa.
3. Si `actionId` no está en la plantilla activa, o su `mode` es `local`, o `templateId`/`templateVersion` ≠ los de la activa → `ui.result { status: 'rejected', toast: 'Accion desactualizada' }`.
4. Regla según el `event` de la acción:
   - `screen.<templateId>`: si esa plantilla existe, la activa y publica `template.set` + snapshot a **todos** los sockets de la pantalla, con toast `Pantalla cambiada`. Si no existe → `status: 'error'` con toast `Pantalla no existe`.
   - `data.refresh`: reenvía el snapshot a ese socket, con toast `Datos actualizados`.
   - `data.set` (1.1): fusiona el `payload` de la acción en los valores, como `PATCH /data`, y publica el `data.update` `patch` a **todos** los sockets. El toast es `Datos cambiados` y el `ui.result` lleva `patch`. Si el resultado pasa de 64 claves → `status: 'error'` con toast `Datos invalidos`.
   - Cualquier otro: solo se registra, con toast `Accion recibida`.
5. El `ui.result` final se guarda en `dedup:` (`EX 86400`) y se envía. Se añade el evento a Mongo `display_events` (si falla, solo se registra en el log).

Los toasts van sin tildes porque la fuente del LCD es ASCII. Ningún toque cambia datos de negocio por sí solo (contrato §5): `data.set` solo cambia los valores que muestra la pantalla.

Los botones físicos (1.1) llegan como un `touch.tap` más, con `source: 'button'`, `button` y `press`. Siguen las mismas reglas, y el historial guarda `source`/`button`/`press` (`null` en los eventos antiguos).

## 6. Esquemas compartidos (`@atekos/shared`)

`DisplayHardwareId`, `DisplayElement`, `DisplayTouchAction`, `DisplayTemplate`, `DisplayValues`, `Display`, `DisplayDetail`, `DisplayEvent`, `DisplayCommand`, `CreateDisplayInput`, `PatchDisplayInput`, los mensajes del dispositivo (`DisplayClientMessage`: hello, template.ack, data.ack, touch.tap, trust.ack, ota.ack) y las constantes `DISPLAY_WIDTH`, `DISPLAY_HEIGHT` y `DISPLAY_MAX_FRAME`. Los scopes nuevos son `display:connect` y `displays:write`. `CreateTokenInput` y `ApiToken` ganan `displayId`.

Desde la 1.1 también: `DisplayRule`, los helpers `displaySize`, `resolveElement`, `currentFrame` y `templateVariables` (`render.ts`), y `encodeImage`/`decodeImage` (`image.ts`). La guía de uso está en [`PLANTILLAS.md`](./PLANTILLAS.md).

Las validaciones de la plantilla siguen la unión del openapi y el demo, ampliada en la 1.1:
- **Lienzo:**
  - Todo dentro del lienzo de su `rotation` (172×320 o 320×172), con la caja de cada elemento: `x+w`, `x±r`, todos los `points`…
  - Lo mismo para los fotogramas, las zonas de las acciones y cada variante `when.set`.
- **Elementos:**
  - `line` exige `x2`/`y2`.
  - `text`, `progress` y `button` exigen `value`, `bind` o `format`.
  - `size` de 1 a 4; colores `#RRGGBB`; `radius` de 0 a 10; `stroke` de 1 a 32.
  - `polygon` de 2 a 64 puntos; `curve` de 3 a 4.
  - `arc` con ángulos de −360 a 360.
  - `image` con `data` en base64 que da exactamente w·h píxeles.
- **Capa dinámica:**
  - `binds` solo sobre propiedades del tipo (nunca `type`, `bind`, `points`, `encoding`, `data`, ni el `w`/`h` de una imagen).
  - Cada `when.set` tiene que ser válido fusionado con el elemento.
  - Como mucho 16 reglas por elemento.
- **Acciones:**
  - Sin tope de número, con ids **únicos** (≤ 48 caracteres).
  - Un solo `button`+`press` por botón.
  - Una zona de botón lleva `x,y,w,h` juntos.
  - `local.message` ≤ 24; `payload` como los valores.
- **Animación:** fotogramas de 20 a 60 000 ms.
- **Valores:** claves ≤ 40 y ≤ 64 claves; los textos ≤ 140; los valores son string, number, boolean o null.

## 7. Ejemplos

En `examples/` están los del demo, más `showcase-template.json` (1.1): horizontal, con todas las formas, una imagen, animación, variables con `bind`/`binds`/`format`/`when` (sus valores en `showcase-data.json`) y botones físicos. **≠** Para que naveguen con las reglas de §5, usa `event: 'screen.status.v1'`, `'screen.goal.v1'` y `'data.refresh'` en lugar de `screen.status`, `screen.goal` y `goal.refresh`.

## 8. Fuera de alcance

- El firmware. El de `MetaDisplay-C6-Touch/firmware` (1.2.0) envía `touch.tap` con el botón BOOT, pero **no implementa nada de la 1.1**: rechaza esas plantillas con `template.ack ok:false` e ignora los `frag`. Qué tiene que hacer está en [`PLANTILLAS.md`](./PLANTILLAS.md) §10.
- Comprobar las `capabilities` del hello antes de enviar una plantilla que el firmware no sabe dibujar.
- OTA y rotación de CA.
- Webhooks.
- Eventos de pantallas por el `/ws` web.
- Compartir pantallas entre usuarios.
