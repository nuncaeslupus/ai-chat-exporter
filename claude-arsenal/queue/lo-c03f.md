# Payload: lo-c03f — Content script is 2.24 MB on every page load

**Gate**: `dist/chrome/content/content-script.js` under 300 KB raw; export still works for all six formats.

## Measured today

`dist/chrome/content/content-script.js` = **2,240,428 bytes raw / ~692 KB gzip**, injected into every chatgpt.com, claude.ai (and soon gemini.google.com) page load whether or not the user ever exports.

Three compounding causes:

1. `src/core/exporters/index.ts:5-11` statically imports every exporter — docx, jsPDF, html2canvas all land in the bundle at module scope.
2. `src/extension/content/content-script.ts:12-13` top-level imports `marked` and the full `highlight.js` — **194 `registerLanguage()` calls** in the built output, for a print-only path.
3. `build/vite.content.ts` builds `formats: ['iife']`, which disables code splitting, so even the existing dynamic `import('jspdf')` at `pdf-exporter.ts:55` gets inlined.

## Fix direction

Lazy `import()` per format inside `getExporter()`; `highlight.js/lib/core` with a handful of registered languages instead of the barrel import; and either drop single-file iife or move export work behind `chrome.scripting.executeScript` on demand. A content script this size costs every page load, for a feature used occasionally.

## References

- `build/vite.content.ts` — the iife decision
- `src/core/exporters/index.ts:26-33` — the registry to make lazy
