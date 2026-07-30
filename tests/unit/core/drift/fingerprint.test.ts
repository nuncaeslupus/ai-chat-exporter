/**
 * Drift fingerprint: the dedup + suppression key. Must be stable across
 * input ordering and must change when the breakage changes.
 */
import { describe, it, expect } from 'vitest';
import { fingerprint } from '../../../../src/core/drift/fingerprint';

const base = {
  platform: 'chatgpt',
  extensionVersion: '1.2.0',
  selectorKeys: ['messageContent'],
  ruleIds: ['content-shortfall'],
};

describe('fingerprint', () => {
  it('is stable for identical input', () => {
    expect(fingerprint(base)).toBe(fingerprint(base));
  });

  it('ignores the order of keys and rules', () => {
    const a = fingerprint({ ...base, selectorKeys: ['a', 'b'], ruleIds: ['x', 'y'] });
    const b = fingerprint({ ...base, selectorKeys: ['b', 'a'], ruleIds: ['y', 'x'] });
    expect(a).toBe(b);
  });

  it('differs when the failing selector set differs', () => {
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, selectorKeys: ['userMessage'] }));
  });

  it('differs when the failing rule set differs', () => {
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, ruleIds: ['no-pairs'] }));
  });

  it('differs across platforms and versions', () => {
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, platform: 'claude' }));
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, extensionVersion: '1.3.0' }));
  });

  it('is short and URL-safe', () => {
    expect(fingerprint(base)).toMatch(/^[0-9a-z]{6,12}$/);
  });
});
