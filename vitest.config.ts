import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Vitest's 5s default is too tight for this suite, which renders real
    // documents through jsPDF and drives whole popup DOMs in jsdom. The
    // affected tests are not hanging -- they are being starved: measured 2.6s
    // alone and 3-6.6s while another test run or build shares the CPU, which is
    // routine here. That produced false failures across `pagination.test.ts`,
    // `chatgpt.test.ts` and `popup-options.test.ts`, and because `release.sh`
    // re-runs a task's gate, a flake refuses a release for work that is green.
    //
    // A global ceiling rather than more per-test overrides: PR #150 already
    // added a 20s override for three pagination tests and the flakes simply
    // moved elsewhere, so opting in test-by-test demonstrably does not scale.
    // Capping `poolOptions.threads.maxThreads` would remove the contention
    // instead of tolerating it, but it also slows the suite for everyone to fix
    // a problem only concurrency creates. 15s still fails a genuinely hung test,
    // 10s later than before.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts',
        // Generated base64 font data, not logic. Counting it drags every
        // percentage down by the size of the fonts.
        'src/core/exporters/pdf-fonts.generated.ts',
      ],
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
