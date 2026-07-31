import { defineConfig } from 'vitest/config';

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
      // Floors are set just under the measured value on main and ratcheted up as
      // tests land. Re-measure before raising: because coverage only counts files
      // the suite actually imports, adding a test file can *lower* a percentage by
      // pulling more uncovered source into the denominator. Vitest 4 also removed
      // `coverage.all` (which vitest 3 defaulted to `true`), so a file no test
      // imports no longer appears in this report at 0% -- it just vanishes from
      // the denominator instead of dragging the aggregate down. Setting `all: true`
      // is inert on the shipped @vitest/coverage-v8@4.1.10. That regression signal
      // is now covered separately by tests/unit/import-reachability.test.ts, which
      // asserts every src/**/*.ts file is reachable from a test file.
      // Measured on main at 2026-07-30 (vitest 4.1.10, @vitest/coverage-v8@4.1.10):
      // statements 84.70, branches 70.32, functions 90.72, lines 85.02.
      thresholds: {
        statements: 83,
        branches: 69,
        functions: 89,
        lines: 83,
      },
    },
  },
});
