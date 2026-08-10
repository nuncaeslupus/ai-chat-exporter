import { defineConfig } from 'vite';
import { resolve } from 'path';

const rootDir = resolve(__dirname, '..');

// ponytail: vite always forces NODE_ENV to 'production' for the `build` command
// regardless of --mode (see vite's resolveConfig), and this file is merged into
// vite.chrome.ts/firefox.ts/content.ts via mergeConfig rather than loaded
// directly, so it can't use the config-function `mode` argument either.
// Reading --mode off argv is the mode Vite itself was actually invoked with.
const modeArgIndex = process.argv.indexOf('--mode');
const mode = modeArgIndex !== -1 ? process.argv[modeArgIndex + 1] : 'production';

const jspdfOptionalStub = resolve(__dirname, 'jspdf-optional-stub.js');

export default defineConfig({
  root: rootDir,
  resolve: {
    // jsPDF's optional deps -- dead weight we never load, and canvg's inlined
    // core-js trips the Chrome Web Store obfuscation scanner. See the stub.
    alias: {
      canvg: jspdfOptionalStub,
      html2canvas: jspdfOptionalStub,
      dompurify: jspdfOptionalStub,
    },
  },
  build: {
    emptyOutDir: false,
    sourcemap: mode !== 'production',
    minify: mode === 'production',
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
