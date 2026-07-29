/**
 * Stable short hash identifying one *kind* of breakage.
 *
 * Used as the drift report's title (so duplicates collapse visually in a
 * tracker) and as the suppression key. It is a dedup key, not a security
 * primitive: FNV-1a is enough, and unlike `crypto.subtle.digest` it is
 * synchronous, which the `parse()` path requires.
 */

export interface FingerprintInput {
  platform: string;
  extensionVersion: string;
  selectorKeys: string[];
  ruleIds: string[];
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in range without BigInt.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function fingerprint(input: FingerprintInput): string {
  const parts = [
    input.platform,
    input.extensionVersion,
    [...input.selectorKeys].sort().join(','),
    [...input.ruleIds].sort().join(','),
  ];
  // Two independent seeds widen the space enough that unrelated breakages
  // don't collide into one suppressed fingerprint.
  const canonical = parts.join('|');
  const a = fnv1a(canonical).toString(36);
  const b = fnv1a(`${canonical}|salt`).toString(36);
  return `${a}${b}`.slice(0, 12);
}
