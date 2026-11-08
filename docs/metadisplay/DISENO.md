# MetaDisplay en atekos-pelugios: diseño de integración

> Lado **servidor** del protocolo MetaDisplay 1.0 ([`CONTRATO.md`](./CONTRATO.md), [`openapi.yaml`](./openapi.yaml), [`asyncapi.yaml`](./asyncapi.yaml)) integrado con los usuarios, tokens, PG, Mongo y Redis de atekos. El firmware ESP32-C6 queda fuera del repo.
> Este documento **manda sobre el contrato** donde se aparta de él. Cada desviación está marcada con **≠**.

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
| Comandos | **≠** Solo `display.refresh` y `display.brightness`. Los comandos `trust.stage`, `trust.activate` y `ota.install` dan **422 `command_not_allowed`** hasta que el hardware esté homologado. |
| Web | Sección «Pantallas» con vista previa SVG 172×320, editores JSON, estado online, eventos y comandos. Los datos en vivo se obtienen por **polling** cada 3 s (`refetchInterval`). **≠** No se extiende el protocolo de `/ws` web. |
| Varias instancias | Presencia en Redis y canal pub/sub `display-out`: cualquier instancia puede publicar hacia los sockets que tiene otra. |

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
| `dpres:{displayId}` (ZSET) | Conexiones vivas: el miembro es el `connId` y el score es su expiración en ms. Online = `ZCOUNT dpres:{id} <ahora> +inf > 0`. Cada heartbeat la renueva (`ZADD`), y el cierre la borra (`ZREM`). La clave entera lleva un `EXPIRE` de 120 s. |
| `dedup:{displayId}:{eventId}` | `SET … NX EX 86400`. Valor `pending` mientras se procesa y luego el `ui.result` en JSON. |
| canal `display-out` | `{ displayId, message }` → cada instancia lo envía a sus sockets de ese display. `message` puede ser `{ type: 'close' }`, que termina los sockets (borrado de la pantalla). |

## 3. API REST (`/api/v1`)

Acceso **admin** = sesión del dueño, o token del dueño con `displays:write` (y, si está ligado, solo para esa pantalla). Acceso **sesión** = solo la sesión del dueño. Si una pantalla es ajena o no existe → **404**. Si `{deviceId}` no cumple el formato `md-` + 12 hex → 404.

| Método | Ruta | Acceso | Cuerpo → Respuesta |
|---|---|---|---|
| `GET` | `/displays` | admin | `Display[]` del usuario. Un token ligado solo ve la suya. |
| `POST` | `/displays` | sesión | `{ deviceId, name }` → 201 `Display`. Si el `deviceId` ya existe → 409. |
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
- Un mensaje resultante (`template.set` o `data.update`) de más de **8192 bytes** serializado → **413** `message_too_large`.

`Display` = `{ deviceId, name, activeTemplateId, online, createdAt, updatedAt }`.

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
- Heartbeat: ping cada 30 s; sin pong → `terminate()`. En cada latido se renueva la presencia.

**`device.hello`**: registra el socket (`Map<displayId, Set<ws>>` local + `dpres`). Si `hello.template.id/version` no coincide con la plantilla activa → envía `template.set`. Después **siempre** envía `data.update` `snapshot`, con `templateVersion` de la activa.

**`template.ack` / `data.ack` / `trust.ack` / `ota.ack`**: se registran en el log, con `warn` si `ok:false`. No tienen más efectos.

**Mensajes que se envían**: `template.set { template }`, `data.update { templateVersion, strategy, values }`, `ui.result { eventId, status, toast?, patch? }`, `event.ack { eventId }`, `display.refresh {}` y `display.brightness { percent }`. Todos tienen que caber en 8192 bytes. Los que van a todos los sockets de la pantalla (REST, comandos y navegación `screen.*`) pasan por `display-out`; las respuestas a un toque (`ui.result`, `event.ack` y el snapshot de `data.refresh`) van directas al socket que tocó.

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
   - Cualquier otro: solo se registra, con toast `Accion recibida`.
5. El `ui.result` final se guarda en `dedup:` (`EX 86400`) y se envía. Se añade el evento a Mongo `display_events` (si falla, solo se registra en el log).

Los toasts van sin tildes porque la fuente del LCD es ASCII. Ningún toque cambia datos de negocio por sí solo (contrato §5).

## 6. Esquemas compartidos (`@atekos/shared`)

`DisplayHardwareId`, `DisplayElement`, `DisplayTouchAction`, `DisplayTemplate`, `DisplayValues`, `Display`, `DisplayDetail`, `DisplayEvent`, `DisplayCommand`, `CreateDisplayInput`, `PatchDisplayInput`, los mensajes del dispositivo (`DisplayClientMessage`: hello, template.ack, data.ack, touch.tap, trust.ack, ota.ack) y las constantes `DISPLAY_WIDTH`, `DISPLAY_HEIGHT` y `DISPLAY_MAX_FRAME`. Los scopes nuevos son `display:connect` y `displays:write`. `CreateTokenInput` y `ApiToken` ganan `displayId`.

Las validaciones de la plantilla siguen la unión del openapi y el demo:
- Coordenadas dentro de 172×320, con `x+w ≤ 172` e `y+h ≤ 320`.
- `line` exige `x2`/`y2`.
- `text`, `progress` y `button` exigen `value` o `bind`.
- `size` de 1 a 4; colores `#RRGGBB`; `radius` de 0 a 10.
- Hasta 45 elementos y 24 acciones, con ids de acción **únicos** (≤ 48 caracteres).
- `local.message` ≤ 24.
- Valores: claves ≤ 40 y ≤ 64 claves; los textos ≤ 140; los valores son string, number, boolean o null.

## 7. Ejemplos

En `examples/` están los del demo. **≠** Para que naveguen con las reglas de §5, usa `event: 'screen.status.v1'`, `'screen.goal.v1'` y `'data.refresh'` en lugar de `screen.status`, `screen.goal` y `goal.refresh`.

## 8. Fuera de alcance

- El firmware. El de `MetaDisplay-C6-Touch/firmware` **todavía no implementa `touch.tap`/`ui.result`**.
- OTA y rotación de CA.
- Webhooks.
- Eventos de pantallas por el `/ws` web.
- Compartir pantallas entre usuarios.
