# Plantillas MetaDisplay: guía práctica (contrato 1.2)

Una **plantilla** es un JSON que dice qué dibuja la pantalla y qué pasa al tocarla o al pulsar un botón. Los **datos** (`values`) son las variables que la rellenan. Llegan por la inyección de siempre: se envían con `PUT`/`PATCH /data` y la pantalla los recibe como `data.update`.

Las «funciones» de la plantilla (`bind`, `binds`, `format` y las reglas `when`) trabajan con esas variables:
- La plantilla no declara sus variables: las **nombra**. Por ejemplo, `"bind": "temp"` o `"format": "Temp: {temp} C"` leen la variable `temp` de los datos.
- Los valores llegan **solo por los datos**. La plantilla no trae valores propios ni valores por defecto.
- La pantalla redibuja cada vez que cambia un valor.

La plantilla se guarda una vez y se cachea en la pantalla por `id` + `version`. Los valores van y vienen todas las veces que quieras sin reenviarla.

| Qué | Dónde está |
|---|---|
| Esquemas: la fuente de verdad, de donde sale el contrato | [`packages/shared/src/index.ts`](../../packages/shared/src/index.ts) |
| Semántica de `bind`, `binds`, `when`, `format` y animación | [`packages/shared/src/render.ts`](../../packages/shared/src/render.ts) |
| Codificación de imágenes | [`packages/shared/src/image.ts`](../../packages/shared/src/image.ts) |
| Ejemplo con todo lo de esta guía | [`examples/showcase-template.json`](examples/showcase-template.json); en la web, «Cargar ejemplo avanzado» |
| Contrato publicado (versión y fecha) | `/contrato`, `GET /api/v1/contract/asyncapi.json` ([`README.md`](README.md)) |

## 1. Estructura

```json
{
  "id": "panel.v1",
  "version": 3,
  "rotation": 90,
  "background": "#090D18",
  "elements":  [ { "type": "text", "x": 10, "y": 10, "size": 2, "format": "Temp: {temp} C" } ],
  "animation": { "frames": [ { "ms": 500, "elements": [] } ], "repeat": 0 },
  "actions":   [ { "id": "pulsar", "trigger": "button", "button": 0, "mode": "remote", "event": "data.set", "payload": { "estado": "ON" } } ]
}
```

| Campo | Obligatorio | Qué es |
|---|---|---|
| `id` | sí | Hasta 64 caracteres. Una pantalla guarda varias plantillas, una por `id`, y una de ellas es la activa. |
| `version` | sí | Entero. Si guardas otra vez el mismo `id`, la versión tiene que **subir**; si no, la API responde 409 `version_not_incremented`. |
| `rotation` | no | `0` (por defecto), `90`, `180` o `270`. Ver §2. |
| `background` | no | Color de fondo `#RRGGBB`. |
| `elements` | sí | Lo que se dibuja, en orden: el último queda encima. Ver §3. |
| `animation` | no | Fotogramas que se dibujan encima de `elements`. Ver §5. |
| `actions` | sí (puede ser `[]`) | Toques y botones físicos. Ver §6. |

No hay límite de elementos ni de acciones: el único límite es el **tamaño en bytes**, 1 MB por defecto y configurable (§9).

## 2. Lienzo y rotación

| `rotation` | Orientación | Lienzo (ancho × alto) |
|---|---|---|
| `0` | vertical | 172 × 320 |
| `90` | horizontal | 320 × 172 |
| `180` | vertical, girada | 172 × 320 |
| `270` | horizontal, girada | 320 × 172 |

- El origen (0,0) es la esquina **superior izquierda de la pantalla tal y como se ve con esa rotación**. Todas las coordenadas de la plantilla, y también las `x,y` que envía `touch.tap`, van en ese sistema.
- Para cambiar de orientación, guarda (o activa) otra plantilla con otra `rotation`. Una misma pantalla puede tener una plantilla vertical y otra horizontal, y pasar de una a otra con un toque (`screen.<id>`, §6).
- **Nada puede salirse del lienzo.** Cada elemento ocupa una caja, y la API rechaza la plantilla (422) si esa caja se sale:
  - `text`: su punto `x,y`.
  - `line`: sus dos extremos.
  - Elementos con `w`/`h`: `x+w ≤ ancho` e `y+h ≤ alto`.
  - `circle` y `arc`: el círculo completo, `x±r` e `y±r`.
  - `ellipse`: `x±rx` e `y±ry`.
  - `polygon` y `curve`: todos sus puntos. En una curva basta, porque nunca se sale de sus puntos de control.
