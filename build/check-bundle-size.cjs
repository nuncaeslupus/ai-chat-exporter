#!/usr/bin/env node
/**
 * Budget check for the content script.
 *
 * The content script is injected into every chatgpt.com / claude.ai page load,
 * whether or not the user ever exports, so its *eager* bytes are a per-page-load
 * tax. This asserts that tax stays under LIMIT_BYTES.
 *
 * "Eager" = the classic content script the manifest lists, plus the module it
 * loads, plus every chunk that module statically imports (transitively).
 * Lazily `import()`ed chunks (jsPDF, docx, marked, highlight.js) are excluded --
 * that is the whole point of splitting them out.
 */

const { readFileSync, statSync, existsSync, readdirSync } = require('fs');
const { resolve, dirname, join } = require('path');

const LIMIT_BYTES = 300 * 1024;
const ROOT = resolve(__dirname, '..');
const TARGETS = ['dist/chrome', 'dist/firefox'];

/** Static `import ... from "./x.js"` / `import "./x.js"` specifiers only. */
function staticImports(code) {
  const specifiers = [];
  // `import x from"./y.js"`, `import{a}from"./y.js"`, `import"./y.js"`,
  // `export{a}from"./y.js"` -- all forms end in from"…" or import"…".
  const re = /(?:\bfrom|^import|[;}\n]import)\s*["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(code)) !== null) specifiers.push(match[1]);
  return specifiers;
}

/** Walk the eager graph from `entry`, returning every file in it. */
function eagerGraph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const code = readFileSync(file, 'utf-8');
    for (const specifier of staticImports(code)) {
      if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
    }
  }
  return [...seen];
}

/**
 * Every lazy chunk is reached through `chrome.runtime.getURL(...)`, which the
 * build rewrites from a relative specifier. A wrong name there fails silently
 * at runtime (export just stops working), so assert each target exists.
 */
function checkLazyUrls(target) {
  const dir = join(ROOT, target);
  const sources = [
    join(dir, 'content/content-script.js'),
    ...readdirSync(join(dir, 'assets'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => join(dir, 'assets', name)),
  ];

  const missing = [];
  let checked = 0;
  for (const source of sources) {
    const code = readFileSync(source, 'utf-8');
    const targets = [
      ...[...code.matchAll(/getURL\("(assets\/[^"]+)"\)/g)].map((m) => m[1]),
      ...[...code.matchAll(/getURL\("assets\/"\+"\.\/([^"]+)"/g)].map((m) => `assets/${m[1]}`),
    ];
    for (const resource of targets) {
      checked += 1;
      if (!existsSync(join(dir, resource))) missing.push(`${source} -> ${resource}`);
    }
  }
  return { checked, missing };
}

let failed = false;

for (const target of TARGETS) {
  const contentScript = join(ROOT, target, 'content/content-script.js');
  if (!existsSync(contentScript)) {
    console.error(`FAIL ${target}: ${contentScript} not built`);
    failed = true;
    continue;
  }

  // The classic content script is a loader; follow the module it pulls in.
  const loaderCode = readFileSync(contentScript, 'utf-8');
  const loadedModule = /getURL\(\s*["']([^"']+)["']/.exec(loaderCode)?.[1];

  const files = [contentScript];
  if (loadedModule) files.push(...eagerGraph(join(ROOT, target, loadedModule)));

  const total = files.reduce((sum, file) => sum + statSync(file).size, 0);
  const status = total <= LIMIT_BYTES ? 'ok' : 'FAIL';
  if (total > LIMIT_BYTES) failed = true;

  console.log(
    `${status} ${target}: ${total.toLocaleString()} B eager ` +
      `(limit ${LIMIT_BYTES.toLocaleString()} B, ${files.length} file(s))`
  );
  for (const file of files) {
    console.log(`     ${statSync(file).size.toString().padStart(9)} B  ${file.slice(ROOT.length + 1)}`);
  }

  const { checked, missing } = checkLazyUrls(target);
  if (missing.length > 0) {
    failed = true;
    console.error(`FAIL ${target}: ${missing.length} unresolvable lazy chunk URL(s)`);
    for (const entry of missing) console.error(`     ${entry}`);
  } else {
    console.log(`  ok ${target}: ${checked} lazy chunk URL(s) resolve`);
  }
}

if (failed) {
  console.error('\nContent script bundle check failed.');
  process.exit(1);
}
