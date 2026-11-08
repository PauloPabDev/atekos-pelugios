# MetaDisplay Protocol Specification 1.0

**Estado:** contrato técnico de referencia · **Fecha:** 2026-11-07 · **Hardware objetivo:** Waveshare ESP32-C6-Touch-LCD-1.47 (JD9853 + AXS5106L)

## 1. Objetivos y responsabilidades

El cliente ESP32-C6 ejecuta un motor gráfico declarativo de 172×320 píxeles y mantiene una conexión WebSocket autenticada. El servidor determina **la plantilla**, **los datos**, **las zonas interactivas** y **la respuesta de las acciones**. No se descarga ni ejecuta JavaScript/Código desde el servidor: se interpretan exclusivamente instrucciones declarativas con tipos permitidos.

| Componente | Responsabilidad |
|---|---|
| Dispositivo | Wi-Fi, TLS/WSS, validación JSON, caché, dibujo, interacción táctil, retransmisión y recuperación |
| Servidor del cliente | Autenticación, plantilla activa, datos, reglas de negocio, resultados de acciones, renovación de su TLS |
| Propietario | Configurar URL, token, y CA privada cuando aplique |
| Fabricante | Firmar actualizaciones de firmware (opcional) y emitir nuevas versiones de CA públicas mediante OTA |

## 2. Transporte y seguridad

- Endpoint WSS: `wss://DOMINIO/ws/device` (HTTPS/443 con TLS validado).
- Autenticación de dispositivo: cabecera HTTP `Authorization: Bearer <DEVICE_TOKEN>` durante el *upgrade* RFC6455. **No** enviar token en query string.
- Certificados públicos: almacén de CA públicas integrado en Arduino-ESP32; **no** deshabilitar hostname verification o certificados.
- Certificados privados: importar **CA DER codificada en base64** durante la configuración WiFiManager (no es una clave privada). El firmware la convierte a PEM y configura TLS. Renovar la hoja firmada por la misma CA no requiere tocar el dispositivo.
- Rotar una CA privada distinta: enviar `trust.stage` por el WSS ya autenticado (queda activa una etapa con CA antigua + nueva), cambiar el certificado del servidor y, cuando la conexión con la CA nueva ya funcione, enviar `trust.activate`. El ESP32 entonces conserva únicamente la CA nueva; si no logra otra conexión autenticada tras 90 s, revierte a la antigua. Debe probarse este procedimiento con el proveedor TLS del cliente.
- En producción, proteger físicamente los dispositivos, activar Secure Boot y Flash Encryption cuando el flujo de fabricación lo permita. La NVS sin cifrado **no** protege un token contra alguien con acceso físico a la flash.
- OTA: imagen descargada por HTTPS y validada contra SHA-256 y firma ECDSA P-256 de la clave del fabricante. Si no se ha configurado clave pública, el comando falla de forma segura.
- Antes de conectar, el cliente sincroniza la fecha mediante NTP. El protocolo no admite conexiones `ws://` en claro.

## 3. Modelo de sesión y sincronización

```text
ESP32-C6                                     Servidor WSS
    |---- TLS certificado + Authorization ---->|
    |---- device.hello {cache id,version} ----->|
    |<---- template.set [solo si cambió] -------|
    |---- template.ack ------------------------->|
    |<---- data.update (snapshot) --------------|
    |---- data.ack ----------------------------->|
    |<---- data.update (patch) ------------------|
    |---- touch.tap {eventId,actionId,x,y} ----->|
    |<---- ui.result {eventId,toast,patch} ------|
    |-------------------------------------------|
```

Las plantillas se almacenan en LittleFS (`/template.json`) y los valores en `/values.json` con escritura diferida para reducir desgaste. Los datos pueden llegar de forma independiente después de la sincronización de versión. Un `data.update` que indique otra `templateVersion` se rechaza con `data.ack {ok:false,reason:"version_mismatch"}`.

## 4. Envoltorio de mensajes

Todo mensaje es un JSON UTF-8, objeto raíz con campo obligatorio `type` (string). Los mensajes de tipo plantilla/estado llevan un snapshot completo o una actualización parcial. **Límite máximo de trama entrante: 8192 bytes**, un único frame de texto no fragmentado. El WebSocket implementado responde `ping`/`pong` y usa máscara obligatoria para las tramas ESP32→servidor.

### `device.hello` (dispositivo → servidor)