- La comprobación incluye cada variante que puede producir una regla `when` (§7). Los valores ligados con `binds` no se pueden comprobar al guardar: si un valor saca algo del lienzo, la pantalla lo recorta.

## 3. Elementos

Propiedades comunes de las formas:

| Propiedad | Qué hace |
|---|---|
| `color` | Color del trazo o del texto, `#RRGGBB`. |
| `fillColor` | Color del relleno. Si no se da, se usa `color`. |
| `filled` | `true` = forma rellena. |
| `stroke` | **Grosor** del trazo en píxeles (1 a 32, por defecto 1). |
| `visible` | `false` = no se dibuja. Útil junto con `binds` o `when` (§7). |

| `type` | Campos obligatorios | Opcionales | Dibuja |
|---|---|---|---|
| `text` | `x,y` y uno de `value`/`bind`/`format` | `size` 1–4, `color` | Texto en una línea, sin ajuste. La fuente del LCD es ASCII: evita las tildes. |
| `rect` | `x,y,w,h` | `filled`, `radius` 0–10, `fillColor`, `color`, `stroke` | Rectángulo, con las esquinas redondeadas si se da `radius`. |
| `line` | `x,y,x2,y2` | `color`, `stroke` | Línea recta. |
| `progress` | `x,y,w,h` y uno de `value`/`bind` | `color` (fondo), `fillColor` (barra) | Barra de 0 a 100. |
| `button` | `x,y,w,h` y uno de `value`/`bind`/`format` | `size`, `fillColor`, `color` | Botón dibujado. Qué hace al tocarlo se define en `actions`. |
| `circle` | `x,y` (centro), `r` | `filled`, `fillColor`, `color`, `stroke` | Círculo. |
| `ellipse` | `x,y` (centro), `rx,ry` | igual que `circle` | Elipse. |
| `polygon` | `points`: de 2 a 64 puntos `[x,y]` | `closed` (por defecto `true`), `filled`, `fillColor`, `color`, `stroke` | Polígono, o polilínea abierta con `closed: false`. Con tres puntos es un triángulo. |
| `arc` | `x,y` (centro), `r`, `start`, `end` | `color`, `stroke` | Arco de circunferencia. |
| `curve` | `points`: 3 o 4 puntos `[x,y]` | `color`, `stroke` | Curva de Bézier. |
| `image` | `x,y,w,h`, `encoding`, `data` | — | Imagen píxel a píxel (§4). |

**Ángulos de `arc`:** en grados, entre −360 y 360. El 0 está a las **3 en punto** y los ángulos crecen en **sentido horario**: 90 = abajo, 180 = izquierda y 270 (o −90) = arriba. El arco va de `start` a `end`. Por ejemplo, `start: -90, end: 90` es el semicírculo derecho, dibujado desde arriba hasta abajo.

**Curvas:**
- Con 3 puntos `[inicio, control, fin]` es una Bézier cuadrática.
- Con 4 puntos `[inicio, control1, control2, fin]` es una cúbica.

La curva pasa por el primer y el último punto, y los de control la «atraen».

```json
{ "type": "circle",  "x": 260, "y": 66, "r": 44, "color": "#26395A", "stroke": 3 }
{ "type": "arc",     "x": 260, "y": 66, "r": 36, "start": -90, "end": 90, "color": "#9568FF", "stroke": 6 }
{ "type": "polygon", "points": [[12,162],[32,126],[52,162]], "filled": true, "fillColor": "#FF5050" }
{ "type": "curve",   "points": [[80,160],[110,120],[150,168],[190,130]], "color": "#66F3BF", "stroke": 2 }
{ "type": "line",    "x": 10, "y": 102, "x2": 190, "y2": 102, "color": "#586180", "stroke": 2 }
```

## 4. Imágenes (control píxel a píxel)

Una imagen es un rectángulo de `w × h` píxeles en **RGB565**, la profundidad de color del LCD: 5 bits de rojo, 6 de verde y 5 de azul. Cada píxel es un entero de 16 bits:

```text
color = ((R & 0xF8) << 8) | ((G & 0xFC) << 3) | (B >> 3)        // R, G, B de 0 a 255
```

Los píxeles van **por filas, de arriba abajo y de izquierda a derecha**. `data` siempre va en **base64** estándar, con el relleno `=`. Hay dos codificaciones:

