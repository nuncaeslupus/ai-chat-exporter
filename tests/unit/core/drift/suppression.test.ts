/**
 * Suppression: a fingerprint the user has dismissed or copied is not raised
 * again. The fingerprint embeds the extension version, so shipping a fix
 * restores the prompt with no migration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DRIFT_SUPPRESSION_KEY,
  isDriftSuppressed,
  suppressDrift,
} from '../../../../src/core/drift/suppression';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: (key: string) => Promise.resolve({ [key]: store[key] }),
        set: (items: Record<string, unknown>) => {
          Object.assign(store, items);
          return Promise.resolve();
        },
      },
    },
  });
});

describe('drift suppression', () => {
  it('reports an unknown fingerprint as not suppressed', async () => {
    await expect(isDriftSuppressed('abc123')).resolves.toBe(false);
  });

  it('suppresses a fingerprint once recorded', async () => {
    await suppressDrift('abc123');
    await expect(isDriftSuppressed('abc123')).resolves.toBe(true);
  });

  it('suppresses only that fingerprint', async () => {
    await suppressDrift('abc123');
    await expect(isDriftSuppressed('def456')).resolves.toBe(false);
  });

  it('keeps earlier fingerprints when a new one is added', async () => {
    await suppressDrift('abc123');
    await suppressDrift('def456');
    await expect(isDriftSuppressed('abc123')).resolves.toBe(true);
    expect(store[DRIFT_SUPPRESSION_KEY]).toEqual({ abc123: true, def456: true });
  });

  it('resolves to not-suppressed when storage is unavailable', async () => {
    vi.stubGlobal('chrome', {});
    await expect(isDriftSuppressed('abc123')).resolves.toBe(false);
    await expect(suppressDrift('abc123')).resolves.toBeUndefined();
  });
});
