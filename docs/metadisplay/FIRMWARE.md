# Firmware MetaDisplay: soporte del contrato 1.3

Instrucciones para actualizar el firmware de la pantalla (hoy **1.2.0**, en `MetaDisplay-C6-Touch/firmware`) a las plantillas del contrato 1.3 que sirve el servidor atekos. Las novedades llegaron con la 1.1, en producción desde el 2026-11-08; la 1.2 quitó `params` (las variables solo llegan por los datos) y la 1.3 añadió la **ficha de la placa** (§2.6): modelo, pantalla y botones, que la web muestra. Están escritas para entregárselas tal cual a quien programe el firmware, sea una persona o un agente de IA.

**Qué pasa hoy:** el servidor ya envía las plantillas nuevas. El firmware 1.2.0 las rechaza con `template.ack ok:false reason:"invalid_template"` y se queda con la anterior, y descarta los mensajes de más de 8192 bytes. Cuando este trabajo esté hecho, la pantalla dibujará todo lo que muestra la vista previa de la web.

**Fuentes de verdad** (si algo de aquí no cuadra con ellas, mandan ellas):

| Qué | Dónde |
|---|---|
| Contrato publicado (todos los mensajes y campos) | https://atekos.toxolinko.site/contrato y `/api/v1/contract/asyncapi.json` (también en `docs/metadisplay/generado/asyncapi.json`) |
| Guía de plantillas (lo que ve quien las escribe) | [`PLANTILLAS.md`](PLANTILLAS.md) |
| Semántica de la capa dinámica (binds, when, format, animación) | [`packages/shared/src/render.ts`](../../packages/shared/src/render.ts) |
| Formato de las imágenes | [`packages/shared/src/image.ts`](../../packages/shared/src/image.ts) |
| Esquemas exactos (rangos de cada campo) | [`packages/shared/src/index.ts`](../../packages/shared/src/index.ts), sección MetaDisplay |
| Plantilla de prueba con todo lo nuevo | [`examples/showcase-template.json`](examples/showcase-template.json), con sus datos en [`examples/showcase-data.json`](examples/showcase-data.json) |

El repositorio es público: `https://github.com/PauloPabDev/atekos-pelugios` (rama `main`).

## 0. Resumen y orden de trabajo

Hazlo por fases. Al acabar cada una, la pantalla tiene que seguir funcionando con las plantillas 1.0, y la capacidad nueva se anuncia en el `hello` (§2.1):

| Fase | Qué | Capacidades que anuncia | Sección |
|---|---|---|---|
| 1 | Mensajes grandes (`frag`) y plantilla guardada en flash sin cargarla entera en RAM | `frag` | §3, §4, §5 |
| 2 | Rotación, grosor y formas nuevas | `rotation`, `stroke`, `circle`, `ellipse`, `polygon`, `arc`, `curve` | §6, §7 |
| 3 | Imágenes | `image` | §8 |
| 4 | Capa dinámica: `bind`, `binds`, `when` y `format` sobre los datos | `binds`, `rules` | §9 |
| 5 | Animación | `animation` | §10 |
| 6 | Botones físicos | `buttons` | §11 |
| 7 | Ficha de la placa en el `hello` y respuesta a `display.info` | `info` | §2.1, §2.6 |

Sube `FIRMWARE_VERSION` a **`1.3.0`** (`include/Runtime.h`). El protocolo sigue siendo `1`.

## 1. Restricciones de la placa

Todo el diseño sale de aquí:

- **ESP32-C6 sin PSRAM:** 512 KB de SRAM, de los que WiFi y TLS se comen buena parte. Una plantilla puede ocupar hasta **1 MB**, así que **nunca cabe entera en RAM**: la estructura va a un `JsonDocument` y los píxeles se quedan en la flash (§4).
- **LittleFS de 1,875 MB** (partición `spiffs` de `partitions.csv`). Durante el cambio de plantilla conviven la nueva y la anterior.
- **Tramas de 8192 bytes como máximo**, en los dos sentidos (`WssClient::MAX_FRAME`). No se cambia: el servidor trocea lo que pase de ahí (§3).
- **Waveshare ESP32-C6-LCD-1.47:** ST7789 de 172×320, sin pantalla táctil y con **un solo botón**, el BOOT en el GPIO 9 (activo en LOW). El bus SPI va a 20 MHz: borrar la pantalla entera cuesta unos 45 ms.
- Un solo núcleo: los bucles largos (procesar 1 MB, dibujar una imagen grande) tienen que ceder la CPU con `delay(1)` cada pocos KB, o salta el watchdog.

## 2. Mensajes: qué cambia

### 2.1 `device.hello` (pantalla → servidor)

- `display.buttons`: cuántos botones físicos tiene (en esta placa, `1`).
- `board` (1.3): qué placa es. Todos sus campos son opcionales y se admiten más (`model` ≤ 64, `chip` ≤ 32, `mac` ≤ 32, `flashBytes`, `psramBytes`).
- `display.driver` (1.3, opcional): el controlador del panel, p. ej. `"ST7789"`. `display` admite más campos (`color`…).
- `buttons` (1.3): un objeto por botón físico, `{ button, name?, gpio? }`. `button` es el índice lógico que usan las acciones (0..15), `name` ≤ 24 y `gpio` 0..64. Sale del mapa `BUTTONS[]` de `Board.h` (§11).
- `capabilities`: se mantienen las de la 1.2.0 y se añaden las que ya estén hechas, como mucho 64 de ≤ 32 caracteres. Hoy el servidor no las comprueba, pero quedan en el log.

