/**
 * Runs every selector a parser declares against the live document and records
 * how many elements each matched.
 *
 * The required/optional split is the whole point. An optional selector that
 * matches nothing is indistinguishable from a widget that simply isn't on this
 * page — only the required set can tell "broken" from "not present", which is
 * why a zero match on an optional key is recorded but never treated as drift.
 */

import type { SelectorSet } from '../types';
import type { SelectorFinding } from './types';

/** Count matches, reporting an invalid selector as -1 rather than throwing. */
function countMatches(doc: Document, selector: string): number {
  try {
    return doc.querySelectorAll(selector).length;
  } catch {
    return -1;
  }
}

export function checkSelectorHealth(
  doc: Document,
  selectors: SelectorSet,
  requiredKeys: readonly string[]
): SelectorFinding[] {
  const findings: SelectorFinding[] = [];
  const required = new Set(requiredKeys);

  for (const [key, value] of Object.entries(selectors)) {
    if (key === 'custom' || typeof value !== 'string') continue;
    findings.push({
      key,
      selector: value,
      matched: countMatches(doc, value),
      required: required.has(key),
    });
  }

  for (const [name, value] of Object.entries(selectors.custom ?? {})) {
    const key = `custom.${name}`;
    findings.push({
      key,
      selector: value,
      matched: countMatches(doc, value),
      required: required.has(key),
    });
  }

  return findings;
}
