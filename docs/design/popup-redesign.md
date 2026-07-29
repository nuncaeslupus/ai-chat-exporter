# Handoff: rediseño del popup de AI Chat Exporter (dirección 5a)

## Overview
Rediseño completo del popup de la extensión `nuncaeslupus/ai-chat-exporter` (rama `main`, código actual en `src/extension/popup/`). El objetivo: un popup corto, de altura constante, entendible a la primera y sin diálogo de ayuda, capaz de crecer (más formatos, más ajustes, listas largas de pares pregunta-respuesta) sin cambiar de forma.

La dirección aprobada es **5a** (evolución de 1c → 2a → 3a → 4b). El resto de turnos del documento de diseño se conservan sólo como historia; **implementa 5a**.

## About the Design Files
Los archivos de este paquete son **referencias de diseño hechas en HTML**: prototipos que muestran el aspecto y el comportamiento previstos, no código de producción para copiar. La tarea es **recrear estos diseños en el entorno real de la extensión** — TypeScript + Vite, `popup.html` + `popup.css` + `popup.ts`, sin framework de UI — siguiendo los patrones ya establecidos en el repo (i18n por `data-i18n` y `_locales/*/messages.json`, `StorageService` para preferencias, mensajes al content script).

No hay React ni build de componentes en el popup: el HTML del prototipo usa estilos en línea porque así se autoriza en la herramienta de diseño; **en el repo, los estilos van a `popup.css` con clases**, siguiendo la nomenclatura existente (`.popup-header`, `.export-controls`, …).

## Fidelity
**Alta fidelidad (hifi).** Colores, tipografías, tamaños, alturas y estados son definitivos y están medidos. Recrear píxel a píxel. Dos salvedades:
- El logo de **Claude** no está en el paquete: el repo sólo trae la “A” de Anthropic (`src/assets/icons/claude-logo.svg`). En los mocks aparece un hueco rayado. Descarga la marca oficial del kit de Anthropic y guárdala con ese mismo nombre.
- El logo de la extensión tiene tres candidatos (A sólido, B trazo, D con tres puntos). El elegido para las maquetas es **A**; queda pendiente la decisión final del autor.

---

## Geometría global

> **Actualizado por R11 (2026-07-29)**, a petición del autor: *«haz las fuentes y
> el popup más grandes»*. La caja de 5a (360 × 310, tipografía de 10,5–17 px) se
> lee pequeña en pantalla real. Las cifras de abajo son las vigentes; las que
> aparecen en cada pantalla de *Screens / Views* son las de 5a, y se convierten a
> las actuales con la tabla de la escala tipográfica en **Design Tokens**.

- Ancho del popup: **420 px** (`body { width: var(--popup-width) }`; era 360).
- **Cabecera fija: 56 px** de alto (padding 14/18, contenido de 28 px; era 48).
- **Cuerpo de altura fija: 320 px**, con `box-sizing: border-box`, `overflow: hidden` y `min-height: 0`. Todos los estados —listo, submenús, avisos, no compatible, recarga— usan exactamente esta caja: **el popup nunca salta de tamaño** (era 260).
- Alto total: **378 px** (56 + 320 + 2 de borde). Muy por debajo del techo de 600 px de Chrome.
- Lo que crece (lista de pares, lista de formatos, futuros ajustes) **scrollea dentro** de esa caja, nunca la estira.
- Los tres valores viven en `:root` de `popup.css` (`--popup-width`,
  `--header-height`, `--body-height`); no hay ninguna altura de caja escrita a
  mano en las reglas de componente.

### Medidas verificadas en navegador (R11)

Con la conversación de ejemplo y el título recortado a dos líneas:

| Vista / estado | Bandas | Suma |
| --- | --- | --- |
| principal (listo, sin selección, avisos) | scroll 118 + filas 104 + barra 98 | **320,0** |
| principal (detectando, avisos sin filas) | scroll 222 + barra 98 | **320,0** |
| principal (no compatible, recarga) | scroll 320 | **320,0** |
| Elegir pares | cabecera 50 + lista 213 + pie 57 | **320,0** |
| Opciones | cabecera 48 + lista 215 + pie 57 | **320,0** |

Contenedor 376 px (378 con el borde del navegador) y **0 px de scroll
horizontal** en las cuatro vistas y los seis estados. `#view-filename` sigue
vacío: es de R6.

Tres apaños se midieron de nuevo con la caja grande, porque sus cifras venían de
la caja pequeña:

- **Título recortado a 2 líneas (R2)**. Su motivo original —«a la tercera línea
  las filas de ajuste se van de la vista»— **ya no aplica**: R2 sacó esas filas
  de la zona de scroll y están visibles con cualquier título. Pero el recorte se
  queda en 2 por un motivo nuevo y medido: en la banda de 118 px, 2 líneas dejan
  26,8 px de holgura, 3 líneas pasan por sólo 2,4 px (una línea más de meta se
  la come) y 4 se salen por 22 px. Lo que sí desaparece: el desbordamiento de
  6 px que tenía a 360 px de ancho — ahora es 0.
- **El estado «con avisos» oculta las filas de ajuste (R7)**. Sigue haciendo
  falta. `Reintentar` ya no se cae del todo (antes se iba 99 px; ahora asoma por
  2,6 px), pero ese margen es del ancho de un título de tarjeta que envuelva, y
  la banda sigue desbordando 100 px, que dejan el bloque de conversación entero
  bajo la línea de corte. Sin las filas, la tarjeta entra con 0 px de desborde.
- **La lista de formatos scrollea (R3)**. Sigue scrolleando: 228 px de filas en
  una banda de 177 px (antes 197 en 154). Los seis formatos no pueden verse a la
  vez — el menú tendría que empezar por encima del borde superior de la caja.

## Screens / Views

> **Los hexes de esta sección son los del handoff, no siempre los que se envían.**
> Siete de ellos no pasan el gate de contraste del repo y se sustituyeron; la
> tabla de **Design Tokens** es la autoridad, y lleva la lista completa con las
> cifras medidas. Igual que con la escala tipográfica, lee la cifra de aquí y
> tradúcela allí — no la copies a `popup.css`.

### 1. Estado principal — “Listo”
**Propósito**: exportar la conversación abierta en un clic.

**Cabecera** (`background:#06342A`, padding `12px 16px`, flex, gap 10):
- Logo 24×24 (marca A, relleno `#7FD9BE`, glifo `#06342A`).
- Nombre `Exportador de Chats IA`, 12.5 px / 650, `#FFFFFF`.
- Versión `1.1.1`, 10.5 px, `rgba(255,255,255,.5)`, `font-variant-numeric: tabular-nums`, en el mismo flujo con `flex:1` (empuja el estado a la derecha). Se lee del manifest, como ya hace `renderVersion()`.
- Píldora de estado: `background:rgba(255,255,255,.14)`, radio 999, padding `3.5px 9px`; punto 5 px `#7FD9BE`; texto 10.5 px / 600 `#C9EDE1`.

**Cuerpo** (320 px, columna):
1. Bloque de conversación (padding `14px 16px 0`, gap 12):
   - Título: 17 px / 700, `line-height:1.25`, `letter-spacing:-.015em`, `text-wrap:pretty`, `#16211E`.
   - Meta: logo de plataforma 13 px + texto 11.5 px `#6E7C77`, `tabular-nums`: `Gemini · 14 pares · 26 – 29 jul` (plataforma · nº de pares · rango de fechas del chat). Sin recuento de palabras aquí.
2. Filas de ajuste (`margin-top:auto`, gap 2), cada una 38 px, `border-radius:8px`, hover `#F4F8F6`:
   - **Contenido** — valor a la derecha (`Toda la conversación` / `3 de 14 pares`), 11.5 px `#8A9691`, chevron 8×12 `#9AA5A1`.
   - **Opciones** — sin contador. Punto verde 5 px `#0A6B54` junto a la etiqueta **sólo si algún ajuste no está en su valor por defecto** (`title="Hay ajustes cambiados"`).
3. Barra de acción (`background:#F7FAF8`, padding `12px 14px 10px`, gap 8):
   - Botón partido, 50 px de alto, radio 12, `#0A6B54`: mitad izquierda `Exportar Markdown` (14 px / 700, icono de descarga 17 px, gap 9); mitad derecha 42 px separada por `1px rgba(255,255,255,.22)` con chevron — abre el menú de formatos. Hover `#075343` (mitad izquierda) / `rgba(255,255,255,.08)`.
   - Botón Imprimir 50×50, radio 12, borde `1.5px #D6E0DB`, icono 19 px `#0A6B54`; hover borde `#0A6B54` + fondo `#F2F8F5`. Deshabilitado para DOCX (borde `#E6ECE9`, icono `#BAC4C0`, `cursor:not-allowed`) — mantener la lógica de `printableFormats` de `popup.ts`.
   - Línea de privacidad, centrada, gap 6: candado 12 px trazo `#7E8D88` + texto 10.5 px `#7E8D88`: **“Se genera en tu navegador. Nada se envía a ningún servidor.”** Siempre visible.