```json
{ "type": "device.hello", "protocol": 1, "deviceId": "md-34B7DA01ABCD", "firmware": "1.3.0",
  "board": { "model": "Waveshare ESP32-C6-LCD-1.47", "chip": "ESP32-C6", "mac": "34:B7:DA:01:AB:CD",
    "flashBytes": 4194304, "psramBytes": 0 },
  "display": { "width": 172, "height": 320, "touch": false, "color": "RGB565", "buttons": 1, "driver": "ST7789" },
  "buttons": [{ "button": 0, "name": "BOOT", "gpio": 9 }],
  "template": { "id": "showcase.v1", "version": 1 },
  "capabilities": ["text", "rect", "line", "button", "progress", "touch.tap", "ui.result", "template.cache",
    "rotation", "stroke", "circle", "ellipse", "polygon", "arc", "curve", "image",
    "animation", "binds", "rules", "buttons", "frag", "info"] }
```

`display.width/height` siguen siendo los del panel en vertical, sea cual sea la rotación de la plantilla.

El servidor guarda la ficha (`firmware`, `board`, `display`, `buttons`, `capabilities`) y la web la enseña en la pestaña «Ajustes» de la pantalla. Una placa que no la manda sigue funcionando: la web dice que no hay datos.

### 2.2 `touch.tap` (pantalla → servidor)

Tres campos opcionales nuevos:

- `source`: `"touch"` o `"button"`.
- `button`: índice del botón, de 0 a 15.
- `press`: `"short"` o `"long"`.

Con un botón, `x,y` es el centro de la zona de la acción, o `0,0` si no tiene zona. **No se envía el `payload`:** el servidor lo lee de la plantilla activa a partir del `actionId`.

```json
{ "type": "touch.tap", "eventId": "md-34B7DA01ABCD-123456-7", "deviceId": "md-34B7DA01ABCD",
  "actionId": "pulsar", "name": "data.set", "x": 260, "y": 152,
  "templateId": "showcase.v1", "templateVersion": 1, "uptimeMs": 123456,
  "source": "button", "button": 0, "press": "short" }
```

La cola de eventos pendientes, el reintento cada 5 s y `event.ack` no cambian.

### 2.3 `frag` (servidor → pantalla) y `frag.ack` (pantalla → servidor)

Cuando un mensaje pasa de 8192 bytes, el servidor lo trocea: el mensaje en UTF-8 se corta en trozos de 6000 bytes, cada trozo va en base64 en un `frag`, y los `frag` se envían **seguidos y en orden**, sin nada intercalado.

```json
{ "type": "frag", "id": "6f1c0e2a-…", "seq": 0, "count": 23, "bytes": 135000, "data": "<base64>" }
```

| Campo | Qué es |
|---|---|
| `id` | Identifica el mensaje troceado (≤ 64 caracteres). |
| `seq` | Número del trozo, de `0` a `count-1`. |
| `count` | Número total de trozos (≥ 2). |
| `bytes` | Tamaño del mensaje original, en bytes. |
| `data` | Los bytes del trozo en base64. Como la trama no pasa de 8192, un trozo nunca trae más de 6144 bytes. |

Al terminar, la pantalla contesta `{ "type": "frag.ack", "id": "…", "ok": true }`. Si descarta el mensaje, contesta `ok: false` con un `reason` de ≤ 100 caracteres: `too_large`, `incomplete`, `out_of_order`, `bad_data` o `storage_failed`. El servidor solo registra el `frag.ack`; los acks que importan son los del mensaje reensamblado (`template.ack`, `data.ack`).

En la práctica, lo que llega troceado es un `template.set`. También puede llegar así un `data.update` o un `ui.result` con `patch`: 64 valores de 140 caracteres rondan los 12 KB.

### 2.4 `template.ack` (pantalla → servidor)

Igual que en la 1.2.0, con estos `reason` además de `invalid_template` y `storage_failed`:

- `unsupported_element`: un tipo de elemento que este firmware no conoce.
- `too_large`: no cabe en la flash, o su estructura no cabe en RAM.

Si la plantilla falla, la pantalla conserva la anterior, salvo que haya tenido que borrarla para hacer sitio (§4.3).

### 2.5 Sin cambios

`data.update`, `data.ack`, `ui.result`, `event.ack`, `display.refresh` y `display.brightness` funcionan igual. `trust.*` y `ota.install` quedan como están; atekos no los envía.

### 2.6 `display.info` (servidor → pantalla) y `device.info` (pantalla → servidor), 1.3

Con la placa ya conectada, la web («Pedir ficha») o la API (`POST /api/v1/displays/{deviceId}/commands` con `{ "type": "display.info" }`) le piden la ficha:

```json
{ "type": "display.info" }
```

La placa responde con `device.info`: los mismos campos que el `hello` **sin `protocol` ni `template`**. Conviene que el firmware arme los dos mensajes con la misma función.

```json
{ "type": "device.info", "deviceId": "md-34B7DA01ABCD", "firmware": "1.3.0",
  "board": { "model": "Waveshare ESP32-C6-LCD-1.47", "chip": "ESP32-C6", "flashBytes": 4194304 },
  "display": { "width": 172, "height": 320, "touch": false, "buttons": 1, "driver": "ST7789" },
  "buttons": [{ "button": 0, "name": "BOOT", "gpio": 9 }],
  "capabilities": ["text", "rect", "info"] }
```

