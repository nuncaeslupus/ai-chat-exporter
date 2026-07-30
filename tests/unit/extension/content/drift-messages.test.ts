/**
 * The content script is the only surface with access to the page DOM, so the
 * skeleton is built there — on demand, when the popup asks, never at parse time.
 */
import { describe, it, expect } from 'vitest';
import { MESSAGE_TYPES } from '../../../../src/shared/constants';
import { isGetDriftSkeletonMessage } from '../../../../src/shared/messages';

describe('drift message contract', () => {
  it('declares the skeleton request type', () => {
    expect(MESSAGE_TYPES.GET_DRIFT_SKELETON).toBe('get_drift_skeleton');
  });

  it('recognises a well-formed skeleton request', () => {
    expect(isGetDriftSkeletonMessage({ type: 'get_drift_skeleton' })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isGetDriftSkeletonMessage({ type: 'get_conversation' })).toBe(false);
    expect(isGetDriftSkeletonMessage(null)).toBe(false);
    expect(isGetDriftSkeletonMessage('get_drift_skeleton')).toBe(false);
  });
});