### 2. Menú de formatos (sobre el estado principal)
Se abre al pulsar la mitad derecha del botón. **No es una pantalla completa**: es un menú flotante pegado al botón.
- `position:absolute; left:14px; right:14px; bottom:76px; max-height:180px`.
- `background:#FFFFFF`, radio 12, sombra `0 12px 30px rgba(6,52,42,.22)` + `0 0 0 1px #E2E9E5`, `overflow:hidden`, columna.
- Rótulo `FORMATO`: 10 px / 700, `letter-spacing:.07em`, mayúsculas, `#9AA5A1`, padding `7px 10px 4px`, `flex:none`.
- Lista: `overflow-y:auto; min-height:0`, padding `0 6px 6px`, gap 1. Seis filas de **31 px con `flex:none`** (importante: sin `flex:none` se encogen), radio 8, padding `0 8px`, gap 9: icono 15 px + nombre 12 px. La seleccionada: `background:#E7F1ED`, texto `#075343` / 700, check 12×9 `#0A6B54`. El elemento seleccionado queda visible al abrir.
- El contenido de detrás se atenúa a `opacity:.35`; la mitad derecha del botón se marca (`rgba(255,255,255,.14)`) y el chevron gira 180°.
- Formatos y extensiones: Markdown `.md`, PDF `.pdf`, HTML `.html`, Word `.docx`, Texto plano `.txt`, JSON `.json`.

### 3. Submenú “Contenido” → Elegir pares
Ocupa la misma caja de 320 px, en tres franjas:
- **Cabecera del submenú** (`padding:11px 16px 8px`, `flex:none`): botón volver 24×24, radio 7, `#F1F5F3`, chevron izquierdo; título `Elegir pares` 13 px / 700; a la derecha enlace `Todos` / `Ninguno`, 11.5 px / 600 `#0A6B54`.
- **Lista** (`flex:1; overflow-y:auto`, padding `0 10px 0 16px`, gap 2). Cada fila: checkbox 15 px (`accent-color:#0A6B54`), número de par 11 px / 700 `#9AA5A1` con `tabular-nums` y `min-width:14px` (**tipografía normal, no monospace**), y texto de la pregunta 11.5 px `#2B3833`, `line-height:1.35`, recortado a **2 líneas** con `-webkit-line-clamp:2` (≈120 caracteres, nunca corta a mitad de palabra) más enlace **`más`** 10.5 px / 600 `#0A6B54`. Al desplegar, la fila muestra el texto completo, se tiñe `#F7FAF8` con radio 8 y el enlace pasa a **`menos`**. Los no seleccionados usan `#5F6E69`.
- **Separador de día**: cuando la fecha del par cambia respecto al anterior, fila con dos líneas de 1 px `#EBF0EE` y la fecha centrada, 10 px / 600 `#9AA5A1` (`29 de julio`).
- **Pie** (`background:#F7FAF8`, padding `9px 16px 11px`, `flex:none`): resumen 11 px `#6E7C77` `tabular-nums` (`2 de 14 · 4.120 palabras`) y botón `Hecho` 30 px, radio 8, `#0A6B54`, 12 px / 700.

### 4. Submenú “Opciones”
Misma caja; sin ejemplos ni textos explicativos largos. Tres filas:
1. `Cabecera con los datos del chat` — checkbox 15 px, etiqueta 12.5 px, padding `10px 0`.
2. `Hora en cada mensaje` — igual. **La fecha al cambiar de día no es una opción**: si las horas están activas, el separador de fecha se emite siempre.
3. `Nombre del archivo` — fila navegable (chevron): etiqueta 12.5 px y **debajo el nombre real del archivo** en monospace 10.5 px `#8A9691`, con elipsis (`Gemini_Conversation_2026-07-29.md`).

**Pie** (`background:#F7FAF8`, padding `9px 16px 11px`): `v1.1.1` 10.5 px `tabular-nums`, separadores de 3 px `#C9D3CF`, enlaces `Privacidad` y `GitHub` (11 px, `#6E7C77`) y botón `Hecho` a la derecha.

### 5. Submenú “Nombre del archivo”
- Cabecera igual, con enlace `Por defecto` a la derecha (11 px / 600 `#0A6B54`).
- **Campo de piezas**: `background:#F4F8F6`, radio 10, padding 8, `min-height:44px`, flex con `flex-wrap` y gap 5. Cada pieza es una ficha blanca (`box-shadow:0 0 0 1px #DDE6E2`, radio 7, padding `4px 5px 4px 8px`, 11.5 px / 600) con botón de quitar 15×15 (radio 5, `#F1F5F3`, cruz 7 px). Entre piezas, el separador literal (`_`) en 12 px `#9AA5A1`. Cursor de inserción: barra 1.5×17 `#0A6B54`. Las piezas se reordenan arrastrando.
- **Chips para añadir**: `+ Plataforma`, `+ Modelo`, `+ Hora`, `+ Texto libre` (y `+ Título`, `+ Fecha`, `+ Nº de pares` cuando no estén ya puestas). Fondo blanco, `box-shadow:0 0 0 1px #E2E9E5`, radio 7, padding `5px 9px`, 11.5 px; hover `box-shadow:0 0 0 1.5px #0A6B54; color:#075343`.
- Ayuda: `Arrastra las piezas para reordenarlas.` 10.5 px `#9AA5A1`.
- **Pie fijo**: icono de archivo 13 px + **nombre resultante real** en monospace 11 px `#075343` con elipsis + botón `Hecho`. Se recalcula en vivo con la conversación actual.