| `encoding` | Bytes | Cuándo usarla |
|---|---|---|
| `rgb565` | 2 por píxel, el byte alto primero (big-endian). Una pantalla completa son 110 080 bytes. | Fotos y degradados. |
| `rgb565-rle` | Tramos de 3 bytes `[n-1][color alto][color bajo]`, cada uno con **n = 1 a 256 píxeles iguales seguidos**. Un tramo puede continuar en la fila siguiente. | Iconos, logotipos y dibujos con zonas del mismo color: ocupan muchísimo menos. |

La API decodifica la imagen al guardarla y exige que salgan **exactamente** `w·h` píxeles. Si no, responde 422.

**Descomprimir**, que es lo que hace el firmware, es un solo bucle:

```c
for (i = 0, p = 0; i < len; i += 3) {
  n = data[i] + 1;  color = (data[i+1] << 8) | data[i+2];
  for (; n > 0; n--, p++) pixel(x + p % w, y + p / w, color);   // o a un buffer de línea
}
```

**Cómo generar una imagen:**

- **Desde la web.** En el editor de plantillas, «Importar imagen»: eliges un archivo y el tamaño, y se añade el elemento `image` al borrador. La web elige sola la codificación más corta.
- **Desde TypeScript**, con el mismo código que usa la API: `encodeImage(rgba, w, h)` de `@atekos/shared` devuelve `{ encoding, data }`. `rgba` son los bytes RGBA de cualquier fuente, por ejemplo `ImageData.data` o `sharp().raw()`.
- **Desde Python**, con Pillow:

  ```python
  from PIL import Image
  import base64, json

  img = Image.open("logo.png").convert("RGB").resize((64, 64))
  px = [((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3) for r, g, b in img.getdata()]
  out, i = bytearray(), 0
  while i < len(px):
      n = 1
      while n < 256 and i + n < len(px) and px[i + n] == px[i]:
          n += 1
      out += bytes([n - 1, px[i] >> 8, px[i] & 0xFF])
      i += n
  print(json.dumps({"type": "image", "x": 0, "y": 0, "w": 64, "h": 64,
                    "encoding": "rgb565-rle", "data": base64.b64encode(out).decode()}))
  ```

Una plantilla con imágenes grandes puede ocupar cientos de KB. Viaja por el WSS troceada (§9) y la pantalla la guarda en su flash. Por eso, mientras no cambie su `version`, no se vuelve a descargar.

## 5. Animación

```json
"animation": {
  "repeat": 0,
  "frames": [
    { "ms": 500, "elements": [ { "type": "circle", "x": 190, "y": 14, "r": 4, "filled": true, "fillColor": "#66F3BF" } ] },
    { "ms": 500, "elements": [] }
  ]
}
```

- La pantalla dibuja los `elements` de la plantilla y, **encima**, los del fotograma actual. Cada fotograma dura `ms` milisegundos, de 20 a 60 000.
- `repeat`: cuántas vueltas da la secuencia. `0`, o no ponerlo, la repite **siempre**. Al acabar las vueltas, se queda en el último fotograma.
- Los elementos de un fotograma son elementos normales: pueden ser imágenes (una animación «fotograma a fotograma»), usar `binds` y `when`, y tienen que caber en el lienzo.
- El fotograma que toca a cada instante lo calcula `currentFrame(animation, ms)` en `render.ts`. En la web, «Reproducir animación» la muestra en la vista previa.

## 6. Acciones: toques y botones físicos

| Campo | Qué es |
|---|---|
| `id` | Hasta 48 caracteres, único en la plantilla. |
| `trigger` | `tap`: una zona táctil (`x,y,w,h` obligatorios). `button`: un **botón físico**. |
| `button` | Solo con `button`: el índice lógico del botón, de **0 a 15**. El 0 es el BOOT de la placa; el resto, los botones que se conecten, en el orden que fije el firmware, que es quien sabe en qué GPIO está cada uno. El `device.hello` dice cuántos tiene en `display.buttons`. |
| `press` | Solo con `button`: `short` (por defecto) o `long`. Un mismo botón puede tener una acción corta y otra larga, pero no dos iguales. |
| `x,y,w,h` | En `button` son opcionales y van los cuatro juntos: la zona que la pantalla **resalta** para ese botón (qué botón se ve en la pantalla): al pulsarlo, la pantalla dibuja un contorno alrededor durante un momento. |
| `mode` | `local`: solo actúa la pantalla, sin enviar nada. `remote`: envía el evento y espera la respuesta. `hybrid`: hace las dos cosas. |
| `local` | Lo que hace la pantalla en `local`/`hybrid`: `{ "kind": "feedback", "message": "..." }` (≤ 24 caracteres) o `{ "kind": "set_value", "key": "...", "value": ... }`. |
| `event` | Qué hace el servidor (tabla siguiente). |
| `payload` | La **información concreta** de la acción: un objeto de valores (≤ 64 claves). Hoy la usa `data.set`. |