- Puede enviarse también sin que se pida, si algo cambia (por ejemplo, tras configurar un botón nuevo).
- `deviceId` tiene que ser el de la placa: con otro, el servidor cierra con 1008.
- Un firmware que no conoce `display.info` lo ignora (el servidor no espera respuesta).

**Latido:** el servidor envía un ping de WebSocket cada **10 s** y da la placa por desconectada si no responde al siguiente (≤ 20 s). El cliente de `esp_websocket_client` responde los pings solo; no hay que hacer nada salvo no bloquear el `loop()` más de unos segundos. La web enseña «Sin conexión» y la hora del último contacto.

## 3. Recibir mensajes troceados

Refactoriza `Runtime::incoming(const String&)` en dos partes: una que parsea y otra, `handle(JsonDocument&)`, que hace lo de siempre. Así, un mensaje reensamblado pasa por el mismo `handle`. El límite de 8192 se mantiene solo para la trama de texto que llega del socket.

```cpp
#include "mbedtls/base64.h"

// Reensambla en /rx.tmp. Un mensaje troceado a la vez; los trozos de otro id o de uno descartado se ignoran.
struct Rx { String id; uint32_t next = 0, count = 0, bytes = 0, got = 0, lastAt = 0; File f; bool active = false; } rx_;

void Runtime::abortRx() { if (rx_.active) { rx_.f.close(); LittleFS.remove("/rx.tmp"); } rx_.active = false; }

void Runtime::onFrag(JsonVariantConst d) {   // d = el mensaje frag ya parseado
  const String id = d["id"] | "";
  const uint32_t seq = d["seq"] | 0, count = d["count"] | 0, bytes = d["bytes"] | 0;
  if (seq == 0) {
    if (rx_.active) fragAck(rx_.id, false, "incomplete");
    abortRx();
    if (count < 2 || bytes == 0 || !makeRoom(bytes)) { fragAck(id, false, "too_large"); return; }   // §4.3
    rx_.f = LittleFS.open("/rx.tmp", "w");
    if (!rx_.f) { fragAck(id, false, "storage_failed"); return; }
    rx_.id = id; rx_.count = count; rx_.bytes = bytes; rx_.next = rx_.got = 0; rx_.lastAt = millis(); rx_.active = true;
  }
  if (!rx_.active || id != rx_.id) return;
  if (seq != rx_.next) { fragAck(id, false, "out_of_order"); abortRx(); return; }
  static uint8_t buf[6144];
  const char* b64 = d["data"] | "";
  size_t n = 0;
  if (mbedtls_base64_decode(buf, sizeof buf, &n, (const uint8_t*)b64, strlen(b64)) || rx_.got + n > rx_.bytes) {
    fragAck(id, false, "bad_data"); abortRx(); return;
  }
  if (rx_.f.write(buf, n) != n) { fragAck(id, false, "storage_failed"); abortRx(); return; }
  rx_.got += n; rx_.lastAt = millis();
  if (++rx_.next < rx_.count) return;
  rx_.f.close(); rx_.active = false;
  if (rx_.got != rx_.bytes) { LittleFS.remove("/rx.tmp"); fragAck(id, false, "incomplete"); return; }
  incomingFile("/rx.tmp");   // procesa el mensaje original, con su ack habitual
  fragAck(id, true);
}
```

Reglas:

- **Cancelar a medias:** si se corta la conexión (`connected(false)`) o pasan 15 s sin trozos (comprobarlo en `loop()`), se llama a `abortRx()`. En el segundo caso, además, se envía `frag.ack ok:false reason:"incomplete"`. No hay que pedir nada: al reconectar, el `hello` lleva la plantilla vieja y el servidor vuelve a enviar la nueva.
- **`incomingFile(path)`:** lee solo el `type` con un filtro de ArduinoJson.
  - Si es `template.set`, lo instala desde el archivo (§4).
  - Si no, el mensaje cabe en RAM: lo deserializa entero, borra el archivo y llama a `handle()`.

```cpp
JsonDocument filter; filter["type"] = true;
JsonDocument head; deserializeJson(head, f, DeserializationOption::Filter(filter));
```

- **Un `template.set` que llega entero** (≤ 8192 bytes) se escribe también en `/rx.tmp`, tras un `makeRoom` de su tamaño, y sigue el mismo camino. Así solo hay una forma de instalar plantillas.

## 4. Guardar la plantilla sin cargarla entera en RAM

Casi todo el tamaño de una plantilla grande son los `data` de las imágenes, en base64. La idea es quitarlos de la estructura y dejarlos en la flash.

### 4.1 Quitar los píxeles de la estructura

Una pasada por `/rx.tmp` genera `/tpl.new`, que es el mismo JSON pero con el base64 de cada imagen cambiado por una referencia `"@<offset>:<longitud>"`: la posición de ese base64 dentro de `/rx.tmp`. Ese archivo, mucho más pequeño, es el que se carga con ArduinoJson. `/rx.tmp` se queda en la flash como `/template.raw`, y de ahí se leen los píxeles al dibujar (§8).

Una imagen es un objeto que está dentro de un array con la clave `"elements"`, tanto en `template.elements` como en `animation.frames[i].elements`. Su clave `data` es la única que se toca: un `payload` que tenga una clave `data` no se toca.