### 6. Estados secundarios (misma caja de 320 px)
- **Detectando**: cabecera con punto `#9CC3B7` y texto `Detectando…`; cuerpo con esqueletos (barras `#EDF1EF` / `#F2F5F3`, radios 5–7) y botón inerte `#EDF1EF` con texto `#AEB9B5`.
- **Sin nada seleccionado**: botón `Exportar` deshabilitado (`#E9EEEC` / `#A3AEAA`, `cursor:not-allowed`); la fila Contenido pasa a aviso: `background:#FDF4E7`, radio 9, texto `Ningún par seleccionado` 12.5 px / 600 `#7A5406`, acción `Elegir pares` `#96702A`.
- **Exportado con avisos** (artefactos de Claude no recuperados): punto `#F0C368` y texto `Con avisos` en la cabecera; tarjeta `#FDF4E7`, radio 12, padding `11px 12px`: triángulo 17 px `#B07A0F`, título `Guardado, pero incompleto` 12.5 px / 650 `#6B4A05`, detalle 11.5 px `#7A5C1B`, enlace `Reintentar` 11.5 px / 700 `#8A6A12` subrayado. El botón principal pasa a `Exportar de nuevo`. El motivo completo, en el `title` (ya lo hace `popup.ts` con `response.warning`).
- **Página no compatible**: cabecera atenuada (`#0E2C25`, logo `opacity:.75`, punto `#8FA8A0`, `Inactivo`). Cuerpo centrado: titular `Aquí no hay ninguna conversación que exportar` 15 px / 650; ayuda 12 px `#6E7C77` (`Abre un chat en una de estas páginas — se abrirá en una pestaña nueva.`); **tres enlaces con logo** (ChatGPT, Claude, Gemini), fila completa `background:#F4F8F6`, radio 9, padding `9px 11px`, nombre 12 px / 600, icono “abre en pestaña nueva” 11 px a la derecha. Se generan desde `parserRegistry` (nada de listas duplicadas) y abren la web con `chrome.tabs.create`; el popup se cierra al perder el foco, que es el comportamiento deseado.
- **Recarga necesaria**: punto `#F0C368`, `Recarga`. Círculo 38 px `#FDF4E7` con icono de recarga 20 px `#B07A0F`; titular `Recarga la página para exportar esta conversación` 14.5 px / 650; detalle 11.5 px `#6E7C77`; **botón `Recargar la página`** 42 px, radio 11, `#0A6B54` (usa `chrome.tabs.reload`); debajo, atajo opcional en teclas `Ctrl` `R` (10.5 px monospace sobre `#F1F5F3`, radio 5).

### 7. Modo oscuro (discreto, `prefers-color-scheme: dark`)
Mismo layout, tokens sustituidos: fondo `#141E1B`, cabecera `#0B1F1A`, superficies `#1C2926` / `#182421`, barra inferior `#101917`, bordes `#293833` / `#2E3E38`, texto `#E9F0ED`, texto secundario `#8FA29C` (6,35:1), acento `#3FB394` con texto sobre acento `#07211A`, tinte `#1E332D` y acento claro `#6FD3B5`.

**Corrección de contraste.** El terciario `#7C8C87` que pedía este párrafo clara AA
sobre la página (4,84:1) pero sólo mide **4,27:1 sobre la superficie elevada
`#1C2926`** — que es justo donde se pintan el valor de fila y el separador `_` del
nombre de archivo. Se envía **`#849490`** (5,38:1 sobre la página, 4,75:1 sobre
`#1C2926`): el mismo tratamiento que los seis grises de la tabla clara, en la otra
dirección. Es la única cifra de § 7 que el gate contradice.

**Lo que § 7 no dice.** El párrafo se queda en los neutros y el acento, así que el
resto de la tabla oscura está **derivado**, no diseñado:

- **Ámbar / avisos — pendiente de diseñador.** No hay ningún juego oscuro en el
  handoff. Se derivó invirtiendo el par claro (superficie oscura `#2A2114`, tinta
  clara) y sometiéndolo a los mismos umbrales: `#F5DFAE` (12,10:1), `#E2CB9C`
  (10,00:1), acción y enlace `#E6C37E` (9,41:1), trazo `#E0A93C` (7,47:1), punto
  `#F0C368`. **Pasa el gate, pero el gate no es el juez aquí**: son ocho tokens
  que pintan una tarjeta entera, y ningún test sabe decir si un ámbar así se lee
  como aviso sobre un popup oscuro o como un simple resaltado. Se envía tal cual
  porque no hay alternativa y funciona, pero **quiere el ojo del diseñador y luego
  una línea en este documento** — al contrario que `--color-danger`, que se da por
  bueno porque pinta un punto.
