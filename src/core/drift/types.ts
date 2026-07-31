/**
 * Data shapes for the selector-drift safety net.
 *
 * A `DriftReport` is assembled at parse time and carries no conversation
 * content — only which selectors missed, which sanity rules fired, and the
 * build identity needed to reproduce the breakage.
 */

/** One declared selector, and how many elements it matched on the live page. */
export interface SelectorFinding {
  /** The `SelectorSet` key, e.g. `messageContent` or `custom.assistantTurn`. */
  key: string;
  /** The CSS selector text itself. */
  selector: string;
  /** How many elements it matched. Zero on a required key is drift. */
  matched: number;
  /** Whether a zero match means the parse is broken (vs. a widget being absent). */
  required: boolean;
}

/** The output-sanity rules, evaluated against the parsed pairs. */
export type SanityRule =
  | 'no-pairs'
  | 'turns-dropped'
  | 'empty-answer'
  | 'chrome-as-content'
  | 'content-shortfall'
  | 'no-question';

/** One sanity rule that fired, with enough detail to locate it. */
export interface SanityFinding {
  rule: SanityRule;
  /** Human-readable, content-free, e.g. "pair 3: extracted 13 of 529 chars". */
  detail: string;
}

/** The assembled report. Content-free by construction. */
export interface DriftReport {
  /** Short stable hash: the report title, the dedup key, the suppression key. */
  fingerprint: string;
  platform: string;
  extensionVersion: string;
  /** Build target, not the user agent — the UA is needlessly identifying. */
  buildTarget: 'chrome' | 'firefox';
  /** ISO-8601 UTC date, day precision. */
  detectedAt: string;
  selectorFindings: SelectorFinding[];
  sanityFindings: SanityFinding[];
}