```json
{
  "type": "device.hello",
  "protocol": 1,
  "deviceId": "md-34B7DA01ABCD",
  "firmware": "1.0.0-touch",
  "display": {"width":172,"height":320,"touch":true,"color":"RGB565"},
  "template": {"id":"goal.v1","version":1},
  "capabilities": ["text","rect","line","button","progress","touch.tap","ui.result","template.cache"]
}
```

### `template.set` (servidor → dispositivo)

```json
{
  "type":"template.set",
  "template":{
    "id":"goal.v1","version":1,"background":"#090D18",
    "elements":[
      {"type":"text","x":10,"y":14,"size":2,"value":"META","color":"#FFFFFF"},
      {"type":"text","x":10,"y":80,"size":2,"bind":"collectedText","color":"#FFFFFF"},
      {"type":"progress","x":10,"y":170,"w":152,"h":12,"bind":"progress","fillColor":"#9568FF"},
      {"type":"button","x":10,"y":271,"w":152,"h":36,"value":"ACTUALIZAR","fillColor":"#6240B4"}
    ],
    "actions":[
      {"id":"refresh","trigger":"tap","x":10,"y":271,"w":152,"h":36,"mode":"hybrid","event":"goal.refresh",
       "local":{"kind":"feedback","message":"Actualizando..."}}
    ]
  }
}
```

`template.ack`: `{ "type":"template.ack", "ok":true, "templateId":"goal.v1", "version":1 }`.

**Elementos permitidos**

| Tipo | Campos obligatorios | Opcionales | Significado |
|---|---|---|---|
| `text` | `x,y`, uno de `value`/`bind` | `size` 1–4, `color` | Texto sin word-wrap |
| `rect` | `x,y,w,h` | `filled`, `radius` 0–10, `fillColor`, `color` | Rectángulo |
| `line` | `x,y,x2,y2` | `color` | Línea |
| `progress` | `x,y,w,h`, uno de `value`/`bind` | `color`, `fillColor` | Porcentaje 0–100 |
| `button` | `x,y,w,h`, uno de `value`/`bind` | `size`, `fillColor`, `color` | Botón dibujado (la interacción se define por separado) |

`bind` resuelve una **clave plana** dentro de `data.update.values`. No admite expresiones, CSS, JS, scripts ni URLs de imágenes. Los hexadecimales son `#RRGGBB`. La coordenada (0,0) es esquina superior izquierda de la LCD en rotación 0. Todo elemento gráfico con anchura/altura debe mantenerse dentro de 172×320. Si dos zonas táctiles se superponen, tiene prioridad la última en el arreglo `actions`.

**Límites v1:** hasta 45 elementos, 24 acciones, 64 variables, claves ≤40 caracteres, valores de texto ≤140 caracteres; el servidor debe evitar textos que excedan físicamente la pantalla.

### `data.update` (servidor → dispositivo)

```json
{
  "type":"data.update",
  "templateVersion":1,
  "strategy":"snapshot",
  "values":{"targetText":"$40.000.000","collectedText":"$2.500.000","progress":6.25,"daysText":"DIA 4 / 120"}
}
```

`strategy="snapshot"`: sustituye todos los valores. `strategy="patch"`: actualiza solo las claves recibidas. El dispositivo emite `data.ack`. Los datos financieros deben calcularse en el servidor; la LCD solo representa lo recibido.

## 5. Acciones táctiles

Se definen por `template.actions[]`, independientemente de los elementos dibujados. Cada acción describe una caja de colisión (`x,y,w,h`), `id`, `trigger:"tap"`, `mode` y `event`.

| `mode` | Comportamiento |
|---|---|
| `local` | Solo aplica una acción declarativa de UI: `feedback` o `set_value`. No se envía al servidor. |
| `remote` | Emite `touch.tap`, espera `ui.result` y opcionalmente aplica cambios. |
| `hybrid` | Ejecuta respuesta local inmediata y emite `touch.tap` para procesamiento remoto. |

`local` permite `{ "kind":"feedback", "message":"Procesando..." }` o `{ "kind":"set_value", "key":"estado", "value":"Cargando" }`. No es un motor de código arbitrario. Se genera **un solo evento por pulsación detectada**, con antirrebote ≈130 ms.

**Evento `touch.tap`**