- Derivados menores, sin nada que decidir: el paso de cuerpo `#D5E0DC` bajo el
  texto primario, la hairline `#1F2C28`, la cabecera atenuada `#0A1A16`, el acento
  pulsado `#55C4A6` (en claro el pulsado baja; en oscuro el acento ya es la mitad
  clara del par, así que sube), esqueletos, deshabilitados y el gris decorativo
  `#64736E`.

**El HTML exportado también tiene modo oscuro, y está acotado a `@media screen`**
(`@media screen and (prefers-color-scheme: dark)` en `html-exporter.ts`). Es
deliberado: un documento sale oscuro en pantalla y claro en papel, sin necesidad de
un `@media print` que deshaga la paleta. Ambas paletas del exportado pasan por el
mismo test de contraste.

---

## Interactions & Behavior
- **Exportar** (mitad izquierda): envía `export_conversation` con `format` y `selectedIndices` (lógica actual). Si la respuesta trae `warning`, el popup **no se cierra** y pasa al estado “Exportado con avisos”; si va bien, se cierra.
- **Chevron del botón**: abre/cierra el menú de formatos. Cierra con `Esc`, con clic fuera o al elegir. Al elegir, se persiste (`localStorage.lastExportFormat`, como hoy) y cambian el texto del botón (`Exportar <formato>`) y el estado de Imprimir.
- **Imprimir**: `print_conversation`, mismo tratamiento de `warning`. Deshabilitado en DOCX con `title` explicativo.
- **Filas Contenido / Opciones / Nombre del archivo**: reemplazan el contenido del cuerpo por el submenú correspondiente (transición sugerida: 140 ms de deslizamiento lateral 8 px + fade, o sin animación). Volver con el botón de la cabecera o `Esc`. Nada de esto cambia la altura del popup.
- **Elegir pares**: el checkbox alterna con `SelectionService.toggleSelection`; `Todos` / `Ninguno` con `selectAll` / `deselectAll`; `más` / `menos` sólo despliega texto, no altera la selección.
- **Enlaces de plataforma** (estado no compatible): `chrome.tabs.create({url})`; el popup se cierra solo.
- **Hover/focus**: todas las filas y botones tienen estado hover (indicado arriba) y deben mantener un anillo de foco visible para teclado; el orden de tabulación sigue el orden visual.

## State Management
- `selectedFormat: ExportFormat` — persistido en `localStorage` (`lastExportFormat`).
- `pairs: QAPair[]` con `selected` — copia propia de la conversación (como ya se hace).
- `expandedPairIds: Set<string>` — filas con el texto desplegado (`más` / `menos`).
- `view: 'main' | 'content' | 'options' | 'filename'` — submenú activo.
- `formatMenuOpen: boolean`.
- Preferencias en `StorageService`: `includeMetadata`, `includeTimestamps`, `filenameTemplate` (nuevo: lista ordenada de piezas). El punto verde de “Opciones” = alguna preferencia distinta del valor por defecto.
- Estado de UI: `'detecting' | 'ready' | 'noSelection' | 'warning' | 'unsupported' | 'reload' | 'error'`. `'error'` no tiene pantalla diseñada y sólo pinta el punto de la cabecera; su color está resuelto en **Design Tokens → Estado `error`**.

## Design Tokens

### Contraste: manda el gate, no este documento

El repo hace cumplir WCAG AA en `tests/unit/accessibility/contrast.test.ts`:
**4,5:1 para texto y 3:1 para gráficos no textuales**. El test lee `popup.css`
directamente, resuelve las **dos** tablas de tokens (clara y oscura) y comprueba
cada par texto/fondo. Cuando este documento y el gate no coinciden, **gana el
gate**. Las tablas de abajo recogen lo que se envía, con la cifra medida al lado.

**Ocho usos del handoff no lo pasan, y todos son la misma equivocación**: grises
claros sobre superficies claras — y, en § 7, su inversión oscura. Son siete
colores en ocho ranuras porque `#9AA5A1` falla **dos veces**: como texto y, por
separado, como decoración. Se eligieron sobre el blanco de la maqueta; sobre las
superficies reales del popup (`#F4F8F6` hundida, `#F7FAF8` barra, `#EDF3F0`
hover, `#1C2926` elevada en oscuro) caen todavía más. Se oscurecieron —o
aclararon, en oscuro— lo mínimo para pasar, y varios se fusionaron en un solo
token en vez de mantener un valor por uso: los ocho ocupan **seis** ranuras de
token.

