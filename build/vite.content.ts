import { defineConfig, mergeConfig } from 'vite';
import { resolve } from 'path';
import baseConfig from './vite.config';

const rootDir = resolve(__dirname, '..');
const srcDir = resolve(rootDir, 'src');

export default mergeConfig(
  baseConfig,
  defineConfig({
    build: {
      emptyOutDir: false,
      lib: {
        entry: resolve(srcDir, 'extension/content/content-script.ts'),
        name: 'ContentScript',
        formats: ['iife'],
        fileName: () => 'content-script.js',
      },
      rollupOptions: {
        output: {
          entryFileNames: 'content-script.js',
          extend: true,
        },
        plugins: [
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
  })
);
