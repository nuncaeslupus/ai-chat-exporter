// Stub for jsPDF's optional dependencies (canvg, html2canvas, dompurify).
//
// jsPDF `import()`s these lazily from `addSvgAsImage()` and `.html()`. We use
// neither -- the PDF exporter only draws text and `addImage()`s data URLs -- but
// the bundler still resolves the dynamic imports and emits ~380 KB of chunks we
// never load. One of them (canvg's inlined core-js) builds the string
// `"java" + "script" + ":"` for its legacy iframe shim, which the Chrome Web
// Store review scanner flags as obfuscated code (violation "Red Titanium").
//
// Aliasing them here drops the chunks entirely. Throwing on load keeps the
// failure loud and obvious if a future code path ever does reach one of them.
throw new Error(
  'ai-chat-exporter: jsPDF optional dependency (canvg/html2canvas/dompurify) is ' +
    'stubbed out at build time -- see build/jspdf-optional-stub.js'
);
