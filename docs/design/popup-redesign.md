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

- Ancho del popup: **360 px** (igual que hoy; `body { width: 360px }`).
- **Cabecera fija: 48 px** de alto (padding 12/16, contenido de 24 px).
- **Cuerpo de altura fija: 260 px**, con `box-sizing: border-box`, `overflow: hidden` y `min-height: 0`. Todos los estados —listo, submenús, avisos, no compatible, recarga— usan exactamente esta caja: **el popup nunca salta de tamaño**.
- Alto total: **310 px** (48 + 260 + 2 de borde). Muy por debajo del techo de 600 px de Chrome.
- Lo que crece (lista de pares, lista de formatos, futuros ajustes) **scrollea dentro** de esa caja, nunca la estira.

## Screens / Views

### 1. Estado principal — “Listo”
**Propósito**: exportar la conversación abierta en un clic.

**Cabecera** (`background:#06342A`, padding `12px 16px`, flex, gap 10):
- Logo 24×24 (marca A, relleno `#7FD9BE`, glifo `#06342A`).
- Nombre `Exportador de Chats IA`, 12.5 px / 650, `#FFFFFF`.
- Versión `1.1.1`, 10.5 px, `rgba(255,255,255,.5)`, `font-variant-numeric: tabular-nums`, en el mismo flujo con `flex:1` (empuja el estado a la derecha). Se lee del manifest, como ya hace `renderVersion()`.
- Píldora de estado: `background:rgba(255,255,255,.14)`, radio 999, padding `3.5px 9px`; punto 5 px `#7FD9BE`; texto 10.5 px / 600 `#C9EDE1`.

**Cuerpo** (260 px, columna):
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
Ocupa la misma caja de 260 px, en tres franjas:
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

### 6. Estados secundarios (misma caja de 260 px)
- **Detectando**: cabecera con punto `#9CC3B7` y texto `Detectando…`; cuerpo con esqueletos (barras `#EDF1EF` / `#F2F5F3`, radios 5–7) y botón inerte `#EDF1EF` con texto `#AEB9B5`.
- **Sin nada seleccionado**: botón `Exportar` deshabilitado (`#E9EEEC` / `#A3AEAA`, `cursor:not-allowed`); la fila Contenido pasa a aviso: `background:#FDF4E7`, radio 9, texto `Ningún par seleccionado` 12.5 px / 600 `#7A5406`, acción `Elegir pares` `#96702A`.
- **Exportado con avisos** (artefactos de Claude no recuperados): punto `#F0C368` y texto `Con avisos` en la cabecera; tarjeta `#FDF4E7`, radio 12, padding `11px 12px`: triángulo 17 px `#B07A0F`, título `Guardado, pero incompleto` 12.5 px / 650 `#6B4A05`, detalle 11.5 px `#7A5C1B`, enlace `Reintentar` 11.5 px / 700 `#8A6A12` subrayado. El botón principal pasa a `Exportar de nuevo`. El motivo completo, en el `title` (ya lo hace `popup.ts` con `response.warning`).
- **Página no compatible**: cabecera atenuada (`#0E2C25`, logo `opacity:.75`, punto `#8FA8A0`, `Inactivo`). Cuerpo centrado: titular `Aquí no hay ninguna conversación que exportar` 15 px / 650; ayuda 12 px `#6E7C77` (`Abre un chat en una de estas páginas — se abrirá en una pestaña nueva.`); **tres enlaces con logo** (ChatGPT, Claude, Gemini), fila completa `background:#F4F8F6`, radio 9, padding `9px 11px`, nombre 12 px / 600, icono “abre en pestaña nueva” 11 px a la derecha. Se generan desde `parserRegistry` (nada de listas duplicadas) y abren la web con `chrome.tabs.create`; el popup se cierra al perder el foco, que es el comportamiento deseado.
- **Recarga necesaria**: punto `#F0C368`, `Recarga`. Círculo 38 px `#FDF4E7` con icono de recarga 20 px `#B07A0F`; titular `Recarga la página para exportar esta conversación` 14.5 px / 650; detalle 11.5 px `#6E7C77`; **botón `Recargar la página`** 42 px, radio 11, `#0A6B54` (usa `chrome.tabs.reload`); debajo, atajo opcional en teclas `Ctrl` `R` (10.5 px monospace sobre `#F1F5F3`, radio 5).