```cpp
// Copia src → dst cambiando el base64 de cada imagen por "@offset:len" (su posición en src).
bool stripImages(File& src, File& dst) {
  struct Level { bool array, elements; } st[32];
  int depth = 0;
  char key[12] = "", last[12] = "";
  size_t keyLen = 0, pos = 0, start = 0;
  bool inStr = false, esc = false, isKey = false, expectKey = false, skip = false;
  uint8_t buf[512];
  for (size_t n; (n = src.read(buf, sizeof buf)) > 0; delay(1)) {
    for (size_t i = 0; i < n; i++, pos++) {
      const char c = buf[i];
      if (skip) {   // dentro del base64 de una imagen: no se copia
        if (c == '"') { dst.printf("@%u:%u\"", unsigned(start), unsigned(pos - start)); skip = false; }
        else if (c == '\\') return false;
        continue;
      }
      if (inStr) {
        dst.write(c);
        if (esc) esc = false;
        else if (c == '\\') esc = true;
        else if (c == '"') { inStr = false; if (isKey) { key[keyLen] = 0; strcpy(last, key); } }
        else if (isKey && keyLen < sizeof key - 1) key[keyLen++] = c;
        continue;
      }
      if (c == '"') {
        dst.write(c);
        isKey = depth > 0 && !st[depth - 1].array && expectKey;
        if (!isKey && !strcmp(last, "data") && depth >= 2 && !st[depth - 1].array && st[depth - 2].elements) {
          skip = true; start = pos + 1;
        } else { inStr = true; keyLen = 0; }
        continue;
      }
      if (c == '{' || c == '[') {
        if (depth == 32) return false;
        st[depth++] = { c == '[', c == '[' && !strcmp(last, "elements") };
        expectKey = c == '{'; last[0] = 0;
      } else if (c == '}' || c == ']') { if (depth) depth--; expectKey = false; }
      else if (c == ',') expectKey = depth > 0 && !st[depth - 1].array;
      else if (c == ':') expectKey = false;
      dst.write(c);
    }
  }
  return !skip && !inStr && depth == 0;
}
```

### 4.2 Instalar

1. `stripImages("/rx.tmp" → "/tpl.new")`. Si falla: `template.ack ok:false reason:"invalid_template"`.
2. Deserializar `/tpl.new` con `DeserializationOption::NestingLimit(16)`. Con el límite por defecto, 10, una regla `when` dentro de un fotograma ya se queda justa.
   - Si da `DeserializationError::NoMemory`: `reason:"too_large"`. La plantilla puede no tener límite de elementos, pero la RAM sí lo tiene.
3. Validar (§5).
4. Si todo va bien, cambiar los archivos como hace hoy `persistTemplate()`:
   - cerrar el `File` de `/template.raw` que usa el dibujo;
   - borrar `/template.json` y `/template.raw`;
   - renombrar `/tpl.new` → `/template.json` y `/rx.tmp` → `/template.raw`;
   - volver a abrir `/template.raw`.

   Luego actualizar `tmpl_`, `templateId_` y `templateVersion_`, reiniciar la animación (§10) y responder `template.ack ok:true`.
5. Si algo falla, borrar `/tpl.new` y `/rx.tmp` y quedarse con la plantilla que hubiera.

**Al arrancar** (`load()`), se lee `/template.json`. Una plantilla guardada por la 1.2.0 no tiene imágenes ni `/template.raw`, y carga igual. Antes de leer los píxeles de cualquier imagen, se comprueba que `offset + len ≤ tamaño de /template.raw`. Si no cuadra, la imagen no se dibuja.

### 4.3 Hacer sitio (`makeRoom`)

Se calcula el espacio libre como `LittleFS.totalBytes() - LittleFS.usedBytes()`. Hace falta sitio para `bytes` más un margen de unos 48 KB (la estructura y `values.json`):

1. Si cabe junto a la plantilla actual, adelante: la actual se conserva si la nueva falla.
2. Si no cabe, se borran antes `/template.json` y `/template.raw` (`hasTemplate_ = false`) y se muestra «Recibiendo plantilla».
   - Si la nueva falla después, la pantalla se queda sin plantilla. Al reconectar, el `hello` sin plantilla hace que el servidor la reenvíe.
   - Con plantillas cerca de 1 MB, el cambio solo es posible por este camino.
3. Si ni así cabe: `false`, y el mensaje se descarta con `frag.ack reason:"too_large"`.

## 5. Validar en la pantalla

El servidor ya valida cada plantilla con el esquema completo, incluidos los límites del lienzo y las variantes de `when`. La pantalla solo comprueba lo que la protege a ella. Sustituye `validTemplate()` por esto:

- `id`: un string de ≤ 64 caracteres. `version`: un `uint32`. `rotation`: si viene, solo `0`, `90`, `180` o `270`.
- `elements`: un array. Cada `type` tiene que ser uno de los 11 conocidos (`text`, `rect`, `line`, `progress`, `button`, `circle`, `ellipse`, `polygon`, `arc`, `curve`, `image`); si no, `reason:"unsupported_element"`.
- `image`:
  - `encoding` es `rgb565` o `rgb565-rle`.
  - `data` es una referencia `@offset:len` válida (§4.2).
  - Con `rgb565`, la longitud en base64 da exactamente `w·h·2` bytes.
  - Un RLE no se verifica entero: al dibujarlo, nunca se pinta más allá de `w·h` píxeles.
- `polygon`: de 2 a 64 puntos; `curve`: 3 o 4.
- `animation`: si viene, un `frames` con al menos un fotograma, cada uno con `ms` de 20 a 60 000 y su `elements` (con las mismas comprobaciones).
- `actions`: un array.
  - `trigger` es `tap` (con `x,y,w,h`) o `button`.
  - En `button`: `button` de 0 a 15 y `press`, si viene, `short` o `long`.
  - `mode` es `local`, `remote` o `hybrid`.
