import { DISPLAY_BUTTONS, DISPLAY_HEIGHT as H, DISPLAY_WIDTH as W } from '@atekos/shared'
import { IMAGE_TTL_SEC, MAX_SOURCE_BYTES, MAX_SOURCE_SIDE } from './images'

// Guía para la IA que usa el MCP (get_display_guide y atekos://guide/pantallas.md). Resume, para un modelo,
// packages/shared (index.ts, render.ts, image.ts), ws/device-server.ts y docs/metadisplay/PLANTILLAS.md:
// si cambian, cámbiala. Los bloques JSON los valida apps/api/test/mcp-guide.test.ts.

export const GUIDE_URI = 'atekos://guide/pantallas.md'

const F = '```'
export const MB = (n: number) => `${(n / 1024 / 1024).toLocaleString('es', { maximumFractionDigits: 2 })} MB`

export const displayGuide = (maxBytes: number) => `# Pantallas MetaDisplay: guía para la IA

Esta guía explica cómo hacer **exactamente** lo que pida el usuario en sus pantallas con las herramientas de este MCP. Todo lo que dice sale del código del servidor: si algo no está aquí, no existe (no inventes campos).

## 0. Lo esencial

- Una **pantalla** (deviceId \`md-\` + 12 hex) guarda varias **plantillas**, tiene **una activa** (la que se ve) y **un** conjunto de **datos** (\`values\`) que comparten todas sus plantillas.
- La **plantilla** es un JSON con lo que se dibuja (\`elements\`, \`animation\`) y lo que hacen los toques y los botones (\`actions\`).
- Las **variables** no se declaran: la plantilla las **nombra** en \`bind\`, \`binds\`, \`format\` (\`"{temp}"\`) y \`when\`. Sus valores son los **datos**, que solo llegan con \`update_display_data\`. **Datos = variables = lo que el usuario llama «parámetros».**
- Cambiar un número, un texto o un color que depende de una variable → \`update_display_data\`. Cambiar el diseño → \`set_display_template\` con \`version\` + 1.
- Lienzo: ${W}×${H} en vertical (\`rotation\` 0/180) o ${H}×${W} en horizontal (90/270). Nada puede salirse.
- Imágenes: \`upload_display_image\` → elemento con \`"data": "ref:…"\` → cópialo en \`elements\` cambiando solo \`x\`/\`y\`. **Nunca escribas base64 de píxeles a mano.**
- Textos en **ASCII** (sin tildes, ñ ni símbolos raros): la fuente del LCD es la de 6×8 px.
- Lo guardado sin conexión no se pierde: la pantalla recibe la plantilla y los datos al reconectar.

## 1. Herramientas de pantallas

| Herramienta | Para qué |
|---|---|
| \`list_displays\` | Ver las pantallas: \`deviceId\`, \`name\`, \`activeTemplateId\`, \`online\`, \`lastSeenAt\`. |
| \`get_display\` | Todo de una pantalla: plantilla activa (\`template\`), plantillas guardadas (\`templates: [{id, version}]\`), datos (\`values\`), \`variables\` (las que nombra la plantilla activa), \`online\`, \`lastSeenAt\` e \`info\` (ficha de la placa). **Léela antes de cambiar nada.** |
| \`get_display_template\` | Una plantilla completa (la activa, o la de \`templateId\`), para modificarla. |
| \`set_display_template\` | Guardar una plantilla. \`activate: true\` (por defecto) la activa; \`false\` la guarda sin activar. |
| \`update_display\` | Activar otra plantilla guardada (\`activeTemplateId\`) y/o renombrar la pantalla (\`name\`). |
| \`delete_display_template\` | Borrar una plantilla guardada que no sea la activa. |
| \`update_display_data\` | Enviar datos. Merge por defecto; \`replace: true\` sustituye todos (así se quitan variables). |
| \`upload_display_image\` | PNG/JPEG (url https o base64) → imagen de la pantalla redimensionada, por referencia. |
| \`send_display_command\` | \`display.refresh\`, \`display.brightness\` o \`display.info\` a la placa conectada. |
| \`list_display_events\` | Historial de toques y botones (para comprobar que una acción funciona). |
| \`create_display\` | Dar de alta una pantalla nueva con su deviceId. Empieza con la plantilla \`inicio\` v1, que enseña el nombre y la variable \`mensaje\`. |
| \`get_display_guide\` | Esta guía. |

No se puede borrar una pantalla ni crear tokens: la placa se conecta con un token \`display:connect\` que el usuario crea en la web (Tokens).

## 2. Lienzo y rotación

| \`rotation\` | Orientación | Ancho × alto | Esquina inferior derecha | Centro |
|---|---|---|---|---|
| \`0\` (o ausente) | vertical | ${W} × ${H} | (${W - 1}, ${H - 1}) | (${W / 2}, ${H / 2}) |
| \`90\` | horizontal | ${H} × ${W} | (${H - 1}, ${W - 1}) | (${H / 2}, ${W / 2}) |
| \`180\` | vertical girada | ${W} × ${H} | (${W - 1}, ${H - 1}) | (${W / 2}, ${H / 2}) |
| \`270\` | horizontal girada | ${H} × ${W} | (${H - 1}, ${W - 1}) | (${H / 2}, ${W / 2}) |

- El origen (0, 0) es la esquina **superior izquierda tal y como se ve** con esa rotación; \`x\` crece a la derecha e \`y\` hacia abajo.
- Todas las coordenadas y medidas son **enteros**: \`x\`, \`y\`, \`x2\`, \`y2\` de 0 a ${H - 1}; \`w\`, \`h\`, \`r\`, \`rx\`, \`ry\` de 1 a ${H}.
- La API **rechaza** la plantilla si la caja de un elemento se sale del lienzo de su rotación:
  - \`text\`: solo se comprueba su punto \`x,y\` (el texto en sí puede cortarse: calcula su ancho, §3).
  - con \`w\`/\`h\`: \`x + w ≤ ancho\` e \`y + h ≤ alto\`.
  - \`circle\`/\`arc\`: \`x - r ≥ 0\`, \`x + r ≤ ancho - 1\`, y lo mismo en \`y\`. \`ellipse\`: igual con \`rx\`/\`ry\`.
  - \`line\`, \`polygon\`, \`curve\`: todos sus puntos dentro.
  - También cada variante que pueda producir una regla \`when\`, los fotogramas de la animación y las zonas de las acciones.
- Para cambiar de orientación se guarda (o se activa) otra plantilla con otra \`rotation\`. Una pantalla puede tener una vertical y otra horizontal y pasar de una a otra.
- Las coordenadas de los toques (\`x,y\` de los eventos) van en el mismo sistema que la plantilla.

## 3. La plantilla

${F}json
{
  "id": "panel.v1",
  "version": 3,
  "rotation": 90,
  "background": "#090D18",
  "elements": [{ "type": "text", "x": 10, "y": 10, "size": 2, "format": "Temp: {temp} C" }],
  "animation": { "frames": [{ "ms": 500, "elements": [] }], "repeat": 0 },
  "actions": [{ "id": "pulsar", "trigger": "button", "button": 0, "mode": "remote", "event": "data.set", "payload": { "estado": "ON" } }]
}
${F}

| Campo | Obligatorio | Qué es |
|---|---|---|
| \`id\` | sí | 1–64 caracteres. Una plantilla por \`id\` en cada pantalla. |
| \`version\` | sí | Entero 0–2147483647. Al guardar un \`id\` que ya existe tiene que ser **mayor** que la guardada (míralo en \`get_display.templates\`); si no, 409 \`version_not_incremented\`. La pantalla cachea por \`id\` + \`version\`. |
| \`rotation\` | no | 0, 90, 180 o 270 (§2). |
| \`background\` | no | Color de fondo \`#RRGGBB\`. |
| \`elements\` | sí | Lo que se dibuja, **en orden: el último queda encima**. Sin tope de número. |
| \`animation\` | no | Fotogramas que se dibujan encima de \`elements\` (§6). |
| \`actions\` | sí (puede ser \`[]\`) | Toques y botones físicos (§7). |

Los colores siempre son \`#RRGGBB\` (6 hex). Un campo que no está en esta guía se descarta o da error.

## 4. Elementos

Orden de dibujo: \`background\` → \`elements\` en orden → fotograma actual de la animación → resaltado de botones → toast. Todos admiten \`visible\` (\`false\` = no se dibuja) y la capa dinámica \`binds\`/\`when\` (§5).

| \`type\` | Obligatorios | Opcionales | Notas |
|---|---|---|---|
| \`text\` | \`x\`, \`y\` y uno de \`value\`/\`bind\`/\`format\` (o \`binds.value\`) | \`size\` 1–4 (1), \`color\` (#FFFFFF) | Una línea, sin ajuste, desde su esquina superior izquierda. Cada carácter mide **6·size × 8·size px**: en ${W} px de ancho caben 28 caracteres con size 1, 14 con 2, 9 con 3 y 7 con 4 (en ${H}: 53, 26, 17 y 13). |
| \`rect\` | \`x\`, \`y\`, \`w\`, \`h\` | \`filled\`, \`fillColor\`, \`color\` (#FFFFFF), \`stroke\`, \`radius\` 0–10 | Relleno con \`filled: true\` (color \`fillColor\`, o \`color\` si falta). Sin relleno, el trazo va hacia dentro. |
| \`line\` | \`x\`, \`y\`, \`x2\`, \`y2\` | \`color\`, \`stroke\` | |
| \`progress\` | \`x\`, \`y\`, \`w\`, \`h\` y uno de \`value\`/\`bind\` (o \`binds.value\`) | \`color\` (fondo, #333333), \`fillColor\` (barra, #FFFFFF) | Barra de 0 a 100 (el valor se recorta a ese rango). No admite \`format\`. |
| \`button\` | \`x\`, \`y\`, \`w\`, \`h\` y uno de \`value\`/\`bind\`/\`format\` | \`size\` 1–4, \`fillColor\` (fondo, #333333), \`color\` (texto, #FFFFFF) | Solo se **dibuja** (texto centrado). Para que haga algo hace falta una acción \`tap\` con la misma zona (§7). |
| \`circle\` | \`x\`, \`y\` (centro), \`r\` | \`filled\`, \`fillColor\`, \`color\`, \`stroke\` | |
| \`ellipse\` | \`x\`, \`y\` (centro), \`rx\`, \`ry\` | \`filled\`, \`fillColor\`, \`color\`, \`stroke\` | |
| \`polygon\` | \`points\`: 2–64 puntos \`[x, y]\` | \`closed\` (true), \`filled\`, \`fillColor\`, \`color\`, \`stroke\` | \`closed: false\` = polilínea abierta. Tres puntos = triángulo. |
| \`arc\` | \`x\`, \`y\` (centro), \`r\`, \`start\`, \`end\` | \`color\`, \`stroke\` | Ángulos enteros de −360 a 360. **0 = las 3 en punto y crece en sentido horario**: 90 abajo, 180 izquierda, 270 (o −90) arriba. Va de \`start\` a \`end\` en sentido horario; \`|end − start| ≥ 360\` es el círculo entero y barrido 0 no dibuja nada. Nunca se rellena. |
| \`curve\` | \`points\`: 3 (Bézier cuadrática) o 4 (cúbica) puntos | \`color\`, \`stroke\` | Pasa por el primero y el último; los del medio la «atraen». |
| \`image\` | \`x\`, \`y\`, \`w\`, \`h\`, \`encoding\`, \`data\` | — | Píxeles RGB565 (§8). Por este MCP, \`data\` es una referencia \`ref:…\`. |

\`stroke\` = grosor del trazo, 1–32 px (1 por defecto). \`size\` = escala de la fuente, 1–4. Las formas nuevas usan \`color\` #FFFFFF si no se da.

Un ejemplo de cada uno (vertical):

${F}json
[
  { "type": "text", "x": 10, "y": 10, "size": 2, "color": "#FFFFFF", "value": "HOLA" },
  { "type": "text", "x": 10, "y": 40, "format": "Temp: {temp} C" },
  { "type": "rect", "x": 10, "y": 70, "w": 152, "h": 40, "radius": 6, "filled": true, "fillColor": "#203040" },
  { "type": "rect", "x": 10, "y": 70, "w": 152, "h": 40, "radius": 6, "color": "#66F3BF", "stroke": 2 },
  { "type": "line", "x": 10, "y": 120, "x2": 162, "y2": 120, "color": "#586180", "stroke": 2 },
  { "type": "progress", "x": 10, "y": 130, "w": 152, "h": 12, "color": "#26395A", "fillColor": "#9568FF", "bind": "nivel" },
  { "type": "circle", "x": 40, "y": 190, "r": 25, "color": "#26395A", "stroke": 3 },
  { "type": "arc", "x": 40, "y": 190, "r": 18, "start": -90, "end": 90, "color": "#9568FF", "stroke": 6 },
  { "type": "ellipse", "x": 120, "y": 190, "rx": 40, "ry": 20, "filled": true, "fillColor": "#FFB020" },
  { "type": "polygon", "points": [[20, 250], [40, 220], [60, 250]], "filled": true, "fillColor": "#FF5050" },
  { "type": "curve", "points": [[80, 250], [100, 215], [130, 260], [160, 225]], "color": "#66F3BF", "stroke": 2 },
  { "type": "button", "x": 10, "y": 270, "w": 152, "h": 40, "size": 2, "color": "#FFFFFF", "fillColor": "#245363", "value": "ENCENDER" },
  { "type": "image", "x": 140, "y": 10, "w": 24, "h": 24, "encoding": "rgb565-rle", "data": "ref:0123456789abcdef" }
]
${F}

## 5. Variables: datos = parámetros

### 5.1 De dónde salen

- Una variable es una clave de los datos de la pantalla (\`values\`). Solo se escriben con \`update_display_data\` (o desde la propia pantalla con una acción \`data.set\`, §7). La plantilla no les da valor ni tiene valores por defecto.
- No hay que declararlas: cualquier nombre (1–40 caracteres) sirve en cualquier elemento. Usa nombres cortos y estables (\`temp\`, \`hora\`, \`alarma\`): los datos los comparten todas las plantillas de la pantalla.
- \`get_display.variables\` lista las variables que nombra la plantilla activa; compáralas con \`get_display.values\` para ver cuáles faltan.
- Un valor es un texto (≤ 140 caracteres), un número, un booleano o \`null\`. Máximo 64 claves.

### 5.2 Mecanismos

| Mecanismo | Ejemplo | Efecto |
|---|---|---|
| \`bind\` | \`"bind": "temp"\` | \`value\` = la variable. Si falta, el texto queda vacío. Solo \`text\`, \`progress\` y \`button\`. |
| \`format\` | \`"format": "Temp: {temp} C"\` | Texto con huecos \`{variable}\`. Un hueco de una variable ausente o \`null\` queda vacío. Los números salen tal cual (\`21.456\` → \`21.456\`): redondea antes de enviarlos. Solo \`text\` y \`button\`. |
| \`binds\` | \`"binds": { "end": "angulo", "color": "colorArco" }\` | Cualquier propiedad ligable (tabla) ← una variable. Si la variable falta o no se puede convertir, **se queda la propiedad base**: así se pone un valor de reserva. |
| \`when\` | ver 5.3 | Reglas «si la variable cumple algo, cambia estas propiedades». |
| \`visible\` | \`"visible": false, "binds": { "visible": "alarma" }\` | Mostrar u ocultar el elemento según una variable. |

Propiedades ligables por tipo (las únicas que admiten \`binds\` y \`when.set\`):

| \`type\` | Ligables |
|---|---|
| \`text\` | x, y, size, color, value, format, visible |
| \`rect\` | x, y, w, h, color, fillColor, filled, stroke, radius, visible |
| \`line\` | x, y, x2, y2, color, stroke, visible |
| \`progress\` | x, y, w, h, color, fillColor, value, visible |
| \`button\` | x, y, w, h, size, color, fillColor, value, format, visible |
| \`circle\` | x, y, r, color, fillColor, filled, stroke, visible |
| \`ellipse\` | x, y, rx, ry, color, fillColor, filled, stroke, visible |
| \`polygon\` | color, fillColor, filled, stroke, closed, visible |
| \`arc\` | x, y, r, start, end, color, stroke, visible |
| \`curve\` | color, stroke, visible |
| \`image\` | x, y, visible |

Nunca se ligan \`type\`, \`bind\`, \`points\`, \`encoding\`, \`data\` ni el \`w\`/\`h\` de una imagen.

Conversión de un valor ligado con \`binds\` al tipo de la propiedad:
- \`color\`, \`fillColor\`: solo un texto \`#RRGGBB\` válido.
- \`filled\`, \`closed\`, \`visible\`: verdadero o falso según la regla de \`truthy\` (5.3).
- \`value\`: el valor tal cual. \`format\`: solo un texto.
- Numéricas (\`x\`, \`y\`, \`w\`, \`h\`, \`r\`, \`start\`, \`end\`, \`size\`, \`stroke\`, \`radius\`…): un número o un texto numérico (\`"12"\`), **redondeado** al entero más cercano.
- Lo que no se puede convertir se ignora y se queda la propiedad base.
- Los valores ligados no se comprueban al guardar: si uno saca algo del lienzo, la pantalla lo recorta. Envía valores dentro de rango.

### 5.3 Reglas \`when\`

Lista (máximo 16 por elemento) de \`{ "key", "op", "value", "set" }\`: si la variable \`key\` cumple \`op\` frente a \`value\`, se fusiona \`set\` en el elemento.

| \`op\` | Se cumple si… |
|---|---|
| \`eq\` / \`ne\` | la variable es / no es **exactamente** \`value\`, sin conversión: \`5\` ≠ \`"5"\`, \`true\` ≠ \`"true"\`. |
| \`gt\` / \`gte\` / \`lt\` / \`lte\` | la variable, como número, es > / ≥ / < / ≤ que \`value\`. Un texto numérico (\`"31"\`) vale; si alguno no es un número (o es booleano, \`null\` o falta), la regla **no** se cumple. |
| \`truthy\` / \`falsy\` | la variable es / no es verdadera: \`true\`, un número ≠ 0 o un texto distinto de \`""\`, \`"0"\` y \`"false"\`. Ausente o \`null\` = falsa. Estas dos no llevan \`value\`; el resto lo exige. |

- \`set\` solo puede tener propiedades ligables de ese tipo, y el elemento con \`set\` aplicado tiene que ser válido y caber en el lienzo.
- Las reglas se evalúan **todas, en orden**; si dos tocan la misma propiedad, **gana la última** que se cumple. Pon las más específicas al final (p. ej. \`gt 30\` → naranja y después \`gt 40\` → rojo).

### 5.4 Orden de evaluación (cada redibujado)

1. Propiedades base del elemento.
2. \`bind\` → \`value\`.
3. \`binds\`, con la conversión de 5.2.
4. \`when\`, en orden: cada regla que se cumple fusiona su \`set\` (pisa a \`binds\`).
5. Si \`visible\` acaba en \`false\`, no se dibuja.
6. Si hay \`format\`, sus huecos se rellenan y ese es el texto (pisa a \`value\` y a \`bind\`).

### 5.5 Enviar los datos

- \`update_display_data { deviceId, values }\` hace **merge**: solo cambian las claves enviadas; la pantalla redibuja al momento.
- \`null\` guarda \`null\` (el hueco de \`format\` queda vacío) pero la clave sigue existiendo.
- Para **quitar** variables: \`get_display\` → copia \`values\` sin esas claves → \`update_display_data { values, replace: true }\`.
- No hay reloj ni cálculos en la pantalla: una hora, una fecha o un ángulo calculado son datos que alguien tiene que enviar.

## 6. Animación

${F}json
{ "repeat": 0, "frames": [
  { "ms": 500, "elements": [{ "type": "circle", "x": 160, "y": 12, "r": 5, "filled": true, "fillColor": "#30FF80" }] },
  { "ms": 500, "elements": [] }
] }
${F}

- Va en \`template.animation\`. La pantalla dibuja \`elements\` y, **encima**, los del fotograma actual. Cada fotograma dura \`ms\` (20–60000).
- \`repeat\`: vueltas a la secuencia; \`0\` o ausente = **siempre**. Al acabar las vueltas se queda en el último fotograma.
- Al menos un fotograma. Sus elementos son elementos normales: pueden ser imágenes (animación fotograma a fotograma), usar \`binds\`/\`when\` y tienen que caber en el lienzo.

## 7. Acciones: toques y botones físicos

| Campo | Qué es |
|---|---|
| \`id\` | 1–48 caracteres, **único** en la plantilla. |
| \`trigger\` | \`"tap"\`: zona táctil, con \`x\`, \`y\`, \`w\`, \`h\` **obligatorios**. \`"button"\`: botón físico. |
| \`button\` | Solo en \`button\`: índice lógico 0–${DISPLAY_BUTTONS - 1}. El **0 es el BOOT** de la placa y siempre existe; los demás, según \`info.buttons\` (§9). |
| \`press\` | Solo en \`button\`: \`"short"\` (por defecto, < 700 ms) o \`"long"\` (≥ 700 ms). No puede haber dos acciones con el mismo botón y la misma pulsación. |
| \`x\`, \`y\`, \`w\`, \`h\` | En \`button\` son opcionales y van los cuatro juntos: la zona que se **resalta** al pulsar (para que se vea qué hace el botón). |
| \`mode\` | \`"local"\`: solo actúa la pantalla, no envía nada. \`"remote"\`: envía el evento al servidor y muestra su respuesta. \`"hybrid"\`: las dos cosas. |
| \`local\` | En \`local\`/\`hybrid\`: \`{ "kind": "feedback", "message": "..." }\` (≤ 24 caracteres, un aviso en pantalla) o \`{ "kind": "set_value", "key": "...", "value": ... }\` (cambia un valor **solo en esa pantalla**; el siguiente envío de datos lo pisa). |
| \`event\` | En \`remote\`/\`hybrid\` (≤ 64 caracteres): qué hace el servidor (tabla siguiente). |
| \`payload\` | Valores (como \`values\`, ≤ 64 claves) que usa \`data.set\`. |

Qué hace el servidor con cada \`event\`:

| \`event\` | Efecto | Aviso en pantalla |
|---|---|---|
| \`screen.<templateId>\` | Activa esa plantilla guardada y la envía, con los datos, a la pantalla. **Guárdala antes** (\`set_display_template\` con \`activate: false\`). | \`Pantalla cambiada\` / \`Pantalla no existe\` |
| \`data.refresh\` | Reenvía todos los datos a esa pantalla. | \`Datos actualizados\` |
| \`data.set\` | Fusiona \`payload\` en los datos (como \`update_display_data\`) y la pantalla redibuja. Sin \`payload\` no hace nada de esto. | \`Datos cambiados\` / \`Datos invalidos\` |
| cualquier otro | Solo queda en el historial (\`list_display_events\`). | \`Accion recibida\` |

- Si la acción ya no está en la plantilla activa, o cambió su versión, el servidor la rechaza (\`Accion desactualizada\`).
- \`data.set\` cambia los **datos de la pantalla**, no enciende nada de verdad: para un dispositivo real usa las herramientas de dispositivos.
- Si la plantilla **no** tiene ninguna acción \`button\`, el botón 0 conserva el modo antiguo: la pulsación corta lanza la acción \`tap\` seleccionada y la larga pasa a la siguiente.
- Un \`button\` dibujado no hace nada por sí solo: pon una acción \`tap\` con su misma zona.

## 8. Imágenes

**Subir:** \`upload_display_image\`:

${F}json
{ "deviceId": "md-34B7DA01ABCD", "url": "https://ejemplo.com/foto.jpg", "width": ${W}, "height": ${H}, "fit": "cover", "background": "#000000" }
${F}

- Exactamente uno de \`url\` (solo https pública; ≤ ${MB(MAX_SOURCE_BYTES)}; 10 s; como mucho 3 redirecciones) o \`base64\` (el archivo PNG o JPEG en base64, con o sin \`data:image/...;base64,\`; cabe hasta ~${MB((maxBytes * 3) / 4)} por el tope del cuerpo).
- Solo PNG o JPEG, de hasta ${MAX_SOURCE_SIDE}×${MAX_SOURCE_SIDE} px.
- \`width\` × \`height\`: el tamaño final en la pantalla; tiene que caber en ${W}×${H} o en ${H}×${W}.
- \`fit\`: \`contain\` (entera, con bandas del color \`background\`), \`cover\` (llena la caja y recorta lo que sobre, centrado) o \`fill\` (estira, deformando). \`background\` también rellena las zonas transparentes.
- Devuelve \`{ "ref": "ref:…", "element": { "type": "image", "x": 0, "y": 0, "w", "h", "encoding", "data": "ref:…" }, "bytes" }\`.

**Usar:** copia \`element\` en \`elements\` (o en un fotograma) y cambia **solo** \`x\` e \`y\`. \`w\`/\`h\` tienen que ser los de la subida. Para otro tamaño, vuelve a subirla.

**Fondo:** imagen del tamaño del lienzo en (0, 0) y **la primera** de \`elements\`; lo demás va después y se dibuja encima.

**Referencias:**
- \`ref:\` + 16 hex identifica una imagen por su contenido. Al guardar, el servidor la busca en las subidas de las últimas ${IMAGE_TTL_SEC / 3600} h de esa pantalla y en las imágenes de todas sus plantillas guardadas.
- Al leer (\`get_display\`, \`get_display_template\`, el resultado de \`set_display_template\`) cada imagen sale como \`ref:…\`: para modificar una plantilla con imágenes, reenvíala tal cual y las imágenes se conservan.
- Una referencia que no aparece da \`unknown_image_ref\` con la ruta del elemento: vuelve a subir la imagen.
- Un \`data\` en base64 RGB565 de verdad también vale, pero no lo generes tú.

**Tamaño:** cada imagen ocupa \`bytes\` dentro de la plantilla, y la plantilla entera no puede pasar de ${MB(maxBytes)}. Una foto a pantalla completa ronda los 150 KB; un icono o un dibujo con colores planos, muchísimo menos (se comprime por tramos). Si das con \`message_too_large\`, sube las imágenes más pequeñas o quita alguna.

## 9. La placa: ficha, botones y conexión

\`get_display\` devuelve:
- \`online\`: si la placa está conectada ahora. \`lastSeenAt\`: su último contacto (null si nunca se conectó).
- \`info\` (null si la placa aún no la ha enviado): \`firmware\`, \`board\` (\`model\`, \`chip\`, \`mac\`, \`flashBytes\`, \`psramBytes\`), \`display\` (\`width\`, \`height\`, \`touch\`, \`buttons\` = cuántos botones físicos, \`driver\`), \`buttons\` (\`[{ "button": 0, "name": "BOOT", "gpio": 9 }]\`: el \`button\` es el índice que usan las acciones), \`capabilities\` y \`receivedAt\`.

Cómo usarla:
- Diseña las acciones \`button\` con los índices de \`info.buttons\`. Sin \`info\`, cuenta solo con el botón 0.
- Si \`info.display.touch\` es \`false\`, las acciones \`tap\` no se pueden lanzar: usa botones.
- \`capabilities\` dice qué sabe dibujar el firmware (\`rotation\`, \`stroke\`, \`circle\`, \`ellipse\`, \`polygon\`, \`arc\`, \`curve\`, \`image\`, \`animation\`, \`binds\`, \`rules\`, \`buttons\`, \`frag\`…). El servidor no lo comprueba: si usas algo que no está, la placa rechaza la plantilla y sigue con la anterior. Avisa al usuario.
- Para refrescar la ficha: \`send_display_command { "type": "display.info" }\` y, unos segundos después, \`get_display\`.

## 10. Comandos

\`send_display_command { deviceId, command }\`, solo con la placa conectada (si no, 409 \`device_offline\`):

| \`command\` | Efecto |
|---|---|
| \`{ "type": "display.refresh" }\` | Redibuja la pantalla entera. |
| \`{ "type": "display.brightness", "percent": 30 }\` | Brillo, entero de 0 a 50. |
| \`{ "type": "display.info" }\` | Pide la ficha de la placa (llega a \`get_display.info\`). |

Las plantillas y los datos **no** necesitan conexión: se guardan y la placa los recibe al conectarse.

## 11. Eventos

\`list_display_events { deviceId, limit }\` (1–200, 20 por defecto), del más reciente al más antiguo. Cada evento: \`ts\`, \`actionId\`, \`source\` (\`touch\` | \`button\` | null), \`button\`, \`press\`, \`x\`, \`y\`, \`templateId\`, \`templateVersion\`, \`status\` (\`ok\` | \`rejected\` | \`error\`) y \`toast\`. Solo aparecen las acciones \`remote\`/\`hybrid\` (las \`local\` no salen de la pantalla). Úsalo para comprobar que una acción llega y qué respondió el servidor.

## 12. Límites

| Qué | Límite |
|---|---|
| Plantilla (JSON, con imágenes) y cuerpo de cada llamada al MCP | ${maxBytes} bytes (${MB(maxBytes)}) |
| \`id\` de plantilla / \`version\` | 1–64 caracteres / entero 0–2147483647, creciente |
| Datos | 64 claves de 1–40 caracteres; textos ≤ 140; número, booleano o null |
| \`format\` | ≤ 140 caracteres |
| Coordenadas / medidas | enteros 0–${H - 1} / 1–${H}, dentro del lienzo |
| \`size\` / \`stroke\` / \`radius\` | 1–4 / 1–32 / 0–10 |
| Ángulos de \`arc\` | enteros −360–360 |
| \`polygon\` / \`curve\` | 2–64 / 3–4 puntos |
| Reglas \`when\` | 16 por elemento |
| Fotograma | 20–60000 ms, al menos 1 |
| Acción | \`id\` 1–48 único; \`event\` ≤ 64; \`feedback.message\` ≤ 24; \`button\` 0–${DISPLAY_BUTTONS - 1} |
| Elementos y acciones | sin tope de número (solo el de bytes) |
| Imagen de origen | PNG/JPEG, ≤ ${MB(MAX_SOURCE_BYTES)}, ≤ ${MAX_SOURCE_SIDE}×${MAX_SOURCE_SIDE} px; referencia de subida válida ${IMAGE_TTL_SEC / 3600} h |
| Llamadas | 300 por minuto |

## 13. Errores y cómo corregirlos

Un error vuelve como resultado con \`isError\` y \`{ "error", "message", "issues" }\`. Un argumento con el tipo equivocado vuelve como texto «Input validation error».

| \`error\` | Causa | Qué hacer |
|---|---|---|
| \`invalid_template\` | La plantilla no cumple las reglas. \`issues[].path\` dice dónde (p. ej. \`["elements", 3]\`) y \`message\` qué pasa («el elemento se sale de 172×320», «text exige value, bind o format», «rect no admite binds.value»…). | Corrige ese elemento y reintenta. |
| \`version_not_incremented\` (409) | Ya hay una plantilla con ese \`id\` y una \`version\` igual o mayor. | \`version\` = la de \`get_display.templates\` + 1. |
| \`unknown_image_ref\` | Una \`ref:\` que no es una subida reciente ni una imagen guardada (ruta en \`issues\`). | Vuelve a subirla con \`upload_display_image\`. |
| \`message_too_large\` (413) | La plantilla (o el cuerpo) pasa del tope. | Imágenes más pequeñas o menos imágenes. |
| \`invalid_data\` (422) | Más de 64 variables, o un valor fuera de límites. | Quita variables (\`replace: true\`) o acorta textos. |
| \`template_not_found\` (422) | \`update_display\` con una plantilla que no está guardada. | Guárdala antes o usa un id de \`get_display.templates\`. |
| \`conflict\` (409) | Borrar la plantilla activa. | Activa otra con \`update_display\` y bórrala después. |
| \`device_offline\` (409) | Comando con la placa desconectada. | Espera a \`online: true\`. |
| \`not_found\` (404) | deviceId o plantilla que no existe (o no es del usuario). | \`list_displays\` / \`get_display.templates\`. |
| \`unauthorized\` / \`forbidden\` | La conexión no tiene el permiso \`displays:write\`. | El usuario tiene que volver a conectar el MCP concediéndolo. |
| \`invalid_size\` / \`invalid_input\` | Tamaño de imagen que no cabe / \`url\` y \`base64\` a la vez o ninguno. | Ajusta los argumentos. |
| \`unsupported_image\` | No es PNG ni JPEG, está dañada o la URL no devuelve una imagen. | Otra imagen o convierte a PNG/JPEG. |
| \`image_too_large\` (413) | Origen de más de ${MB(MAX_SOURCE_BYTES)} o de ${MAX_SOURCE_SIDE}×${MAX_SOURCE_SIDE} px. | Una versión más pequeña. |
| \`forbidden_url\` | URL no https o que apunta a una red privada. | Una URL https pública. |
| \`fetch_failed\` (502) | La descarga falló (código HTTP, tiempo, redirecciones). | Comprueba la URL o pasa la imagen en base64. |

## 14. Recetas

En todas: \`list_displays\` para el deviceId y \`get_display\` para ver la plantilla activa, las versiones guardadas, los datos y la ficha de la placa. En los ejemplos, md-34B7DA01ABCD.

### 14.1 «Muestra la temperatura en grande y ponla roja si pasa de 30»

1. \`set_display_template\`:

${F}json
{
  "deviceId": "md-34B7DA01ABCD",
  "template": {
    "id": "temperatura",
    "version": 1,
    "background": "#000000",
    "elements": [
      { "type": "text", "x": 10, "y": 20, "size": 2, "color": "#9AA4C0", "value": "TEMPERATURA" },
      { "type": "text", "x": 10, "y": 120, "size": 4, "color": "#FFFFFF", "format": "{temp} C",
        "when": [{ "key": "temp", "op": "gt", "value": 30, "set": { "color": "#FF3030" } }] }
    ],
    "actions": []
  }
}
${F}

2. \`update_display_data { "deviceId": "md-34B7DA01ABCD", "values": { "temp": 31.5 } }\` → se ve «31.5 C» en rojo. Con 25 se ve blanco.
- Si \`temperatura\` ya existe, usa su versión + 1.
- Tamaño: «31.5 C» son 6 caracteres × 24 px = 144 px; con x = 10 cabe en ${W}.
- Más niveles: añade después \`{ "key": "temp", "op": "gt", "value": 40, "set": { "color": "#FF00FF", "format": "ALERTA {temp} C" } }\` (gana la última que se cumple).

### 14.2 «Pon esta foto de fondo y la hora encima»

1. \`upload_display_image { "deviceId": "md-34B7DA01ABCD", "url": "https://ejemplo.com/foto.jpg", "width": ${W}, "height": ${H}, "fit": "cover" }\` → \`{ "ref": "ref:1a2b3c4d5e6f7a8b", "element": { … }, "bytes": … }\`.
2. \`set_display_template\` con la imagen **la primera**, una franja oscura para que se lea y el texto:

${F}json
{
  "deviceId": "md-34B7DA01ABCD",
  "template": {
    "id": "foto",
    "version": 1,
    "elements": [
      { "type": "image", "x": 0, "y": 0, "w": ${W}, "h": ${H}, "encoding": "rgb565", "data": "ref:1a2b3c4d5e6f7a8b" },
      { "type": "rect", "x": 0, "y": 136, "w": ${W}, "h": 48, "filled": true, "fillColor": "#000000" },
      { "type": "text", "x": 26, "y": 144, "size": 4, "color": "#FFFFFF", "bind": "hora" }
    ],
    "actions": []
  }
}
${F}

3. \`update_display_data { "deviceId": "md-34B7DA01ABCD", "values": { "hora": "12:45" } }\`. La pantalla no tiene reloj: la hora hay que enviarla cada vez que cambie.
- Copia \`encoding\` y \`data\` del \`element\` que devolvió la subida. Centrar: x = (${W} − 5 × 24) / 2 = 26.

### 14.3 «Dos pantallas que se navegan con el botón»

1. Mira \`info.buttons\` en \`get_display\` (el 0, BOOT, siempre está).
2. Guarda la segunda **sin activar**:

${F}json
{
  "deviceId": "md-34B7DA01ABCD",
  "activate": false,
  "template": {
    "id": "pagina.b",
    "version": 1,
    "background": "#102030",
    "elements": [
      { "type": "text", "x": 10, "y": 20, "size": 2, "value": "PAGINA B" },
      { "type": "text", "x": 10, "y": 60, "size": 2, "format": "Hum: {hum} %" },
      { "type": "text", "x": 10, "y": 296, "color": "#9AA4C0", "value": "BOTON: volver" }
    ],
    "actions": [
      { "id": "ir-a", "trigger": "button", "button": 0, "press": "short", "mode": "remote", "event": "screen.pagina.a" }
    ]
  }
}
${F}

3. Guarda y activa la primera:

${F}json
{
  "deviceId": "md-34B7DA01ABCD",
  "template": {
    "id": "pagina.a",
    "version": 1,
    "background": "#000000",
    "elements": [
      { "type": "text", "x": 10, "y": 20, "size": 2, "value": "PAGINA A" },
      { "type": "text", "x": 10, "y": 60, "size": 2, "format": "Temp: {temp} C" },
      { "type": "text", "x": 10, "y": 296, "color": "#9AA4C0", "value": "BOTON: siguiente" }
    ],
    "actions": [
      { "id": "ir-b", "trigger": "button", "button": 0, "press": "short", "mode": "remote", "event": "screen.pagina.b" }
    ]
  }
}
${F}

4. \`update_display_data { "deviceId": "md-34B7DA01ABCD", "values": { "temp": 21, "hum": 40 } }\`: los datos sirven a las dos páginas.
- En una pantalla táctil, añade un \`button\` dibujado y una acción \`{ "id": "toque-b", "trigger": "tap", "x": 10, "y": 250, "w": 152, "h": 40, "mode": "remote", "event": "screen.pagina.b" }\` con la misma zona.
- Una pulsación larga puede hacer otra cosa: \`{ "id": "recargar", "trigger": "button", "button": 0, "press": "long", "mode": "remote", "event": "data.refresh" }\`.
- Comprueba con \`list_display_events\` que llegan las pulsaciones (\`source: "button"\`, \`toast: "Pantalla cambiada"\`).

### 14.4 «Cambia solo un dato»

No toques la plantilla: \`update_display_data { "deviceId": "md-34B7DA01ABCD", "values": { "temp": 22 } }\`. El resto de datos se conserva.
Para quitar \`hum\`: \`get_display\` → \`values\` sin \`hum\` → \`update_display_data { "deviceId": "md-34B7DA01ABCD", "values": { "temp": 22 }, "replace": true }\`.

### 14.5 «Añade un punto que parpadee»

1. \`get_display_template { "deviceId": "md-34B7DA01ABCD" }\` (la activa).
2. Añade \`animation\`, sube \`version\` y guarda la plantilla **entera** (las imágenes \`ref:\` tal cual):

${F}json
{
  "deviceId": "md-34B7DA01ABCD",
  "template": {
    "id": "temperatura",
    "version": 2,
    "background": "#000000",
    "elements": [
      { "type": "text", "x": 10, "y": 20, "size": 2, "color": "#9AA4C0", "value": "TEMPERATURA" },
      { "type": "text", "x": 10, "y": 120, "size": 4, "color": "#FFFFFF", "format": "{temp} C",
        "when": [{ "key": "temp", "op": "gt", "value": 30, "set": { "color": "#FF3030" } }] }
    ],
    "animation": {
      "repeat": 0,
      "frames": [
        { "ms": 500, "elements": [{ "type": "circle", "x": 160, "y": 12, "r": 5, "filled": true, "fillColor": "#30FF80" }] },
        { "ms": 500, "elements": [] }
      ]
    },
    "actions": []
  }
}
${F}

- Que parpadee solo con alarma: al círculo del fotograma, \`"visible": false, "binds": { "visible": "alarma" }\`, y envía \`{ "alarma": true }\`.

### 14.6 «Un botón táctil que encienda y apague» (dato en la pantalla)

${F}json
{
  "deviceId": "md-34B7DA01ABCD",
  "template": {
    "id": "luz",
    "version": 1,
    "background": "#000000",
    "elements": [
      { "type": "text", "x": 10, "y": 20, "size": 2, "format": "Luz: {luz}" },
      { "type": "circle", "x": 86, "y": 140, "r": 40, "filled": true, "fillColor": "#333333",
        "when": [{ "key": "luz", "op": "eq", "value": "ON", "set": { "fillColor": "#FFD000" } }] },
      { "type": "button", "x": 10, "y": 220, "w": 72, "h": 40, "size": 2, "fillColor": "#245363", "value": "ON" },
      { "type": "button", "x": 90, "y": 220, "w": 72, "h": 40, "size": 2, "fillColor": "#532424", "value": "OFF" }
    ],
    "actions": [
      { "id": "on", "trigger": "tap", "x": 10, "y": 220, "w": 72, "h": 40, "mode": "hybrid",
        "local": { "kind": "feedback", "message": "Encendiendo..." }, "event": "data.set", "payload": { "luz": "ON" } },
      { "id": "off", "trigger": "tap", "x": 90, "y": 220, "w": 72, "h": 40, "mode": "remote", "event": "data.set", "payload": { "luz": "OFF" } },
      { "id": "boton-on", "trigger": "button", "button": 0, "press": "short", "x": 10, "y": 220, "w": 72, "h": 40,
        "mode": "remote", "event": "data.set", "payload": { "luz": "ON" } },
      { "id": "boton-off", "trigger": "button", "button": 0, "press": "long", "x": 90, "y": 220, "w": 72, "h": 40,
        "mode": "remote", "event": "data.set", "payload": { "luz": "OFF" } }
    ]
  }
}
${F}

- Tocar «ON» (o el botón 0 corto) pone \`luz = "ON"\` en los datos y el círculo se vuelve amarillo; «OFF» (o el botón 0 largo) lo apaga.
- Esto solo cambia la pantalla. Para que además se encienda una luz real, el usuario o tú tenéis que usar \`set_device_state\` en ese dispositivo.

### 14.7 «Panel horizontal con barra, porcentaje, alarma e indicador de arco»

${F}json
{
  "deviceId": "md-34B7DA01ABCD",
  "template": {
    "id": "deposito",
    "version": 1,
    "rotation": 90,
    "background": "#090D18",
    "elements": [
      { "type": "text", "x": 10, "y": 10, "size": 2, "value": "DEPOSITO" },
      { "type": "progress", "x": 10, "y": 50, "w": 300, "h": 20, "color": "#26395A", "fillColor": "#3080FF", "bind": "nivel",
        "when": [{ "key": "nivel", "op": "lt", "value": 20, "set": { "fillColor": "#FF5050" } }] },
      { "type": "text", "x": 10, "y": 85, "size": 3, "format": "{nivel} %" },
      { "type": "arc", "x": 220, "y": 125, "r": 30, "start": -90, "end": -90, "color": "#66F3BF", "stroke": 6,
        "binds": { "end": "angulo" } },
      { "type": "polygon", "points": [[260, 150], [285, 105], [310, 150]], "filled": true, "fillColor": "#FFB020",
        "visible": false, "binds": { "visible": "alarma" } }
    ],
    "actions": []
  }
}
${F}

Datos: \`{ "nivel": 15, "alarma": true, "angulo": -36 }\`. El arco va de arriba (−90) en sentido horario hasta \`angulo\`; para que siga a \`nivel\`, envía \`angulo = −90 + 3.6 × nivel\` redondeado (la pantalla no calcula).

### 14.8 Cambiar de plantilla, renombrar, borrar y brillo

- Activar otra guardada: \`update_display { "deviceId": "md-34B7DA01ABCD", "activeTemplateId": "pagina.b" }\`.
- Renombrar: \`update_display { "deviceId": "md-34B7DA01ABCD", "name": "Cocina" }\`.
- Borrar una que no es la activa: \`delete_display_template { "deviceId": "md-34B7DA01ABCD", "templateId": "foto" }\`.
- Brillo: \`send_display_command { "deviceId": "md-34B7DA01ABCD", "command": { "type": "display.brightness", "percent": 30 } }\`.

## 15. Checklist antes de guardar

1. **Lo que pidió el usuario**, ni más ni menos: textos, colores, posiciones y comportamiento exactos.
2. \`id\` y \`version\`: si el id ya existe, \`version\` = la guardada + 1.
3. \`rotation\` y lienzo: cada caja dentro (círculos con \`x ± r\`), coordenadas enteras, y los textos caben (6·size px por carácter).
4. Colores \`#RRGGBB\`; textos en ASCII sin tildes, ≤ 140 caracteres.
5. \`text\` y \`button\` con \`value\`, \`bind\` o \`format\`; \`progress\` con \`value\` o \`bind\`.
6. \`binds\` y \`when.set\` solo con propiedades ligables; \`when\` con \`value\` salvo \`truthy\`/\`falsy\`; la regla más fuerte, la última.
7. Imágenes: \`data\` \`ref:…\` de una subida (o de la plantilla leída) con su mismo \`w\`/\`h\`; la de fondo, la primera.
8. Acciones: ids únicos; \`tap\` con \`x,y,w,h\`; botones que existen en \`info.buttons\` y un solo \`button\` + \`press\`; \`screen.<id>\` a plantillas ya guardadas; \`data.set\` con \`payload\`.
9. Plantillas que se navegan: guarda primero las destino con \`activate: false\`.
10. Después de guardar: envía con \`update_display_data\` todas las variables que usa (\`get_display.variables\`) y comprueba con \`get_display\` (y \`list_display_events\` si hay acciones).
`
