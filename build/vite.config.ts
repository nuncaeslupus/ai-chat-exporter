import { defineConfig } from 'vite';
import { resolve } from 'path';

const rootDir = resolve(__dirname, '..');
const srcDir = resolve(rootDir, 'src');

export default defineConfig({
  root: rootDir,
  resolve: {
    alias: {
      '@': srcDir,
      '@core': resolve(srcDir, 'core'),
      '@ui': resolve(srcDir, 'ui'),
      '@extension': resolve(srcDir, 'extension'),
      '@shared': resolve(srcDir, 'shared'),
    },
  },
  build: {
    emptyOutDir: false,
    sourcemap: process.env.NODE_ENV !== 'production',
    minify: process.env.NODE_ENV === 'production',
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