Qué hace el servidor con cada `event` (en `remote`/`hybrid`):

| `event` | Efecto | Toast |
|---|---|---|
| `screen.<id>` | Activa la plantilla `<id>` y la envía a **todas** las conexiones de la pantalla. | `Pantalla cambiada` (o `Pantalla no existe`) |
| `data.refresh` | Reenvía todos los valores a esa conexión. | `Datos actualizados` |
| `data.set` | Fusiona `payload` en los valores (como `PATCH /data`) y lo envía a todas las conexiones. | `Datos cambiados` (o `Datos invalidos`) |
| cualquier otro | Solo queda registrado en el historial. | `Accion recibida` |

**Qué recibe el servidor.** Al pulsar, la pantalla envía `touch.tap`, el mismo mensaje que un toque, con `source: "button"`, `button` y `press`. Con un botón, `x,y` son el centro de su zona, o 0,0 si no tiene. Los eventos se ven en la web («Eventos», columna «Origen») y en `GET /api/v1/displays/{deviceId}/events`.

Ejemplo: el botón 0 corto marca la alarma y uno largo la quita.

```json
{ "id": "pulsar", "trigger": "button", "button": 0, "press": "short", "x": 204, "y": 138, "w": 112, "h": 28,
  "mode": "hybrid", "event": "data.set", "payload": { "estado": "PULSADO", "alarma": true },
  "local": { "kind": "feedback", "message": "Enviando..." } },
{ "id": "restablecer", "trigger": "button", "button": 0, "press": "long",
  "mode": "remote", "event": "data.set", "payload": { "estado": "OK", "alarma": false } }
```

## 7. Variables: las funciones de la plantilla

### 7.1 De dónde salen las variables

- Una variable es una clave de los **datos** de la pantalla (`values`). Se envían con `PUT`/`PATCH /data` (§8) y la pantalla las recibe en un `data.update`, como siempre. No hay otra vía: la plantilla solo nombra las variables y no les da valor.
- No hay que declararlas. Cualquier clave de los datos se puede usar en cualquier elemento.
- **Una variable que aún no se ha enviado** deja el texto vacío con `bind` y `format`, conserva la propiedad original con `binds` y, en `when`, cuenta como ausente (tabla de `op` más abajo).
- **Valor de reserva:** si quieres que se vea algo mientras no llega la variable, pon ese algo en la propiedad base y usa `binds` en lugar de `bind`. Por ejemplo, `{ "type": "text", "x": 10, "y": 10, "value": "--", "binds": { "value": "temp" } }` dibuja `--` hasta que llega `temp`.
- La API no comprueba de qué tipo es cada variable. Al dibujar, cada valor se convierte al tipo de la propiedad y, si no se puede, se ignora (§7.3). Los límites de los datos están en §8.
- Los datos son de la pantalla, no de la plantilla: todas sus plantillas los comparten.
- En la web, la sección «Datos» lista las variables que usa la plantilla activa y marca las que aún no tienen valor. La lista sale de `templateVariables(plantilla)`, en `render.ts`.

### 7.2 Usar las variables en los elementos

| Mecanismo | Ejemplo | Efecto |
|---|---|---|
| `bind` | `{ "type": "progress", …, "bind": "nivel" }` | El contenido (`value`) es la variable. |
| `format` | `{ "type": "text", …, "format": "Temp: {temp} C" }` | Texto con huecos `{variable}`. Una variable ausente o `null` deja el hueco vacío. |
| `binds` | `{ "type": "arc", …, "binds": { "end": "angulo", "color": "colorArco" } }` | **Cualquier propiedad** ← una variable: posición, tamaño, color, grosor, ángulo, `visible`… No se pueden ligar `type`, `bind`, `points`, `encoding` ni `data`, ni el `w`/`h` de una imagen. |
| `when` | ver abajo | Reglas condicionales del tipo «si… entonces estas propiedades». |
| `visible` | `"visible": false, "binds": { "visible": "alarma" }` | Mostrar u ocultar el elemento. |