- **Se acaban los topes de 45 elementos y 24 acciones**, y la pantalla ya no comprueba los límites contra 172×320: lo que se salga del lienzo lo recorta Arduino_GFX.
- Las propiedades que no conozca se ignoran, sin rechazar la plantilla.

## 6. Lienzo y rotación

- **Al dibujar:** `gfx_->setRotation(rotation / 90)` al empezar cada `render()`. El lienzo pasa a medir `gfx_->width() × gfx_->height()`: 172×320 o 320×172.
  - Hay que comprobarlo en la placa: con 90 y 270 no tienen que aparecer franjas de basura. El panel lleva un offset de 34 columnas, que Arduino_GFX aplica con los offsets del constructor de `Arduino_ST7789`.
  - Apunta en `Board.h` hacia dónde queda el conector USB con cada valor, para que quien escribe plantillas sepa cómo girar la placa.
- **Origen (0,0):** la esquina superior izquierda tal como se ve con esa rotación. Todo va en ese sistema: elementos, zonas de las acciones y las `x,y` de `touch.tap`.
- **Pantallas del sistema:** `status()` y `portalInfo()` siguen en vertical, con `setRotation(0)` antes de dibujar.
- **Superposiciones:** el punto de conexión, el toast de `feedback()` y el resaltado de las acciones se colocan con `gfx_->width()`/`height()`, no con `board::WIDTH`/`HEIGHT`.
- **Variante táctil** (Touch-LCD-1.47, no es esta placa): a las coordenadas del táctil se les aplica la misma rotación. Se comprueba tocando las cuatro esquinas.

## 7. Dibujo

Orden de cada `render()`:

1. El fondo (`background`).
2. Los `elements`, en orden.
3. Los elementos del fotograma actual de la animación.
4. El contorno de la acción seleccionada (modo 1.2.0, §11).
5. El resaltado de un botón pulsado.
6. El punto de conexión.
7. El toast.

Antes de dibujar, cada elemento pasa por la capa dinámica (§9).

**Valores por defecto:** los elementos de la 1.0 (`text`, `rect`, `line`, `progress`, `button`) se dibujan **exactamente como en la 1.2.0**, con sus mismos valores por defecto. Los nuevos usan `color = #FFFFFF` y, si están rellenos, `fillColor`; si no hay `fillColor`, `color`.

**Grosor (`stroke`, de 1 a 32 px, por defecto 1):** en `rect` va hacia dentro de la caja. En el resto va centrado sobre la línea geométrica, como en SVG. Con `stroke: 1` se usan las primitivas de Arduino_GFX, para que el dibujo sea exacto. Con más grosor, todo se reduce a una función `thickLine(x0, y0, x1, y1, s, color)`:

- Un cuadrilátero de ancho `s` alrededor del segmento, con dos `fillTriangle`.
- En las polilíneas, un `fillCircle` de radio `s/2` en cada vértice para que no queden huecos.

Las uniones redondeadas no son idénticas a las de SVG, pero sirven: la vista previa de la web ya avisa de que es aproximada.

| Elemento | Cómo dibujarlo |
|---|---|
| `text`, `progress`, `button` | Como en la 1.2.0, pero el texto es el `value` ya resuelto (§9), que incluye `format`. |
| `rect` | `filled`: `fillRoundRect` como hoy. Si no, `stroke` contornos hacia dentro: `drawRoundRect(x+i, y+i, w-2i, h-2i, radius)` para `i` de 0 a `stroke-1`. |
| `line` | `drawLine`, o `thickLine` si `stroke > 1`. |
| `circle {x,y,r}` | `filled`: `fillCircle`. Si no: `drawCircle`, o con `stroke > 1` un anillo de `r - s/2` a `r + s/2` (`fillArc` de 0 a 360). |
| `ellipse {x,y,rx,ry}` | `filled`: `fillEllipse`. Si no: `drawEllipse`, o con `stroke > 1` la elipse muestreada en unos 48 puntos como polilínea cerrada con `thickLine`. |
| `polygon {points, closed}` | `filled`: relleno por barrido (código abajo). Si no: polilínea, cerrada salvo `closed: false`. |
| `arc {x,y,r,start,end}` | Siempre con trazo, nunca relleno. Ver la nota de debajo. |
| `curve {points}` | 3 puntos: Bézier cuadrática; 4: cúbica. Se muestrea en 24 segmentos y se dibuja como polilínea abierta. |
| `image` | §8. |

**Arcos:** los ángulos van en grados, con **0 a las 3 en punto** y creciendo **en sentido horario**.

- Si `|end − start| ≥ 360`, es un círculo completo.
- Si no, el barrido es `((end − start) mod 360 + 360) mod 360`, que va desde `start` en sentido horario; con barrido 0 no se dibuja nada.
- Para dibujarlo, `fillArc(x, y, r - s/2, r + s/2, start, start + barrido)`, o el arco muestreado como polilínea. Comprueba en la placa que el `fillArc` de Arduino_GFX usa el mismo 0° y el mismo sentido; si no, conviértelo.