```json
{
  "type":"touch.tap",
  "eventId":"md-34B7DA01ABCD-93351-7",
  "deviceId":"md-34B7DA01ABCD",
  "actionId":"refresh",
  "name":"goal.refresh",
  "x":43,"y":289,
  "templateId":"goal.v1","templateVersion":1,
  "uptimeMs":93351
}
```

El servidor **debe** validar el `actionId` contra la plantilla activa para el dispositivo y comprobar la versión. El `eventId` es idempotente. El firmware retiene en RAM hasta 12 eventos sin confirmación y reenvía cada ≈5 s mientras esté conectado. En reinicio se pierde la cola (garantía de entrega **al menos una vez mientras el dispositivo permanece encendido**, no transaccional). El servidor debe deduplicar por `eventId`.

### Respuesta desde el servidor

```json
{
  "type":"ui.result",
  "eventId":"md-34B7DA01ABCD-93351-7",
  "status":"ok",
  "toast":"Datos actualizados",
  "patch":{"collectedText":"$2.700.000","progress":6.75}
}
```

También se admite `event.ack {"type":"event.ack","eventId":"..."}` cuando el procesamiento es asíncrono. `ui.result` consume la confirmación del evento automáticamente. El servidor puede enviar un `template.set` para navegar a otra vista o un `data.update` para refrescar el contenido completo.

**No confundir confirmación con ejecución única:** repetir mensajes es normal; el backend debe implementar operaciones idempotentes. Un evento táctil nunca debe incrementar dinero real por simple configuración visual: las reglas pertenecen al backend autenticado.

## 6. Control y administración del dispositivo (WSS)

| Dirección | Tipo | Cuerpo relevante |
|---|---|---|
| servidor→ESP | `display.refresh` | Sin campos adicionales |
| servidor→ESP | `display.brightness` | `percent` entero, limitado por firmware a 0–50 |
| servidor→ESP | `trust.stage` | `caDerBase64` certificado CA privado nuevo, recibido por TLS previamente confiable |
| ESP→servidor | `trust.ack` | `operation:"stage"`, `ok` |
| servidor→ESP | `trust.activate` | Reinicia para probar la CA preparada; rollback a los 90 s sin conexión WSS válida |
| servidor→ESP | `ota.install` | `url` HTTPS, `sha256` hexadecimal, `signature` ECDSA DER codificada base64 |
| ESP→servidor | `ota.ack` | `ok`, `reason` (si la operación no reinicia) |

La clave de firmware debe generarse con `tools/make_signing_key.py`. No se distribuye clave privada al cliente. El firmware **no ejecuta OTA sin firma válida**. Esta implementación es un punto de partida que exige revisión de producción, actualización de CA bundles mediante releases, pruebas de corte de energía, Secure Boot/Flash Encryption y un flujo de recuperación verificado.

## 7. API REST para aplicación/administración (opcional)

El servidor de ejemplo implementa una API REST para editar diseño y datos desde cualquier panel web. Este contrato es **de servidor del cliente**; el ESP32 no necesita llamar a REST.

`Authorization: Bearer ADMIN_TOKEN` en todos los endpoints de administración. Nunca reutilices el token de dispositivo como token de administrador.

| Método | Ruta | Cuerpo | Resultado |
|---|---|---|---|
| GET | `/api/v1/health` | — | `{status:"ok",protocol:1}` |
| GET | `/api/v1/devices/{deviceId}` | — | Estado actual, plantilla, valores y conexión |
| PUT | `/api/v1/devices/{deviceId}/template` | Objeto plantilla | Persistir/publicar plantilla y snapshot actual |
| PUT | `/api/v1/devices/{deviceId}/data` | Objeto de valores | Reemplazar todos los datos y publicar snapshot |
| PATCH | `/api/v1/devices/{deviceId}/data` | Objeto de valores | Aplicar y publicar patch |
| GET | `/api/v1/devices/{deviceId}/events` | — | Últimos eventos táctiles (demo: 100) |
| POST | `/api/v1/devices/{deviceId}/commands` | Comando `display.*`, `trust.*` u `ota.install` | Enviar comando al dispositivo activo |

Errores HTTP: 400 JSON inválido, 401 no autorizado, 404 ruta inexistente, 405 método incorrecto, 413 mensaje excesivo, 422 plantilla/datos inválidos.

La API de ejemplo utiliza **memoria RAM**; para producción se necesita base de datos, aislamiento entre clientes, auditoría, límites de peticiones, claves por dispositivo, rotación de tokens y reglas de autorización por propietario.

## 8. Reconexión, fallos y recuperación