No los trates como siete excepciones sueltas. La regla es una: **un gris de texto
tiene que medirse contra la superficie donde se pinta de verdad, no contra el
blanco.**

#### Correcciones (claro)

| Uso | Handoff | Medido | Se envía | Medido |
| --- | --- | --- | --- | --- |
| Texto secundario — meta, ayuda de estado, resúmenes, pie de opciones | `#6E7C77` | 4,36 blanco · 4,07 `#F4F8F6` · 4,15 `#F7FAF8` | `#63716C` | 5,11 · 4,77 · 4,86 |
| Línea de privacidad (sobre la barra `#F7FAF8`) | `#7E8D88` | **3,30** | mismo token `#63716C` | 4,86 |
| Texto terciario — valor de fila, nombre de archivo en mono | `#8A9691` | 3,06 blanco · 2,86 `#F4F8F6` | `#6A7470` | 4,83 · 4,51 |
| `#9AA5A1` **usado como texto** — nº de par, fecha del separador de día, rótulo `FORMATO`, ayuda de arrastre, separador `_` | `#9AA5A1` | **2,54** blanco | secundario `#63716C` (nº, día, `FORMATO`) · terciario `#6A7470` (ayuda, `_`) | 5,11 · 4,83 |
| Acción `Elegir pares` sobre el aviso `#FDF4E7` | `#96702A` | 4,15 | `#8B6725` | 4,74 |
| Chevron de esa misma fila (decorativo) | `#B08A3F` | **2,94** — falla incluso el listón de 3:1 | mismo token `#8B6725` | 4,74 |
| `#9AA5A1` **usado como decoración** — chevrones de las filas de ajuste y de navegación, puntos separadores del pie | `#9AA5A1` | **2,54** blanco · 2,37 hundida — falla incluso el listón de 3:1 | `#838E8A` | 3,39 · 3,16 |

Y una corrección que **no** es de contraste: la versión de la cabecera. El handoff
pide `rgba(255,255,255,.5)`, que compuesto sobre `#06342A` da `#839A95` y mide
4,58:1 — **pasa**. Se aplanó a `#9FB3AD` (6,22:1 sobre la cabecera, 6,78:1 sobre la
atenuada) sólo porque el checker no resuelve un alfa; el color no era el problema.

#### Colores (claro) — vigentes

| Uso | Valor |
| --- | --- |
| Acento / acciones | `#0A6B54` (6,47:1 sobre blanco, 5,61:1 sobre el tinte) |
| Acento pulsado | `#075343` |
| Cabecera | `#06342A` (atenuada: `#0E2C25`) |
| Acento sobre cabecera | `#7FD9BE`, texto `#C9EDE1` (10,89:1), versión `#9FB3AD` (6,22:1) |
| Tinte de acento | `#E7F1ED` · lavado `#F2F8F5` |
| Texto principal | `#16211E` / `#2B3833` |
| Texto secundario | `#63716C` (5,11:1) · terciario `#6A7470` (4,83:1) |
| Gris decorativo | `#838E8A` (3,16:1 en su peor superficie) — **sólo chevrones y puntos separadores, nunca texto** (ver abajo) |
| Superficie | `#F4F8F6` · barra inferior `#F7FAF8` · hover `#EDF3F0` · teclas `#F1F5F3` |
| Bordes | `#E2E9E5` · botón `#D6E0DB` · fino `#EBF0EE` |
| Aviso | fondo `#FDF4E7`, trazo `#B07A0F`, texto `#6B4A05` / `#7A5C1B` / `#7A5406`, acción y chevron `#8B6725` (4,74:1), enlace `#8A6A12`, punto `#F0C368` |
| Error | `#B3261E` (6,54:1 sobre blanco) — ver «Estado `error`» abajo |
| Deshabilitado | fondo `#E9EEEC`, texto `#A3AEAA`, icono `#BAC4C0`, borde `#E6ECE9` |

Cuatro hexes del handoff no se envían por otra razón — se consolidaron en un token
que ya existía, sin cambiar el contraste: el punto de «detectando» `#9CC3B7` usa
`#8FA8A0` (el mismo punto que «inactivo»); el texto del botón inerte `#AEB9B5` usa
el token de deshabilitado `#A3AEAA`; los puntos separadores del pie `#C9D3CF` usan
el gris decorativo (que sí cambió de contraste, ver la tabla de correcciones:
`#838E8A`); y el anillo de las fichas del nombre de archivo
`#DDE6E2` usa el borde `#E2E9E5`. El nombre resultante del pie (§ 5) usa el texto
principal en vez de `#075343`.

