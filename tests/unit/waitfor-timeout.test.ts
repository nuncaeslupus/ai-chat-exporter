/**
 * TEST-3: the `vi.waitFor` default set in tests/setup/vitest.setup.ts.
 *
 * The patch is a property assignment on `vi`, so a vitest upgrade that freezes
 * or re-exports that object would drop it silently -- and the only symptom
 * would be flaky `waitFor` failures under load, somewhere else, weeks later.
 * This asserts the default is in force: a condition that takes longer than
 * vitest's own 1000ms default has to pass.
 */

import { describe, it, expect, vi } from 'vitest';

describe('vi.waitFor default timeout', () => {
  it('outlasts vitest’s own 1000ms default', async () => {
    const readyAt = Date.now() + 1500;
    await vi.waitFor(() => {
      expect(Date.now()).toBeGreaterThanOrEqual(readyAt);
    });
  });

  it('still honours an explicit timeout at the call site', async () => {
    await expect(vi.waitFor(() => expect(false).toBe(true), { timeout: 50 })).rejects.toThrow();
  });
});