```cpp
// Polígono relleno par-impar por filas (≤ 64 vértices): cortes con las aristas a media fila, ordenados, de dos en dos.
void fillPolygon(Arduino_GFX* g, const int16_t (*pt)[2], int n, uint16_t c) {
  int y0 = g->height(), y1 = -1;
  for (int i = 0; i < n; i++) { y0 = min<int>(y0, pt[i][1]); y1 = max<int>(y1, pt[i][1]); }
  y0 = max(y0, 0); y1 = min<int>(y1, g->height() - 1);
  int16_t xs[64];
  for (int y = y0; y <= y1; y++) {
    int k = 0; const float yc = y + 0.5f;
    for (int i = 0, j = n - 1; i < n; j = i++) {
      const float ya = pt[i][1], yb = pt[j][1];
      if ((ya <= yc) != (yb <= yc)) xs[k++] = lroundf(pt[i][0] + (yc - ya) * (pt[j][0] - pt[i][0]) / (yb - ya));
    }
    std::sort(xs, xs + k);
    for (int i = 0; i + 1 < k; i += 2) g->drawFastHLine(xs[i], y, xs[i + 1] - xs[i] + 1, c);
  }
}
```

Las curvas se calculan con la fórmula de Bézier, para `t = i/24`:

- Cuadrática: `(1−t)²·P0 + 2(1−t)t·P1 + t²·P2`.
- Cúbica: `(1−t)³·P0 + 3(1−t)²t·P1 + 3(1−t)t²·P2 + t³·P3`.

## 8. Imágenes

Una imagen es un rectángulo de `w×h` píxeles RGB565, por filas, de arriba abajo, en base64. El formato completo está en [`PLANTILLAS.md`](PLANTILLAS.md) §4:

- `rgb565`: 2 bytes por píxel, el alto primero.
- `rgb565-rle`: tramos de 3 bytes `[n-1][color alto][color bajo]` de 1 a 256 píxeles iguales. Un tramo puede seguir en la fila siguiente.

Se dibujan **leyendo el base64 desde `/template.raw` por trozos**, con un búfer de una fila. Los trozos son de 512 caracteres, que dan 384 bytes: un número par y múltiplo de 3, así que ni un píxel ni un tramo quedan nunca partidos entre dos trozos.

```cpp
// Imagen guardada como "@offset:len" (su base64 dentro de /template.raw). Nunca pinta más de w·h píxeles.
void drawImage(Arduino_GFX* g, File& raw, int x, int y, int w, int h, bool rle, const char* ref) {
  unsigned off = 0, len = 0;
  if (sscanf(ref, "@%u:%u", &off, &len) != 2 || len % 4 || off + len > raw.size() || w > 320) return;
  static uint16_t row[320]; static uint8_t b64[512], bytes[384];
  const uint32_t total = uint32_t(w) * h;
  uint32_t p = 0; int col = 0;
  auto put = [&](uint16_t c, uint32_t n) {
    while (n-- && p < total) {
      row[col++] = c; p++;
      if (col == w) { g->draw16bitRGBBitmap(x, y + (p - 1) / w, row, w, 1); col = 0; }
    }
  };
  raw.seek(off);
  for (unsigned done = 0; done < len && p < total; delay(1)) {
    const size_t k = raw.read(b64, min<unsigned>(sizeof b64, len - done));
    size_t n = 0;
    if (!k || mbedtls_base64_decode(bytes, sizeof bytes, &n, b64, k)) return;
    done += k;
    if (!rle) for (size_t i = 0; i + 1 < n; i += 2) put((bytes[i] << 8) | bytes[i + 1], 1);
    else for (size_t i = 0; i + 2 < n; i += 3) put((bytes[i + 1] << 8) | bytes[i + 2], bytes[i] + 1);
  }
}
```

`draw16bitRGBBitmap` recibe los colores como enteros: los bytes ya se han combinado arriba, así que no hay que intercambiarlos. La rotación la aplica Arduino_GFX. Para probar el formato, la web genera imágenes con «Importar imagen».

## 9. Capa dinámica: las funciones sobre los datos

Es una traducción directa de [`render.ts`](../../packages/shared/src/render.ts). No se ejecuta código: son comparaciones y sustituciones declarativas.

### 9.1 Valores

El valor de una variable `clave` es el recibido en `data_` (los `values` de los `data.update`), **aunque sea `null`**. Si `data_` no la tiene, la variable no existe. La plantilla no trae valores propios: si una plantilla antigua aún lleva `params`, se ignora.

`null` y «no existe» son distintos, así que la presencia hay que comprobarla recorriendo el objeto: `isNull()` no basta.

```cpp
bool has(JsonObjectConst o, const char* k) { for (JsonPairConst p : o) if (!strcmp(p.key().c_str(), k)) return true; return false; }

bool Runtime::lookup(const char* k, JsonVariantConst& v) {
  if (!has(data_.as<JsonObjectConst>(), k)) return false;
  v = data_[k];
  return true;
}
```

### 9.2 Orden de evaluación de cada elemento (`resolveElement`)

1. Se copia el elemento a un `JsonDocument` pequeño (las imágenes ya no llevan píxeles) y se quitan `binds` y `when`.
2. **`bind`** (atajo de la 1.0): `value` pasa a ser el valor de la variable. Si la variable no existe, el `value` se borra y el texto queda vacío. Después se quita `bind`.
3. **`binds`** (`{propiedad: clave}`): para cada propiedad, si la variable existe y se puede convertir al tipo de la propiedad (tabla de debajo), sustituye a la base. Si no, se queda la base.
4. **`when`**, en orden: cada regla que se cumple (§9.3) copia las propiedades de su `set` encima. Varias reglas pueden cumplirse, y gana la última.
5. Si `visible` es `false`, el elemento no se dibuja.
6. Si hay `format` (un string), `value` pasa a ser el texto formateado (§9.4).
7. **Recorte de rangos.** Antes de dibujar, cada número se limita al rango del contrato, porque `binds` puede traer cualquier cosa:
   - coordenadas: 0..319;
   - `w`, `h`, `r`, `rx` y `ry`: 1..320;
   - `stroke`: 1..32;
   - `size`: 1..4;
   - `radius`: 0..10;
   - `start`/`end`: −360..360.