#### Qué es decorativo y qué es texto

Esto está aquí para que nadie «arregle» un color que nunca necesitó 4,5:1:

- **`--color-text-muted`** (`#838E8A` claro / `#64736E` oscuro) es **decorativo**:
  los chevrones de las filas de ajuste y de navegación, y los puntos separadores
  del pie de opciones. Su listón es 3:1, no 4,5:1. El valor del handoff
  (`#9AA5A1`) medía **2,54:1 sobre blanco y 2,37:1 sobre el hover de las filas**,
  así que fallaba incluso ese 3:1; se oscureció a `#838E8A` (3,39 blanco · 3,16
  hundida · 3,22 barra) y **los tres usos están asertados** desde `lo-78c0`. En
  oscuro el valor de § 7 ya pasaba y se envía tal cual, pero con 3,03:1 sobre
  `#1C2926` no le sobra nada.
- También son decorativos y van al listón de 3:1 (y sí están asertados): el check
  del formato elegido, la cruz de quitar ficha, el icono de archivo del pie del
  nombre y el chevron del botón volver.
- No llevan ratio ninguno: los puntos de estado de 5 px, el punto de aviso
  `#F0C368`, las hairlines del separador de día `#EBF0EE` y los bordes.
- El texto deshabilitado (`#A3AEAA` sobre `#E9EEEC`) está exento por WCAG y no se
  aserta.

#### Estado `error`

El enum de *State Management* incluye `'error'` pero el handoff **no le da color**.
Se envía `--color-danger: #B3261E` (claro) / `#F2B8B5` (oscuro), y **se da por
bueno**: es el rojo de error estándar de Material, mide 6,54:1 sobre blanco y
9,99:1 sobre la página oscura, y pinta exactamente un punto de 5 px en la píldora
de la cabecera. No hay pantalla de error diseñada. Si alguna vez se diseña, el
color vuelve a estar en juego; mientras pinte un punto, no bloquea nada.

**Colores (oscuro)**: ver sección 7.