**Reglas `when`**: una lista. Cada regla compara la variable `key` y, si se cumple, aplica `set`, que puede tener cualquier propiedad ligable de ese elemento:

```json
{ "type": "text", "x": 10, "y": 38, "size": 2, "color": "#B6A3FF", "format": "Temp: {temp} C",
  "when": [
    { "key": "temp",   "op": "gt",     "value": 30, "set": { "color": "#FF5050" } },
    { "key": "temp",   "op": "gte",    "value": 45, "set": { "color": "#FF0000", "format": "PELIGRO {temp} C" } },
    { "key": "oculto", "op": "truthy",              "set": { "visible": false } }
  ] }
```

| `op` | Se cumple si… |
|---|---|
| `eq` / `ne` | la variable es / no es exactamente `value`, sin conversión: `5` ≠ `"5"`. |
| `gt` / `gte` / `lt` / `lte` | la variable, como número, es `>` / `≥` / `<` / `≤` que `value`. Si alguno de los dos no es un número, la regla no se cumple. |
| `truthy` / `falsy` | la variable es / no es «verdadera»: `true`, un número ≠ 0, o un texto que no sea `""`, `"0"` ni `"false"`. Una variable ausente o `null` es falsa. |

### 7.3 Orden de evaluación (`resolveElement`)

Para cada elemento, en cada redibujado:

1. Se parte de sus propiedades.
2. `bind` pone el valor de la variable en `value`.
3. Cada entrada de `binds` copia su variable a la propiedad, **convertida a su tipo**:
   - En colores, solo un `#RRGGBB` válido.
   - En `filled`, `closed` y `visible`, se toma como verdadero o falso según la regla de `truthy`.
   - En las propiedades numéricas, el número redondeado; un texto numérico como `"12"` también vale.

   Si el valor no se puede convertir, **se conserva la propiedad original**.
4. Las reglas `when`, **en orden**: cada una que se cumple fusiona su `set`. Si dos reglas tocan lo mismo, gana la última.
5. Si `visible` acaba en `false`, el elemento no se dibuja.
6. Si hay `format`, se rellenan sus huecos y ese es el texto.

La función de referencia es `resolveElement(elemento, valores)`, en `render.ts`. La API valida cada `set` como si fuera el elemento entero (tipos, colores y que no se salga del lienzo).

## 8. Leer y enviar los datos

Las rutas son de la REST de administración. Sirven la sesión de la web o un token `dmt_` con el scope `displays:write`, que se crea en la web, en Tokens. Nunca sirve el token `display:connect` de la pantalla.

**Leer la plantilla activa y los valores actuales:**

```bash
curl -s https://atekos.toxolinko.site/api/v1/displays/md-34B7DA01ABCD \
  -H "Authorization: Bearer $TOKEN" | jq '{template: .template.id, values}'
```

**Enviar valores:**

- `PATCH` cambia solo las claves que envías, y la pantalla recibe un `data.update` `patch`.
- `PUT` sustituye todos los valores, y la pantalla recibe un `snapshot`.

```bash
curl -X PATCH https://atekos.toxolinko.site/api/v1/displays/md-34B7DA01ABCD/data \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"temp": 32.5, "alarma": true}'
# → 200 {"values": {...todos los valores...}}
# → 422 {"error":"invalid_data","issues":[…]}  si un valor no cumple los límites de abajo
```

Desde JavaScript (navegador, Node o un script):

```js
await fetch(`${API}/api/v1/displays/${deviceId}/data`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ temp: 32.5 }),
})
```

**Otras formas de enviarlos:**

- **Desde la web:** en el detalle de la pantalla, el editor JSON de «Datos», que muestra encima qué variables usa la plantilla activa.
- **Desde una IA:** con las herramientas MCP `get_display` (lee la plantilla activa y los valores) y `update_display_data` (envía con merge), ver [`../MCP.md`](../MCP.md).
- **Desde la propia pantalla:**
  - `local: set_value` cambia un valor solo en esa pantalla.
  - `event: "data.set"` con `payload` cambia los valores en el servidor y en todas las conexiones.
  - La respuesta `ui.result` puede traer un `patch`.

**Límites de los valores:** hasta 64 claves de ≤ 40 caracteres. Cada valor es un texto de ≤ 140 caracteres, un número, un booleano o `null`.

