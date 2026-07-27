import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/index.ts'],
      // Floor set just under measured coverage (statements/lines 20.27%,
      // branches 60.8%, functions 81.15% as of this change) so it actually
      // gates instead of failing on arrival. Raise as testing tasks land.
      thresholds: {
        statements: 20,
        branches: 58,
        functions: 80,
        lines: 20,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@ui': resolve(__dirname, 'src/ui'),
      '@extension': resolve(__dirname, 'src/extension'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
