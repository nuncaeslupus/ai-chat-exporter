/**
 * Selector-drift safety net: detect that a platform's DOM changed, without
 * ever carrying conversation content off the user's machine.
 */

export { fingerprint } from './fingerprint';
export type { FingerprintInput } from './fingerprint';
export { checkSelectorHealth, hasFailingRequiredSelector } from './selector-health';
export {
  checkOutputSanity,
  CONTENT_SHORTFALL_RATIO,
  CONTENT_SHORTFALL_MIN_TURN_CHARS,
} from './output-sanity';
export type { SanityInput } from './output-sanity';
export { buildSkeleton, SAFE_ATTR_VALUES } from './skeleton';
export type { SkeletonOptions } from './skeleton';
export { formatDriftReport } from './format-report';
export type { SelectorFinding, SanityFinding, SanityRule, DriftReport } from './types';
