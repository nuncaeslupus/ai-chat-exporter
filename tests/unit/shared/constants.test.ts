/**
 * lo-f3ba: DEFAULT_PREFERENCES / UserPreferences unification
 *
 * These are compile-time checks, not runtime assertions — `pnpm typecheck`
 * is what actually enforces them. A mismatch here fails typecheck, not `it()`.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFERENCES } from '../../../src/shared/constants';
import type { UserPreferences } from '../../../src/shared/messages';
import * as coreTypes from '../../../src/core/types';

describe('DEFAULT_PREFERENCES / UserPreferences', () => {
  it('satisfies the UserPreferences interface (typed assignment)', () => {
    const asPreferences: UserPreferences = DEFAULT_PREFERENCES;
    expect(asPreferences).toBe(DEFAULT_PREFERENCES);
  });

  it('is not re-exported a second time from the core/types barrel', () => {
    expect('DEFAULT_PREFERENCES' in coreTypes).toBe(false);
  });
});
