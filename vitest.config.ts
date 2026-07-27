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
      // Floors are set just under the measured value on main and ratcheted up as
      // tests land. Re-measure before raising: because coverage only counts files
      // the suite actually imports, adding a test file can *lower* a percentage by
      // pulling more uncovered source into the denominator.
      // Measured on main at 2026-07-28: statements 41.99, branches 59.59,
      // functions 75.00, lines 41.99.
      thresholds: {
        statements: 40,
        branches: 58,
        functions: 73,
        lines: 40,
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
