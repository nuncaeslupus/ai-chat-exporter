import { defineConfig, mergeConfig } from 'vite';
import { resolve } from 'path';
import baseConfig from './vite.config';
import { manifestPlugin } from './vite.manifest-plugin';

const rootDir = resolve(__dirname, '..');
const srcDir = resolve(rootDir, 'src');
const outDir = resolve(rootDir, 'dist/chrome');

export default mergeConfig(
  baseConfig,
  defineConfig({
    build: {
      outDir,
      rollupOptions: {
        input: {
          'background/service-worker': resolve(srcDir, 'extension/background/service-worker.ts'),
          'popup/popup': resolve(srcDir, 'extension/popup/popup.ts'),
        },
      },
    },
    plugins: [manifestPlugin('chrome')],
  })
);
