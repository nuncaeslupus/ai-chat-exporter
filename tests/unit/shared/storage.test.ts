/**
 * StorageService tests
 *
 * lo-f096: the popup's metadata/timestamp export toggles persist through
 * StorageService.{get,set}UserPreferences — this proves the round trip
 * survives (simulating a browser restart, where only chrome.storage.sync
 * carries state across sessions).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StorageService } from '../../../src/shared/storage';

describe('StorageService export options round-trip', () => {
  beforeEach(() => {
    // vitest.setup.ts mocks chrome.storage.sync.get/set as stateless stubs
    // (get always resolves {}). Swap in a real in-memory store so a
    // set() followed by get() actually round-trips, the way
    // chrome.storage.sync does across a real browser restart.
    const store: Record<string, unknown> = {};
    Object.assign(chrome.storage.sync, {
      get: (key: string) => Promise.resolve({ [key]: store[key] }),
      set: (items: Record<string, unknown>) => {
        Object.assign(store, items);
        return Promise.resolve();
      },
    });
  });

  it('round-trips export options', async () => {
    await StorageService.setUserPreferences({
      includeMetadata: false,
      includeTimestamps: true,
    });

    const prefs = await StorageService.getUserPreferences();

    expect(prefs.includeMetadata).toBe(false);
    expect(prefs.includeTimestamps).toBe(true);
  });

  it('defaults includeTimestamps to true when nothing has been saved yet', async () => {
    const prefs = await StorageService.getUserPreferences();
    expect(prefs.includeTimestamps).toBe(true);
  });

  it('round-trips the text-size step', async () => {
    await StorageService.setUserPreferences({ fontScale: 'compact' });

    expect((await StorageService.getUserPreferences()).fontScale).toBe('compact');
  });

  it('defaults the text-size step to normal when nothing has been saved yet', async () => {
    expect((await StorageService.getUserPreferences()).fontScale).toBe('normal');
  });
});
