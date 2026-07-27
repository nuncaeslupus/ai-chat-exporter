import { defineConfig, mergeConfig } from 'vite';
import { resolve } from 'path';
import baseConfig from './vite.config';
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'fs';

const rootDir = resolve(__dirname, '..');
const srcDir = resolve(rootDir, 'src');
const outDir = resolve(rootDir, 'dist/chrome');

function chromeManifestPlugin() {
  return {
    name: 'chrome-manifest-plugin',
    closeBundle() {
      const baseManifest = JSON.parse(
        readFileSync(resolve(rootDir, 'manifests/manifest.base.json'), 'utf-8')
      );
      const chromeManifest = JSON.parse(
        readFileSync(resolve(rootDir, 'manifests/manifest.chrome.json'), 'utf-8')
      );

      const merged = deepMerge(baseManifest, chromeManifest);

      mkdirSync(outDir, { recursive: true });
      writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(merged, null, 2));

      // Copy static assets if they exist
      try {
        cpSync(resolve(rootDir, 'src/assets'), resolve(outDir, 'assets'), { recursive: true });
      } catch {
        // Assets folder may not exist yet
      }

      // Copy popup HTML and CSS
      try {
        const popupDir = resolve(outDir, 'popup');
        mkdirSync(popupDir, { recursive: true });
        cpSync(
          resolve(srcDir, 'extension/popup/popup.html'),
          resolve(popupDir, 'popup.html')
        );
        cpSync(
          resolve(srcDir, 'extension/popup/popup.css'),
          resolve(popupDir, 'popup.css')
        );
      } catch (error) {
        console.warn('Failed to copy popup files:', error);
      }

      // Copy content script CSS
      try {
        const contentDir = resolve(outDir, 'content');
        mkdirSync(contentDir, { recursive: true });
        cpSync(
          resolve(srcDir, 'extension/content/styles.css'),
          resolve(contentDir, 'styles.css')
        );
      } catch (error) {
        console.warn('Failed to copy content styles:', error);
      }

      // Copy locales folder
      try {
        cpSync(resolve(rootDir, '_locales'), resolve(outDir, '_locales'), { recursive: true });
      } catch (error) {
        console.warn('Failed to copy locales:', error);
      }
    },
  };
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target } as T;
  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = target[key];
    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object'
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }
  return result;
}

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
    plugins: [chromeManifestPlugin()],
  })
);
