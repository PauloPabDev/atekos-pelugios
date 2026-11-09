# Contrato MetaDisplay: dónde está y cómo se cambia

## Fuente de verdad

**Los esquemas zod de [`packages/shared/src/index.ts`](../../packages/shared/src/index.ts) son el contrato.** De ellos sale todo lo demás:

- Los mensajes del dispositivo: `DisplayClientMessage` (pantalla → servidor) y `DisplayServerMessage` (servidor → pantalla).
- La plantilla y los datos: `DisplayTemplate` y `DisplayValues`. Desde la 1.1 incluyen rotación, formas, imágenes, animación, botones físicos y funciones sobre las variables de los datos; cómo usarlos se explica en **[`PLANTILLAS.md`](PLANTILLAS.md)**, que también enseña a leer y enviar los datos. Lo que tiene que implementar el firmware de la placa para soportarlos está en **[`FIRMWARE.md`](FIRMWARE.md)**.
- Los comandos: `DisplayCommand`.
- Los cuerpos de la REST: `CreateDisplayInput`, `PatchDisplayInput`, `Display`, `DisplayDetail` y `DisplayEvent`.

Con esos mismos esquemas valida la API (REST, WSS `/ws/device` y MCP) y valida la web, así que el contrato publicado y lo que se ejecuta no pueden divergir. La semántica de lo que se dibuja (`binds`, `when`, `format`, valores por defecto y animación) está en [`render.ts`](../../packages/shared/src/render.ts), y la de las imágenes, en [`image.ts`](../../packages/shared/src/image.ts). La vista previa de la web usa los dos.

[`packages/shared/src/contract.ts`](../../packages/shared/src/contract.ts) monta con ellos dos documentos estándar, con versión y fecha (`METADISPLAY_CONTRACT`):

| Documento | Para quién | Qué describe |
|---|---|---|
| **AsyncAPI 3.0** | quien programa el firmware | WSS `/ws/device`: autenticación, los 14 mensajes (con `frag` y `frag.ack`, propios de atekos) y sus campos y límites. |
| **OpenAPI 3.1** | apps, paneles, scripts | REST `/api/v1/displays/…`: rutas, acceso, cuerpos y códigos de error. |

## Dónde se publica

Siempre es el de la versión desplegada:

- **Web:** [`/contrato`](https://atekos.toxolinko.site/contrato). Es pública y muestra la versión, la **última actualización**, la URL del WSS, los mensajes, la REST y los esquemas.
- **API:** `GET /api/v1/contract/asyncapi.json` y `GET /api/v1/contract/openapi.json`. Son públicos y salen con el dominio de `PUBLIC_URL`. Sirven para AsyncAPI Studio, Swagger o generadores de código.
- **MCP:** la herramienta `get_display_contract` (`part: asyncapi | openapi`) y los recursos `atekos://contract/asyncapi.json` y `atekos://contract/openapi.json` ([`../MCP.md`](../MCP.md)).
- **Repo:** [`generado/asyncapi.json`](generado/asyncapi.json) y [`generado/openapi.json`](generado/openapi.json), con el dominio de producción. Están versionados para que cada cambio del contrato se vea en el diff.

## Relación con el contrato oficial

[`CONTRATO.md`](CONTRATO.md), [`asyncapi.yaml`](asyncapi.yaml) y [`openapi.yaml`](openapi.yaml) son el **protocolo oficial MetaDisplay 1.0** del proyecto del firmware, copiados sin cambios. **No se editan aquí.** Si el protocolo oficial cambia, se vuelven a copiar y los tests dicen qué hay que adaptar.

`apps/api/test/contract.test.ts` comprueba que el contrato de atekos cumple el oficial:

- Cubre todos los tipos de mensaje oficiales, salvo `trust.stage`, `trust.activate` y `ota.install`, que no se envían hasta homologar el hardware. Los únicos que añade son `frag` y `frag.ack`.
- Acepta **todos los ejemplos JSON** del `CONTRATO.md` oficial.

Las diferencias con el oficial están justificadas en [`DISENO.md`](DISENO.md), con la marca **≠**. Por ejemplo, la REST va en `/api/v1/displays/…` y no en `/api/v1/devices/…`.

## Añadir una feature de pantallas

1. **Contrato primero.** Cambia o añade los esquemas en `packages/shared/src/index.ts`: un campo, un mensaje en `DisplayClientMessage` o en `DisplayServerMessage`, o un comando. Si es una ruta REST nueva, añádela a `metaDisplayOpenApi` en `contract.ts`. Si es un mensaje, escribe su `SUMMARY`.
2. **Versión.** En `METADISPLAY_CONTRACT`, sube `version` (semver) y pon la fecha de hoy en `updatedAt`:
   - patch: una aclaración sin efecto en el firmware;
   - minor: algo nuevo y opcional que un firmware anterior puede ignorar;
   - major: algo que rompe a los firmwares que ya existen.
3. **`pnpm contract`.** Regenera `generado/`. Si el contenido cambia y la versión no, se niega.
4. **Implementación.** Los casos de uso de `apps/api/src/modules/displays`, el WSS en `apps/api/src/ws/device-server.ts`, la web y, si la IA tiene que usarlo, una herramienta en `apps/api/src/mcp/server.ts`.
5. **Tests.** `pnpm test` hace dos comprobaciones:
   - `contract.test.ts`: `generado/` está al día y se sigue cumpliendo el oficial.
   - `contract-routes.test.ts`: cada ruta documentada existe.
6. **Desviaciones.** Si la feature se aparta del protocolo oficial, apunta el **≠** en `DISENO.md`.

Al desplegar, `/contrato`, `/api/v1/contract/*.json` y el MCP muestran la versión nueva con su fecha.

## Cambiar el tope de tamaño

Una plantilla, o cualquier mensaje a la pantalla, puede ocupar hasta **1 MB**. Para cambiarlo:

1. Pon la variable de entorno de la API **`DISPLAY_MAX_TEMPLATE_BYTES`**, en bytes: en `.env` en local, o en las variables de Coolify en producción.
2. Reinicia la API.

No hace falta tocar código ni subir la versión del contrato. El contrato servido muestra el tope vigente en `info["x-max-message-bytes"]`. En `generado/` aparece el valor por defecto, `DISPLAY_MAX_TEMPLATE_BYTES` de `packages/shared`.

Antes de subirlo, mira la flash de la pantalla: [`PLANTILLAS.md`](PLANTILLAS.md) §9.

## Ejemplos

[`examples/`](examples) tiene plantillas y datos válidos, que también se comprueban en los tests:
- `goal-template.json`, `status-template.json` y `goal-data.json`, del demo.
- `showcase-template.json` (1.1), con todo lo nuevo.