| Propiedad de destino | Conversión del valor de la variable |
|---|---|
| `color`, `fillColor` | Solo un string `#RRGGBB`; si no, se queda la base. |
| `filled`, `closed`, `visible` | `truthy(v)` (§9.3). |
| `value` | El valor tal cual: string, número, booleano o null. |
| `format` | Solo si es un string. |
| Cualquier otra (`x`, `y`, `w`, `h`, `x2`, `y2`, `r`, `rx`, `ry`, `start`, `end`, `size`, `stroke`, `radius`) | Un número, o un string que, entero, sea un número, como `"12.7"` (se admiten espacios alrededor; `""` no vale). Se **redondea al entero más cercano**, con los .5 hacia arriba (`Math.round`: 2.5 → 3, −2.5 → −2). Si no es un número, se queda la base. |

`binds` nunca trae `type`, `bind`, `points`, `encoding` ni `data`, ni tampoco `w`/`h` en una imagen; el servidor ya lo ha comprobado.

### 9.3 Reglas (`when: [{ key, op, value, set }]`)

`a` es el valor de la variable `key` (§9.1); puede no existir.

| `op` | Se cumple si |
|---|---|
| `truthy` | `truthy(a)` |
| `falsy` | `!truthy(a)` |
| `eq` / `ne` | `a` y `value` son del mismo tipo y valen lo mismo (o no). Sin conversión: `5` no es igual a `"5"`, pero `5` sí es igual a `5.0`. Si `a` no existe, `eq` es falso y `ne`, verdadero. |
| `gt`, `gte`, `lt`, `lte` | Ambos se convierten a número y se comparan. Si `a` es booleano, null o no existe, o si alguno no es un número, **no se cumple**. |

- **`truthy(v)`** es verdadero con `true`, con un número distinto de 0 y con un string que no sea `""`, `"0"` ni `"false"`. Un `null` y una variable que no existe son falsos.
- **Conversión a número en las reglas** (es la de `Number()` de JavaScript): un string pasa a número si, entero, es un número, con espacios alrededor; aquí `""` cuenta como `0`. Del lado de `value`: `true` vale 1, y `false` y `null` valen 0.

### 9.4 `format`

`"Temp: {temp} C"`: cada `{clave}` se sustituye por el valor de esa variable. La clave tiene de 1 a 40 caracteres, sin llaves dentro.

- Un string va tal cual.
- Un número, como lo imprime `serializeJson` (`21.5` → `21.5`, `3` → `3`).
- Un booleano, como `true` o `false`.
- Si la variable es `null` o no existe, queda vacío.

Una `{` que no cierra se deja tal cual.

### 9.5 Cuándo se recalcula

Se recalcula en cada `render()`: cuando cambian los valores (`data.update`, `ui.result.patch` o `set_value` local), cuando cambia el fotograma de la animación y cuando cambia la plantilla.

Para comprobar el resultado, carga en la web el ejemplo avanzado («Cargar ejemplo avanzado»), envía sus datos (en «Datos», «Cargar datos de ejemplo» y «Reemplazar») y cámbialos:

- Con `temp > 30`, el texto se vuelve rojo.
- `alarma: true` muestra el triángulo y el `!`.
- `angulo` mueve el final del arco.

## 10. Animación

`animation = { frames: [{ ms, elements }], repeat }`. Encima de los `elements` de la plantilla se dibujan los del fotograma actual. Se reinicia (`animStart_ = millis()`) al instalar o cargar una plantilla.

```cpp
// currentFrame de render.ts. repeat 0 (o ausente) = siempre; al acabar las vueltas se queda en el último fotograma.
int currentFrame(JsonArrayConst frames, uint32_t repeat, uint32_t elapsed) {
  uint32_t total = 0;
  for (JsonObjectConst f : frames) total += f["ms"].as<uint32_t>();
  if (repeat > 0 && uint64_t(elapsed) >= uint64_t(total) * repeat) return frames.size() - 1;
  uint32_t t = elapsed % total; int i = 0;
  for (JsonObjectConst f : frames) { const uint32_t ms = f["ms"]; if (t < ms) return i; t -= ms; i++; }
  return frames.size() - 1;
}
```

- En `loop()`, se calcula `currentFrame(…, millis() - animStart_)`. Si el índice cambia, `dirty_ = true`.
- El índice sale del tiempo real, así que si un redibujado tarda más que el fotograma, los fotogramas intermedios se saltan sin perder el ritmo. El límite actual de un redibujado cada 120 ms como mucho puede quedarse.
- **Parpadeo:** borrar y redibujar la pantalla entera parpadea. Si después de conectar el TLS queda un bloque libre de ≥ 120 KB (`heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)`), se puede dibujar en un `Arduino_Canvas` del tamaño del panel y luego hacer `flush()`. Si no queda, se dibuja directo y se acepta el parpadeo. Mide antes de decidir.

## 11. Botones físicos