### 7. Modo oscuro (discreto, `prefers-color-scheme: dark`)
Mismo layout, tokens sustituidos: fondo `#141E1B`, cabecera `#0B1F1A`, superficies `#1C2926` / `#182421`, barra inferior `#101917`, bordes `#293833` / `#2E3E38`, texto `#E9F0ED`, texto secundario `#8FA29C` / `#7C8C87`, acento `#3FB394` con texto sobre acento `#07211A`, tinte `#1E332D` y acento claro `#6FD3B5`.

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
- Estado de UI: `'detecting' | 'ready' | 'noSelection' | 'warning' | 'unsupported' | 'reload' | 'error'`.

## Design Tokens
**Colores (claro)**
| Uso | Valor |
| --- | --- |
| Acento / acciones | `#0A6B54` (6.4:1 sobre blanco) |
| Acento pulsado | `#075343` |
| Cabecera | `#06342A` (atenuada: `#0E2C25`) |
| Acento sobre cabecera | `#7FD9BE`, texto `#C9EDE1` |
| Tinte de acento | `#E7F1ED` |
| Texto principal | `#16211E` / `#2B3833` |
| Texto secundario | `#6E7C77` · terciario `#8A9691` / `#9AA5A1` |
| Superficie | `#F4F8F6` · barra inferior `#F7FAF8` · hover `#EDF3F0` |
| Bordes | `#E2E9E5` · botón `#D6E0DB` · fino `#EBF0EE` |
| Aviso | fondo `#FDF4E7`, trazo `#B07A0F`, texto `#6B4A05` / `#7A5C1B`, punto `#F0C368` |
| Deshabilitado | fondo `#E9EEEC`, texto `#A3AEAA`, borde `#E6ECE9` |

**Colores (oscuro)**: ver sección 7.

**Tipografía**: pila del sistema, la misma que ya usa `popup.css` (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`). Escala: 17/700 título de conversación · 14/700 botón principal · 13/700 título de submenú · 12.5/650 nombre en cabecera · 12.5 filas · 11.5–12 valores y textos de pares · 11 números y resúmenes · 10.5 versión, privacidad, monospace de nombre de archivo · 10/700 rótulos en mayúsculas. Números siempre con `font-variant-numeric: tabular-nums`. Monospace sólo para nombres de archivo y plantillas: `ui-monospace, SFMono-Regular, Menlo, monospace`.

**Espaciado**: 2 · 5 · 6 · 8 · 9 · 10 · 12 · 14 · 16 px.
**Radios**: 5 (teclas) · 7 (fichas, botón volver) · 8 (filas de menú) · 9 (enlaces de plataforma) · 10 (campo de piezas) · 11–12 (botones grandes, tarjetas, menú flotante) · 999 (píldora de estado).
**Sombras**: menú flotante `0 12px 30px rgba(6,52,42,.22)` + `0 0 0 1px #E2E9E5`. En el popup real no hace falta sombra exterior (la pone el navegador).
**Alturas fijas**: cabecera 48 · cuerpo 260 · filas de ajuste 38 · botón principal 50 · Imprimir 50×50 · filas de formato 31 · botón `Hecho` 30 · tope del menú de formatos 180.

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
1. Empieza por la caja fija: `header` de 48 px + contenedor de 260 px con `box-sizing:border-box; overflow:hidden`. Todos los estados se pintan dentro. Es lo que evita que el popup salte.
2. Cualquier lista dentro del cuerpo va en un contenedor `flex:1; overflow-y:auto; min-height:0`, con las cabeceras y pies en `flex:none`. Y las filas de lista, `flex:none` (si no, se encogen).
3. Añade `* { box-sizing: border-box }` al reset de `popup.css`; hoy no está y varias alturas dependen de ello.
4. Nuevas claves de traducción en los siete `_locales`: título de submenús (`Elegir pares`, `Opciones`, `Nombre del archivo`, `Formato`), `Todos` / `Ninguno`, `Hecho`, `Por defecto`, `más` / `menos`, línea de privacidad, `Recargar la página`, `Guardado, pero incompleto`, `Reintentar`, `Ningún par seleccionado`, nombres de las piezas del nombre de archivo. Reutiliza las existentes cuando encajen.
5. La cabecera del archivo exportado (opción “Cabecera con los datos del chat”) debe incluir **plataforma, modelo, rango de fechas de la conversación, fecha de exportación y URL**. El rango de fechas es nuevo respecto a hoy.
6. Con marcas de tiempo activas, los exportadores emiten un **separador de fecha** al cambiar el día (`— 29 jul 2026 —`), no la fecha en cada mensaje.
