/**
 * lo-f3ba: DEFAULT_PREFERENCES / UserPreferences unification
 *
 * The typed-assignment half of this (DEFAULT_PREFERENCES satisfies
 * UserPreferences) is enforced by `pnpm typecheck` on constants.ts itself.
 */

import { describe, it, expect } from 'vitest';
import * as coreTypes from '../../../src/core/types';

describe('DEFAULT_PREFERENCES / UserPreferences', () => {
  it('is not re-exported a second time from the core/types barrel', () => {
    expect('DEFAULT_PREFERENCES' in coreTypes).toBe(false);
  });
});