**Mapa de botones:** en `Board.h`, `constexpr int BUTTONS[] = { 9 };`. El índice lógico es la posición en ese array: el 0 es el BOOT, y `display.buttons` es su longitud.

- Para añadir botones, se usan GPIO libres. Hay que evitar los del LCD y la SD (4, 6, 7, 14, 15, 21 y 22), los de arranque del C6 (4, 5, 8, 9 y 15) y los del USB (12 y 13).
- Van con `INPUT_PULLUP`, activos en LOW.

**Detección**, por botón, igual que hoy en `main.cpp`:

- Antirrebote de 30 ms.
- **Larga:** se dispara una vez al llegar a 700 ms con el botón pulsado.
- **Corta:** al soltar, si se ha mantenido entre 30 y 700 ms.

La llamada pasa a ser `runtime.button(indice, largo)`.

**Qué hace cada pulsación:**

1. **Si la plantilla tiene alguna acción con `trigger: "button"`, mandan esas.** Se busca la acción con `button == indice` y `(press | "short") == pulsación`.
   - Si no hay ninguna, se muestra el toast «Sin accion» y no pasa nada más.
   - Si la hay:
     - si tiene zona (`x,y,w,h`), se **resalta** con un contorno de 2 px en `0xFFE0` alrededor durante unos 300 ms y luego se redibuja;
     - en `local`/`hybrid` se ejecuta `local`, como hoy;
     - en `remote`/`hybrid` se envía el `touch.tap` de §2.2, con `source: "button"`, `button`, `press` y `x,y` en el centro de la zona, o `0,0`.
2. **Si no tiene ninguna, se conserva el comportamiento de la 1.2.0:** solo el botón 0 hace algo.
   - La corta ejecuta la acción `tap` seleccionada.
   - La larga pasa a la siguiente acción.
   - El `touch.tap` añade `button: 0` y `press: "short"`.

En una placa sin pantalla táctil, las acciones `tap` de una plantilla que también tenga acciones de botón no se pueden lanzar; en una placa táctil se lanzan tocando la pantalla, con `source: "touch"`.

El servidor responde con `ui.result`, que muestra el toast y aplica el `patch`. Con `event: "data.set"`, además, publica un `data.update` patch a todas las conexiones, así que la pantalla que pulsó recibe el mismo cambio dos veces; es idempotente. Toasts posibles: `Datos cambiados`, `Datos invalidos`, `Pantalla cambiada`, `Datos actualizados`, `Accion recibida` y `Accion desactualizada`.

## 12. Pruebas de aceptación

Las pruebas se hacen contra atekos, en local o en producción: se da de alta una pantalla en la web con su `deviceId` (`md-…`) y la placa se configura con la URL del WSS y su token.

1. **Compatibilidad:** `examples/status-template.json` y `examples/goal-template.json` se ven igual que con la 1.2.0.
2. **Ejemplo avanzado:** «Cargar ejemplo avanzado», guardar y activar; después, en «Datos», «Cargar datos de ejemplo» y «Reemplazar». La placa en horizontal (320×172) tiene que verse como la vista previa: icono, barra, curva, triángulo oculto, círculo, arco, elipse, rectángulo y botón, con el punto que parpadea cada 500 ms.
3. **Variables:** desde el editor «Datos» de la web, con «Combinar» (o con `PATCH /api/v1/displays/{deviceId}/data`):
   - `{"temp": 45}` pone el texto rojo;
   - `{"alarma": true}` muestra el triángulo;
   - `{"angulo": 200}` alarga el arco.
4. **Botón:** el BOOT corto muestra «Datos cambiados» y la web pasa a `estado: PULSADO` y `alarma: true`; el largo devuelve `OK`. En «Eventos», la columna «Origen» dice «botón 0 corto» o «botón 0 largo».
5. **Imagen grande:** «Importar imagen» con una foto de 320×172 en una plantilla horizontal (unos 150 KB) llega en `frag` y se ve completa. Mira en el log del servidor que haya un `frag.ack ok:true`.
6. **Corte a medias:** apagar el WiFi durante la descarga. Al volver, la plantilla anterior sigue y la nueva se descarga entera.
7. **Rotación:** la misma plantilla sencilla con `rotation` 0, 90, 180 y 270. Sin franjas de basura, el origen arriba a la izquierda y el toast y el punto de conexión dentro de la pantalla.
8. **Memoria:** `ESP.getFreeHeap()` estable después de 20 cambios de plantilla y de 10 minutos de animación.
9. **Ficha de la placa:** en la web, «Ajustes» de la pantalla muestra placa, chip, firmware, pantalla de 172×320 y el botón 0 «BOOT» (GPIO 9). «Pedir ficha» la vuelve a pedir y la hora de «recibida» cambia.
10. **Desconexión:** desenchufar la placa. En 20 s como mucho la web dice «Sin conexión» con la hora del último contacto.
11. **Demasiado grande:** con una plantilla que no quepa en la flash, `frag.ack ok:false reason:"too_large"`, y la pantalla sigue con la anterior.

## 13. Lo que no cambia

- Conexión WSS, `Bearer`, CA propia, portal WiFi, consola serie, persistencia de `values.json` y cola de eventos.
- `trust.*` y `ota.install`.
- La fuente: sigue siendo la de 6×8 de Arduino_GFX, escalada por `size`; los toasts del servidor van sin tildes por eso.
- La orden de consola que imprime la plantilla imprimirá la versión sin píxeles (`/template.json`). Actualiza `firmware/docs/comandos-consola.md` si cambia algo.