**Tipografía**: pila del sistema, la misma que ya usa `popup.css` (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`). Números siempre con `font-variant-numeric: tabular-nums`. Monospace sólo para nombres de archivo y plantillas: `ui-monospace, SFMono-Regular, Menlo, monospace`.

**Escala tipográfica (R11)**. En 5a los tamaños estaban escritos a mano en ~30
reglas de componente; ahora viven en `:root` igual que la tabla de colores, y
**ninguna regla declara un `font-size` literal**. Los valores son los de 5a
× 1,15 redondeados al 0,5 px más cercano. Para leer cualquier pantalla de
*Screens / Views*, traduce su cifra de 5a con esta tabla:

| Token | 5a | R11 | Usos |
| --- | --- | --- | --- |
| `--text-3xs` | 10 | **11,5** | rótulos en mayúsculas, separador de día |
| `--text-2xs` | 10,5 | **12** | versión, línea de privacidad, monospace del nombre, pies |
| `--text-xs` | 11 | **12,5** | números de par, resúmenes |
| `--text-sm` | 11,5 | **13** | texto de pares, valores de fila, meta, cuerpo del aviso |
| `--text-md` | 12 | **14** | filas de formato, ayuda de estado, `Hecho`, `kbd` |
| `--text-base` | 12,5 | **14,5** | filas de ajuste, nombre en cabecera, título del aviso |
| `--text-lg` | 13 | **15** | títulos de submenú, botón de recarga |
| `--text-xl` | 14 | **16** | base del documento |
| `--text-2xl` | 14,5 | **16,5** | titular del estado «recarga» |
| `--text-3xl` | 15 | **17,5** | titular del estado «no compatible» |
| `--text-4xl` | 17 | **19,5** | título de conversación |
| `--text-action` | 14 | **14** | etiqueta del botón de exportar — *fuera de la escala* |

`--text-action` está deliberadamente fuera de la escala: por indicación del
autor la **barra de acción no crece** («el botón ya es bastante grande»), así
que un futuro ajuste de la escala no debe arrastrarla.

Los tamaños de fila, iconos y paddings **dirigidos por la tipografía** siguen el
mismo factor 1,15; las hairlines, los radios y los bordes de 1,5 px no cambian.
Los colores tampoco cambian: el texto más grande sitúa algunos grises en el
tramo de «texto grande» de WCAG, pero **ningún valor se relaja por eso**.

**Espaciado**: 2 · 5 · 6 · 7 · 8 · 9 · 10 · 11 · 12 · 13 · 14 · 18 px.
**Radios**: 5 (teclas) · 7 (fichas, botón volver) · 8 (filas de menú) · 9 (enlaces de plataforma) · 10 (campo de piezas) · 11–12 (botones grandes, tarjetas, menú flotante) · 999 (píldora de estado). Sin cambios en R11.
**Sombras**: menú flotante `0 12px 30px rgba(6,52,42,.22)` + `0 0 0 1px #E2E9E5`. En el popup real no hace falta sombra exterior (la pone el navegador).
**Alturas fijas (R11)**: cabecera 56 · cuerpo 320 · filas de ajuste 44 · filas de formato 36 · botón `Hecho` 34 · botón de recarga 48 · círculo de recarga 44 · tope del menú de formatos 207. **Sin escalar** (barra de acción): botón principal 50 · mitad derecha 42 · Imprimir 50×50 · etiqueta 14.

## Assets
Copiados del propio repo (`src/assets/icons/`): `icon-128.png`, `chatgpt-logo.svg`, `claude-logo.svg` (la “A” de Anthropic), `md-icon.svg`, `pdf-icon.svg`, `html-icon.svg`, `docx-icon.svg`, `txt-icon.svg`, `json-icon.svg`.

Añadidos en diseño:
- `gemini-spark.svg` — la chispa de Gemini, extraída del trazado que ya vive en `gemini-logo.svg` del repo (mismo degradado). Sustituye al logotipo con texto, que a 13–20 px era ilegible.
- **Pendiente**: marca oficial de Claude (naranja). Guardarla como `src/assets/icons/claude-logo.svg` desde el kit de marca de Anthropic; en los mocks es un cuadrado rayado. Igualmente, si se quiere el logo de ChatGPT en color en vez del trazo negro actual.
- Iconos del propio popup dibujados como SVG en línea (descarga, impresora, chevrons, candado, recarga, triángulo de aviso, cruz, check, abre-en-pestaña-nueva, archivo). Se pueden extraer tal cual del HTML.
- Logo de la extensión: candidatos A/B/D en el HTML (turno 3a). Elegido para maquetas: **A**.

## Files
- `Popup Rediseño.dc.html` — documento de diseño completo. Empieza por el **turno 5a** (arriba): es el diseño a implementar. Debajo, en orden inverso, los turnos 4a/4b, 3a, 2a y 1a–1c con la exploración previa y las decisiones descartadas.
- `Popup Actual.dc.html` — recreación fiel del popup actual (listo, no compatible, recarga) para comparar antes/después.
- `src/assets/icons/` — iconos usados por los dos archivos anteriores.
- `github.md` — asociación con el repo de origen y mapa de pantallas.

Para ver los diseños: abrir los `.dc.html` en un navegador. En el documento de diseño, cada opción tiene un identificador visible (`5a`, `4b`, …) y las referencias entre turnos son enlaces internos.

## Notas de implementación
1. Empieza por la caja fija: `header` de 56 px + contenedor de 320 px con `box-sizing:border-box; overflow:hidden`. Todos los estados se pintan dentro. Es lo que evita que el popup salte.
2. Cualquier lista dentro del cuerpo va en un contenedor `flex:1; overflow-y:auto; min-height:0`, con las cabeceras y pies en `flex:none`. Y las filas de lista, `flex:none` (si no, se encogen).
3. Añade `* { box-sizing: border-box }` al reset de `popup.css`; hoy no está y varias alturas dependen de ello.
4. Nuevas claves de traducción en los siete `_locales`: título de submenús (`Elegir pares`, `Opciones`, `Nombre del archivo`, `Formato`), `Todos` / `Ninguno`, `Hecho`, `Por defecto`, `más` / `menos`, línea de privacidad, `Recargar la página`, `Guardado, pero incompleto`, `Reintentar`, `Ningún par seleccionado`, nombres de las piezas del nombre de archivo. Reutiliza las existentes cuando encajen.
5. La cabecera del archivo exportado (opción “Cabecera con los datos del chat”) debe incluir **plataforma, modelo, rango de fechas de la conversación, fecha de exportación y URL**. El rango de fechas es nuevo respecto a hoy.
6. Con marcas de tiempo activas, los exportadores emiten un **separador de fecha** al cambiar el día (`— 29 jul 2026 —`), no la fecha en cada mensaje.

---

## Estado de los assets (resuelto 2026-07-28)

- **Logo de la extensión: candidato A** (elegido por el autor). Vive en
  `src/assets/icons/icon.svg`; `icon-16/32/48/128.png` se generan de ahí.
- **Logo de Claude: marca oficial**, el *Claude Spark* en Clay del kit de prensa
  de Anthropic (`anthropic.com/press-kit`), guardado como
  `src/assets/icons/claude-logo.svg`. Sustituye a la "A" de Anthropic.
- **Maquetas**: `docs/design/popup-redesign/*.dc.html`. Ábrelas en un navegador;
  la conversación que muestran es inventada, no es una captura real.