- Wi-Fi: reintento cada 12 s y portal WiFiManager tras 120 s sin Wi-Fi; AP WPA2 con contraseña aleatoria persistente visible en la LCD.
- WSS: *backoff* 2,4,8,… hasta 60 s + jitter; ping cada 20 s, pérdida de pong a los 70 s; nunca envía Bearer antes de validar TLS.
- Reloj: sincronización NTP inicial. Para un arranque sin hora válida la negociación TLS fallará de modo seguro y se reintentará.
- Desconexión: mantiene la última plantilla y datos visibles, con indicador rojo en la esquina.
- JSON o plantilla inválidos: rechazar y emitir ACK negativo; nunca ejecutar nombres de funciones recibidos por JSON.
- Corte de alimentación: últimos datos guardados (pueden tener hasta 30 s de atraso) y plantilla persistente.
- Fallo de actualización de CA privada: rollback automático si no logra WebSocket válido después de activarse; WiFiManager sigue disponible como recuperación local.

## 9. Seguridad, limitaciones y pendientes de homologación

1. Un **CA bundle** no significa mantenimiento cero: el dispositivo necesita nuevas versiones de firmware firmadas para refrescar CA públicas a lo largo de su vida.
2. El portal WiFiManager usa HTTP local dentro de un AP WPA2, no HTTPS; el propietario debe configurarlo en un entorno confiable y el fabricante debe verificar la protección de credenciales en almacenamiento flash.
3. El código firmware está preparado para pruebas de integración pero **NO ha sido compilado ni probado en la placa física en este entorno**. Ajustar orientación X, inversión de colores e inicialización exacta JD9853 según la revisión real.
4. El demo backend no tiene persistencia, ni múltiples tenants, ni CA privada automática del servidor. Para certificados públicos se recomienda Caddy/Traefik con ACME.
5. Se requiere prueba de OTA end-to-end, rotación de CA, logs sin secretos, recuperación de corte de energía, validación del flujo de provisioning, revisión de arranque seguro y actualización del almacén público.
6. El driver táctil v1 es lectura I²C AXS5106L de un contacto y reporta `tap` al inicio de la pulsación. Gestos multitáctiles/long_press quedan fuera de la versión inicial.

## 10. Ejemplo de integración rápida

```bash
# En el servidor de ejemplo, por ejemplo con Caddy delante:
cd server && npm install
export DEVICE_TOKEN='un-secreto-largo-y-distinto-para-el-dispositivo'
export ADMIN_TOKEN='otro-secreto-largo-para-la-api-admin'
npm start
# Desplegar el reverse proxy Caddy con TLS público y dominio válido.
```

**WiFiManager (en el dispositivo)**: SSID y contraseña Wi-Fi, `wss://display.tudominio.com/ws/device`, Bearer token del dispositivo, CA privada opcional en base64 DER. En repositorios de clientes, prohibido subir tokens, passwords o llaves de firma.

### Operaciones API de ejemplo

```bash
curl -X PATCH https://display.tudominio.com/api/v1/devices/md-34B7DA01ABCD/data \
  -H 'Authorization: Bearer TOKEN_ADMIN' \
  -H 'Content-Type: application/json' \
  -d '{"collectedText":"$3.100.000","progress":7.75}'
```

## 11. Criterios de aceptación

- [ ] Inicialización LCD correcta en 172×320, sin colores invertidos.
- [ ] Coordenadas táctiles coinciden con píxeles; una pulsación física genera un solo evento.
- [ ] Portal WiFiManager nuevo y reconexión con credenciales almacenadas.
- [ ] Rechazo a `ws://`, certificado expirado, hostname falso y token equivocado.
- [ ] Arranque sin servidor: última plantilla/datos visibles.
- [ ] Cache hit: `device.hello` no descarga plantilla de igual versión.
- [ ] Cambio de plantilla reinicia disposición sin flashear firmware.
- [ ] Botón `hybrid`: feedback inmediato + `touch.tap` + `ui.result` ligado al evento.
- [ ] Duplicado `eventId`: backend procesa la acción una sola vez.
- [ ] Wi-Fi cae: recuperar automáticamente sin perder el estado.
- [ ] CA privada: stage/activate, éxito y rollback probado.
- [ ] OTA: rechazar firmware sin firma válida y probar imagen válida/rollback.
- [ ] Evaluación de secretos en NVS, Secure Boot, Flash Encryption y hardening.
