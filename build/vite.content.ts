import { defineConfig, mergeConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import baseConfig from './vite.config';

const rootDir = resolve(__dirname, '..');
const srcDir = resolve(rootDir, 'src');

/**
 * The manifest can only list a *classic* script under `content_scripts`, and a
 * classic script cannot carry static imports -- so the file the manifest points
 * at is a one-line loader that pulls the real module graph in dynamically.
 *
 * That loader is what buys the code splitting: everything past it is an ES
 * module, so an `import()` of an exporter (jsPDF, docx) stays a separate chunk
 * instead of being inlined the way `formats: ['iife']` forced.
 *
 * Chunks are emitted into `assets/` because the manifest already exposes
 * `assets/*` as `web_accessible_resources`, and a content script can only
 * `import()` an extension file that is web-accessible.
 *
 * `content-main` (the page content script) and `deep-research-frame` (the
 * lo-9001 reader that runs inside the sandboxed Deep Research iframe) both
 * need this same loader indirection -- each gets its own one-line loader
 * under `content/`, named after its manifest entry.
 */
const LOADER_ENTRIES = ['content-main', 'deep-research-frame'] as const;

function contentLoaderPlugin(): Plugin {
  let outDir = '';
  return {
    name: 'content-script-loader',
    configResolved(config) {
      outDir = resolve(rootDir, config.build.outDir);
    },
    closeBundle() {
      const contentDir = resolve(outDir, 'content');
      mkdirSync(contentDir, { recursive: true });
      const loaderName: Record<(typeof LOADER_ENTRIES)[number], string> = {
        'content-main': 'content-script.js',
        'deep-research-frame': 'deep-research-frame.js',
      };
      for (const entry of LOADER_ENTRIES) {
        writeFileSync(
          resolve(contentDir, loaderName[entry]),
          `import(chrome.runtime.getURL("assets/${entry}.js"));\n`
        );
      }
    },
  };
}

export default mergeConfig(
  baseConfig,
  defineConfig({
    build: {
      emptyOutDir: false,
      modulePreload: false,
      rollupOptions: {
        input: {
          'content-main': resolve(srcDir, 'extension/content/content-script.ts'),
          'deep-research-frame': resolve(srcDir, 'extension/content/deep-research-frame.ts'),
        },
        output: {
          format: 'es',
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/chunk-[name].js',
        },
        plugins: [
          {
            name: 'extension-url-dynamic-import',
            // A dynamic import's relative specifier resolves against the *page*
            // origin once the loader has run, so rewrite every one of them to an
            // absolute chrome-extension:// URL.
            renderDynamicImport() {
              return {
                left: 'import(chrome.runtime.getURL("assets/"+',
                right: '.split("/").pop()))',
              };
            },
          },
          {
            name: 'remove-cdn-urls',
            // Remove CDN URLs from jsPDF to comply with Chrome Web Store requirements
            transform(code) {
              // Replace the pdfobject CDN URL with empty string
              // This code path is never used (we only use 'blob' output)
              return code.replace(
                /https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdfobject\/[^"]+/g,
                ''
              );
            },
          },
        ],
      },
    },
    plugins: [contentLoaderPlugin()],
  })
);