## 9. Tamaño y fragmentación

- **Tope:** una plantilla, y cualquier mensaje a la pantalla, puede ocupar hasta **1 MB** (1 048 576 bytes en JSON). Si se pasa, la API responde **413 `message_too_large`**, tanto si es el cuerpo de la petición como el mensaje resultante.
- **Cambiar el tope:** variable de entorno **`DISPLAY_MAX_TEMPLATE_BYTES`** de la API, en bytes. En local va en `.env`; en producción, en las variables de entorno de Coolify. Después hay que reiniciar la API. El contrato publicado muestra el tope vigente en `info["x-max-message-bytes"]`.

  Antes de subirlo, ten en cuenta la flash de la pantalla. Su LittleFS tiene 1,875 MB, y el firmware guarda la plantilla más una copia temporal mientras la escribe. Una plantilla de más de ~900 KB puede no caber, y entonces la pantalla la rechaza con `template.ack ok:false`.
- **El MCP** acepta cuerpos de hasta 32 KB. Las plantillas con imágenes grandes se envían por la REST.
- **Fragmentación por el WSS:** el firmware solo acepta tramas de 8192 bytes. Un mensaje más grande lo envía el servidor como una serie de `frag`:

  ```json
  { "type": "frag", "id": "6f1c…", "seq": 0, "count": 23, "bytes": 135000, "data": "<base64 de hasta 6000 bytes del JSON original>" }
  ```

  - Los trozos de un mensaje llegan **seguidos** y en orden (`seq` de 0 a `count-1`).
  - La pantalla decodifica cada `data` y añade los bytes a un búfer o a un archivo. Al llegar el último, tiene exactamente `bytes` bytes: el JSON del mensaje original (por ejemplo, un `template.set`), que procesa como si hubiera llegado entero, con su ack habitual.
  - Después responde `frag.ack { id, ok: true }`, o `ok: false` con un `reason` (`too_large`, `incomplete`…) si lo descarta.
  - Si se corta la conexión a medias, descarta lo recibido. Al reconectar, el `hello` vuelve a pedir lo que falte.

## 10. Para quien programa el firmware

Un firmware 1.0 sigue funcionando con plantillas 1.0. Una plantilla con algo nuevo la rechaza con `template.ack ok:false` (y la pantalla conserva la anterior), y los `frag` los ignora. Para soportar el contrato actual (1.2):

1. **`device.hello`:**
   - `display.buttons` con el número de botones físicos.
   - En `capabilities`, lo que se implemente: `rotation`, `stroke`, `circle`, `ellipse`, `polygon`, `arc`, `curve`, `image`, `animation`, `binds`, `rules`, `buttons` y `frag`.
2. **`rotation`:**
   - `setRotation(rotation / 90)`.
   - Lienzo de 172×320 o 320×172.
   - Las coordenadas táctiles se transforman al mismo sistema.
3. **Primitivas** (Arduino_GFX):
   - `drawLine`/`fillCircle`/`drawEllipse`/`fillEllipse`/`fillTriangle` y relleno de polígonos por barrido.
   - `drawArc`/`fillArc` para los arcos con grosor.
   - Las Bézier, muestreando unos 16–32 segmentos.
   - Las líneas gruesas, como rectángulos girados o círculos a lo largo del trazo.
4. **`image`:** decodificar mientras se dibuja, en streaming desde LittleFS, sin cargar toda la imagen en RAM (§4).
5. **Capa dinámica:** al redibujar, aplicar `bind`, `binds`, `when` y `format` con los valores recibidos, exactamente como `render.ts` (§7.3). No se ejecuta código: todo son comparaciones y sustituciones declarativas.
6. **`animation`:** un temporizador que redibuja con `currentFrame`.
7. **Botones:**
   - Si la plantilla tiene acciones `trigger: "button"`, esas mandan: corta o larga según `press`, y se resalta su zona.
   - Si no las tiene, se mantiene el comportamiento 1.2.0: la corta ejecuta la acción seleccionada y la larga pasa a la siguiente.
   - El `touch.tap` lleva `source`, `button` y `press`.
8. **`frag`:** reensamblar en LittleFS y responder `frag.ack` (§9).

La lista completa de mensajes con sus campos está en el contrato publicado (`/contrato`). Las instrucciones paso a paso para el firmware de la placa, con código, están en [`FIRMWARE.md`](FIRMWARE.md).
