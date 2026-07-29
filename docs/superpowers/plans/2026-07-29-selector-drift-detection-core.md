# Selector-Drift Detection Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect at parse time that a chat platform's DOM has drifted, and attach a structural, content-free report to `ParseResult` — with no UI.

**Architecture:** Four pure modules under `src/core/drift/`, each a plain exported function with no class and no state. `BaseParser.parse()` calls two of them (`checkSelectorHealth`, `checkOutputSanity`) inside a `try`/`catch` that can only ever degrade to "no drift", and attaches the assembled `DriftReport` to `ParseResult.drift`. The third module (`buildSkeleton`) is *not* called during parse — it is exported for the popup surface plan to invoke on demand.

**Tech Stack:** TypeScript (strict), Vitest + jsdom, no new dependencies.

## Global Constraints

- **No new npm dependencies.** The fingerprint hash is hand-rolled (a dedup key, not a security primitive); `crypto.subtle` is async and cannot be used from the synchronous `parse()` path.
- **The safety net must never break an export.** Every drift call site in `BaseParser` is wrapped so a throw degrades to `drift: undefined` and parsing continues.
- **No conversation content leaves the skeleton.** Attribute values are *safelisted in*, never denylisted out. Text nodes become `text(N)`.
- **Skeleton bounds:** 500 nodes, 32 KB, depth 12. Truncation emits `…elided N nodes`, never drops the report.
- **Report body is English only**, regardless of UI locale — it is read by one maintainer.
- All new files carry the repo's existing header-comment style (a `/** ... */` block naming the file's one responsibility).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/drift/types.ts` | The four data shapes + the required-selector key list type |
| `src/core/drift/fingerprint.ts` | `fingerprint()` — stable short hash used as title + suppression key |
| `src/core/drift/selector-health.ts` | `checkSelectorHealth()` — did the declared selectors match? |
| `src/core/drift/output-sanity.ts` | `checkOutputSanity()` — does the parsed result look like a conversation? |
| `src/core/drift/skeleton.ts` | `buildSkeleton()` — structural, leak-proof DOM outline |
| `src/core/drift/index.ts` | Barrel: re-exports the public surface |
| `src/core/types/parser.ts` | Modify: add `drift?: DriftReport` to `ParseResult` |
| `src/core/parsers/base-parser.ts` | Modify: run detection in `parse()`, expose `requiredSelectorKeys` |
| `src/core/parsers/{chatgpt,claude,gemini}/parser.ts` | Modify: override `requiredSelectorKeys` with each platform's custom keys |

---

### Task 1: Drift types and fingerprint

**Files:**
- Create: `src/core/drift/types.ts`
- Create: `src/core/drift/fingerprint.ts`
- Test: `tests/unit/core/drift/fingerprint.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface SelectorFinding { key: string; selector: string; matched: number; required: boolean }`
  - `interface SanityFinding { rule: SanityRule; detail: string }`
  - `type SanityRule = 'no-pairs' | 'empty-answer' | 'chrome-as-content' | 'content-shortfall' | 'no-question'`
  - `interface DriftReport { fingerprint: string; platform: string; extensionVersion: string; buildTarget: 'chrome' | 'firefox'; detectedAt: string; selectorFindings: SelectorFinding[]; sanityFindings: SanityFinding[] }`
  - `function fingerprint(input: { platform: string; extensionVersion: string; selectorKeys: string[]; ruleIds: string[] }): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/drift/fingerprint.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/drift/fingerprint.test.ts`
Expected: FAIL — "Failed to resolve import ... src/core/drift/fingerprint".

- [ ] **Step 3: Write `src/core/drift/types.ts`**

```typescript
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
```

- [ ] **Step 4: Write `src/core/drift/fingerprint.ts`**

```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/drift/fingerprint.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/drift/types.ts src/core/drift/fingerprint.ts tests/unit/core/drift/fingerprint.test.ts
git commit -m "feat: add drift report types and fingerprint"
```

---

### Task 2: SelectorHealth

**Files:**
- Create: `src/core/drift/selector-health.ts`
- Test: `tests/unit/core/drift/selector-health.test.ts`

**Interfaces:**
- Consumes: `SelectorFinding` from `src/core/drift/types.ts`; `SelectorSet` from `src/core/types`.
- Produces: `function checkSelectorHealth(doc: Document, selectors: SelectorSet, requiredKeys: readonly string[]): SelectorFinding[]`
  - Returns a finding for **every** declared selector, required or not, with its match count. Callers filter on `required && matched === 0` to decide what counts as drift.
  - `custom` keys are reported with a `custom.` prefix, e.g. `custom.assistantTurn`.
  - A selector that throws (invalid CSS) is reported as `matched: -1` rather than propagating.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/drift/selector-health.test.ts`:

```typescript
/**
 * SelectorHealth: run every declared selector against the document and
 * report its match count. The required/optional split is what distinguishes
 * "the parser is broken" from "that widget isn't on this page".
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { checkSelectorHealth } from '../../../../src/core/drift/selector-health';
import type { SelectorSet } from '../../../../src/core/types';

const selectors: SelectorSet = {
  conversationContainer: 'main',
  messageElement: '[data-role]',
  userMessage: '[data-role="user"]',
  assistantMessage: '[data-role="assistant"]',
  messageContent: '.content',
  custom: {
    presentWidget: '.widget',
    absentWidget: '.no-such-widget',
  },
};

const required = ['conversationContainer', 'messageElement', 'messageContent'];

function docWith(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('checkSelectorHealth', () => {
  it('reports a match count for every declared selector', () => {
    const doc = docWith('<main><div data-role="user"><p class="content">hi</p></div></main>');
    const findings = checkSelectorHealth(doc, selectors, required);
    const keys = findings.map((f) => f.key);
    expect(keys).toContain('conversationContainer');
    expect(keys).toContain('custom.presentWidget');
    expect(findings.find((f) => f.key === 'messageElement')?.matched).toBe(1);
  });

  it('marks required keys as required and others as optional', () => {
    const doc = docWith('<main></main>');
    const findings = checkSelectorHealth(doc, selectors, required);
    expect(findings.find((f) => f.key === 'messageContent')?.required).toBe(true);
    expect(findings.find((f) => f.key === 'custom.absentWidget')?.required).toBe(false);
  });

  it('records zero matches for a dead selector', () => {
    const doc = docWith('<main></main>');
    const findings = checkSelectorHealth(doc, selectors, required);
    expect(findings.find((f) => f.key === 'messageElement')?.matched).toBe(0);
  });

  it('reports an invalid selector as -1 instead of throwing', () => {
    const doc = docWith('<main></main>');
    const broken: SelectorSet = { ...selectors, messageContent: ':::not-css' };
    expect(() => checkSelectorHealth(doc, broken, required)).not.toThrow();
    const findings = checkSelectorHealth(doc, broken, required);
    expect(findings.find((f) => f.key === 'messageContent')?.matched).toBe(-1);
  });

  it('skips undeclared optional top-level keys', () => {
    const doc = docWith('<main></main>');
    const findings = checkSelectorHealth(doc, selectors, required);
    expect(findings.map((f) => f.key)).not.toContain('conversationTitle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/drift/selector-health.test.ts`
Expected: FAIL — cannot resolve `src/core/drift/selector-health`.

- [ ] **Step 3: Write the implementation**

Create `src/core/drift/selector-health.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/drift/selector-health.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/drift/selector-health.ts tests/unit/core/drift/selector-health.test.ts
git commit -m "feat: add selector health check for drift detection"
```

---

### Task 3: OutputSanity

**Files:**
- Create: `src/core/drift/output-sanity.ts`
- Test: `tests/unit/core/drift/output-sanity.test.ts`

**Interfaces:**
- Consumes: `SanityFinding`, `SanityRule` from `./types`; `QAPair` from `src/core/types`.
- Produces:
  - `interface SanityInput { pairs: QAPair[]; turnCount: number; turnTextLengths: number[]; chromeStrings: readonly string[] }`
    - `turnCount` — how many turn containers the DOM held (so `no-pairs` can distinguish "empty page" from "we extracted nothing from a full page").
    - `turnTextLengths` — the `textContent.length` of the turn element each pair's answer came from, index-aligned with `pairs`. A `-1` entry means "unknown", and suppresses `content-shortfall` for that pair.
    - `chromeStrings` — per-platform UI labels that must never be answer content, e.g. `['ChatGPT said:', 'You said:']`.
  - `function checkOutputSanity(input: SanityInput): SanityFinding[]`
  - `const CONTENT_SHORTFALL_RATIO = 0.05`
  - `const CONTENT_SHORTFALL_MIN_TURN_CHARS = 200`

**Rule semantics (exact — these decide the false-positive rate):**

| Rule | Fires when |
| --- | --- |
| `no-pairs` | `pairs.length === 0` **and** `turnCount > 0` |
| `empty-answer` | a pair's `answer.content` is empty or whitespace only. **Emptiness, not shortness** — an earlier draft used "under 20 characters", which flags `"Yes."` |
| `chrome-as-content` | a pair's trimmed `answer.content` exactly equals one of `chromeStrings` |
| `content-shortfall` | `answer.content.trim().length < 0.05 × turnTextLengths[i]` **and** `turnTextLengths[i] > 200` |
| `no-question` | a pair has a non-empty answer and an empty question, or vice versa |

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/drift/output-sanity.test.ts`:

```typescript
/**
 * OutputSanity: the half of drift detection that catches a parse which
 * *succeeded* and produced structurally well-formed garbage. The ChatGPT Deep
 * Research case is the reference: nothing errored, nothing missed, and the
 * answer came out as the 13-character sr-only label "ChatGPT said:".
 */
import { describe, it, expect } from 'vitest';
import { checkOutputSanity } from '../../../../src/core/drift/output-sanity';
import type { QAPair } from '../../../../src/core/types';

function pair(question: string, answer: string, index = 0): QAPair {
  return {
    index,
    question: { id: `q${index}`, role: 'user', content: question, timestamp: new Date(0) },
    answer: { id: `a${index}`, role: 'assistant', content: answer, timestamp: new Date(0) },
  } as QAPair;
}

const chrome = ['ChatGPT said:', 'You said:'];

describe('checkOutputSanity', () => {
  it('fires no-pairs when the DOM had turns but nothing was extracted', () => {
    const findings = checkOutputSanity({
      pairs: [],
      turnCount: 6,
      turnTextLengths: [],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).toContain('no-pairs');
  });

  it('does not fire no-pairs on a page with no turns at all', () => {
    const findings = checkOutputSanity({
      pairs: [],
      turnCount: 0,
      turnTextLengths: [],
      chromeStrings: chrome,
    });
    expect(findings).toEqual([]);
  });

  it('fires chrome-as-content when the answer is a UI label', () => {
    const findings = checkOutputSanity({
      pairs: [pair('What is X?', 'ChatGPT said:')],
      turnCount: 1,
      turnTextLengths: [529],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).toContain('chrome-as-content');
  });

  it('fires content-shortfall when a long turn yields almost nothing', () => {
    const findings = checkOutputSanity({
      pairs: [pair('What is X?', 'ChatGPT said:')],
      turnCount: 1,
      turnTextLengths: [529],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).toContain('content-shortfall');
  });

  it('does NOT fire content-shortfall on a legitimately terse answer', () => {
    // "Yes." from a 40-character turn is a real answer, not drift. This is the
    // regression that killed the original "under 20 characters" rule.
    const findings = checkOutputSanity({
      pairs: [pair('Is X true?', 'Yes.')],
      turnCount: 1,
      turnTextLengths: [40],
      chromeStrings: chrome,
    });
    expect(findings).toEqual([]);
  });

  it('fires empty-answer only on empty or whitespace content', () => {
    const findings = checkOutputSanity({
      pairs: [pair('Q', '   ')],
      turnCount: 1,
      turnTextLengths: [-1],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).toContain('empty-answer');
  });

  it('fires no-question when a pair is half-formed', () => {
    const findings = checkOutputSanity({
      pairs: [pair('', 'A real answer with plenty of text in it.')],
      turnCount: 1,
      turnTextLengths: [-1],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).toContain('no-question');
  });

  it('returns nothing for a healthy conversation', () => {
    const findings = checkOutputSanity({
      pairs: [
        pair('What is the capital of France?', 'Paris is the capital of France.', 0),
        pair('And of Spain?', 'Madrid is the capital of Spain.', 1),
      ],
      turnCount: 2,
      turnTextLengths: [40, 38],
      chromeStrings: chrome,
    });
    expect(findings).toEqual([]);
  });

  it('suppresses content-shortfall when the turn length is unknown', () => {
    const findings = checkOutputSanity({
      pairs: [pair('Q', 'A')],
      turnCount: 1,
      turnTextLengths: [-1],
      chromeStrings: chrome,
    });
    expect(findings.map((f) => f.rule)).not.toContain('content-shortfall');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/drift/output-sanity.test.ts`
Expected: FAIL — cannot resolve `src/core/drift/output-sanity`.

- [ ] **Step 3: Write the implementation**

Create `src/core/drift/output-sanity.ts`:

```typescript
/**
 * Sanity rules over the *parsed result*, for the drift case that selector
 * health cannot see: a parse that succeeded and produced well-formed garbage.
 *
 * The reference case is ChatGPT Deep Research — nothing errored, nothing
 * missed, and the answer came out as the sr-only label "ChatGPT said:".
 */

import type { QAPair } from '../types';
import type { SanityFinding } from './types';

/** An answer under this share of its turn's text is a shortfall. */
export const CONTENT_SHORTFALL_RATIO = 0.05;
/** ...but only when the turn itself held more than this much text. */
export const CONTENT_SHORTFALL_MIN_TURN_CHARS = 200;

export interface SanityInput {
  pairs: QAPair[];
  /** Turn containers present in the DOM, however many pairs came out. */
  turnCount: number;
  /** textContent.length of each pair's source turn; -1 means unknown. */
  turnTextLengths: number[];
  /** Platform UI labels that must never be answer content. */
  chromeStrings: readonly string[];
}

export function checkOutputSanity(input: SanityInput): SanityFinding[] {
  const findings: SanityFinding[] = [];
  const { pairs, turnCount, turnTextLengths, chromeStrings } = input;

  // The DOM had turns and we produced nothing: the extractor is broken, not
  // the page. An empty page (turnCount 0) is just an empty page.
  if (pairs.length === 0) {
    if (turnCount > 0) {
      findings.push({
        rule: 'no-pairs',
        detail: `0 pairs extracted from ${turnCount} turn container(s)`,
      });
    }
    return findings;
  }

  pairs.forEach((pair, i) => {
    const answer = pair.answer?.content?.trim() ?? '';
    const question = pair.question?.content?.trim() ?? '';

    if (answer.length === 0) {
      findings.push({ rule: 'empty-answer', detail: `pair ${i}: answer is empty` });
    }

    if (chromeStrings.some((label) => answer === label)) {
      findings.push({
        rule: 'chrome-as-content',
        detail: `pair ${i}: answer is the UI label "${answer}"`,
      });
    }

    const turnChars = turnTextLengths[i] ?? -1;
    if (
      turnChars > CONTENT_SHORTFALL_MIN_TURN_CHARS &&
      answer.length < turnChars * CONTENT_SHORTFALL_RATIO
    ) {
      findings.push({
        rule: 'content-shortfall',
        detail: `pair ${i}: extracted ${answer.length} of ${turnChars} chars`,
      });
    }

    if ((answer.length === 0) !== (question.length === 0)) {
      findings.push({
        rule: 'no-question',
        detail: question.length === 0 ? `pair ${i}: no question` : `pair ${i}: no answer`,
      });
    }
  });

  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/drift/output-sanity.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/drift/output-sanity.ts tests/unit/core/drift/output-sanity.test.ts
git commit -m "feat: add output sanity rules for drift detection"
```

---

### Task 4: SkeletonBuilder and the leak property test

This is the task that carries the privacy guarantee. **Attribute values are excluded by default and safelisted in.** The inverse is unsafe: `aria-label="Artifact panel: <conversation title>"` and `data-turn-id="<uuid>"` both carry identifying data, and the next such attribute is unknowable.

**Files:**
- Create: `src/core/drift/skeleton.ts`
- Create: `src/core/drift/index.ts`
- Test: `tests/unit/core/drift/skeleton.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `const SAFE_ATTR_VALUES: readonly string[]` — `['data-turn', 'data-message-author-role', 'data-is-streaming', 'role', 'type']`
  - `interface SkeletonOptions { maxNodes?: number; maxBytes?: number; maxDepth?: number }`
  - `function buildSkeleton(root: Element, options?: SkeletonOptions): string`
- `src/core/drift/index.ts` re-exports: `buildSkeleton`, `SAFE_ATTR_VALUES`, `checkSelectorHealth`, `checkOutputSanity`, `fingerprint`, and all types.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/drift/skeleton.test.ts`:

```typescript
/**
 * SkeletonBuilder. The leak property test below is the single most important
 * test in the drift feature: it is the entire basis for telling users that
 * nothing but structure is sent, and it is the invariant a future refactor
 * could quietly break.
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildSkeleton } from '../../../../src/core/drift/skeleton';

function rootOf(html: string): Element {
  const doc = new JSDOM(`<body>${html}</body>`).window.document;
  return doc.body.firstElementChild as Element;
}

describe('buildSkeleton', () => {
  it('emits tag names, classes and attribute names', () => {
    const skeleton = buildSkeleton(
      rootOf('<main id="main"><div data-testid="x" class="a b">hi</div></main>')
    );
    expect(skeleton).toContain('main');
    expect(skeleton).toContain('div');
    expect(skeleton).toContain('a b');
    expect(skeleton).toContain('data-testid');
  });

  it('replaces every text node with its character count', () => {
    const skeleton = buildSkeleton(rootOf('<div><p>hello world</p></div>'));
    expect(skeleton).toContain('text(11)');
    expect(skeleton).not.toContain('hello');
  });

  it('keeps safelisted attribute values', () => {
    const skeleton = buildSkeleton(rootOf('<div data-turn="assistant" role="button"></div>'));
    expect(skeleton).toContain('data-turn="assistant"');
    expect(skeleton).toContain('role="button"');
  });

  it('drops non-safelisted attribute values but keeps their names', () => {
    const skeleton = buildSkeleton(
      rootOf('<div aria-label="Artifact panel: Q3 revenue plan" data-turn-id="ab-12"></div>')
    );
    expect(skeleton).toContain('aria-label');
    expect(skeleton).not.toContain('Q3 revenue plan');
    expect(skeleton).toContain('data-turn-id');
    expect(skeleton).not.toContain('ab-12');
  });

  // THE LEAK PROPERTY TEST — invariant 2 of the spec.
  it('leaks none of the distinctive strings seeded into the DOM', () => {
    const secrets = [
      'ZZQXSECRETONE',
      'ZZQXSECRETTWO',
      'ZZQXSECRETTHREE',
      'ZZQXSECRETFOUR',
      'ZZQXSECRETFIVE',
      'ZZQXSECRETSIX',
    ];
    const root = rootOf(`
      <main title="${secrets[0]}">
        <h1>${secrets[1]}</h1>
        <div data-turn="user" aria-label="${secrets[2]}" data-message-id="${secrets[3]}">
          <p class="whitespace-pre-wrap">${secrets[4]}</p>
          <img alt="${secrets[5]}" src="https://example.com/${secrets[5]}.png">
        </div>
      </main>
    `);

    const skeleton = buildSkeleton(root);

    for (const secret of secrets) {
      expect(skeleton).not.toContain(secret);
    }
  });

  it('does not leak comment nodes', () => {
    const skeleton = buildSkeleton(rootOf('<div><!-- ZZQXCOMMENT --></div>'));
    expect(skeleton).not.toContain('ZZQXCOMMENT');
  });

  it('truncates with an explicit elision marker instead of dropping', () => {
    const many = Array.from({ length: 50 }, (_, i) => `<div class="n${i}"></div>`).join('');
    const skeleton = buildSkeleton(rootOf(`<main>${many}</main>`), { maxNodes: 10 });
    expect(skeleton).toMatch(/elided \d+ nodes/);
    expect(skeleton).toContain('main');
  });

  it('respects the depth limit', () => {
    let html = '<span class="deepest"></span>';
    for (let i = 0; i < 20; i++) html = `<div class="d${i}">${html}</div>`;
    const skeleton = buildSkeleton(rootOf(html), { maxDepth: 3 });
    expect(skeleton).not.toContain('deepest');
  });

  it('never throws on a detached or empty element', () => {
    expect(() => buildSkeleton(rootOf('<div></div>'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/drift/skeleton.test.ts`
Expected: FAIL — cannot resolve `src/core/drift/skeleton`.

- [ ] **Step 3: Write the implementation**

Create `src/core/drift/skeleton.ts`:

```typescript
/**
 * Builds a structural outline of a DOM subtree that cannot carry conversation
 * content.
 *
 * The rule that makes this safe: **attribute values are excluded by default and
 * safelisted in**. Excluding a denylist would be unsafe — `aria-label="Artifact
 * panel: <conversation title>"` and `data-turn-id="<uuid>"` both carry
 * identifying data, and the next such attribute is unknowable. Attribute
 * *names* are always kept: they are what identifies the markup to a maintainer.
 *
 * Text nodes become `text(N)`. Comments are skipped entirely.
 */

/**
 * Attributes whose values are structural with a known-small vocabulary, and so
 * are safe to reproduce verbatim. Nothing may be added here without checking
 * that the platform cannot put user text in it.
 */
export const SAFE_ATTR_VALUES: readonly string[] = [
  'data-turn',
  'data-message-author-role',
  'data-is-streaming',
  'role',
  'type',
];

export interface SkeletonOptions {
  maxNodes?: number;
  maxBytes?: number;
  maxDepth?: number;
}

const DEFAULTS = { maxNodes: 500, maxBytes: 32_768, maxDepth: 12 };

function renderAttributes(el: Element): string {
  const parts: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'class') continue; // rendered as .a.b on the tag itself
    if (SAFE_ATTR_VALUES.includes(attr.name)) {
      parts.push(`${attr.name}="${attr.value}"`);
    } else {
      parts.push(attr.name);
    }
  }
  return parts.length > 0 ? `[${parts.join('][')}]` : '';
}

function renderTag(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = el.getAttribute('class')?.trim();
  const classPart = classes ? `.${classes.split(/\s+/).join('.')}` : '';
  return `${tag}${classPart}${renderAttributes(el)}`;
}

export function buildSkeleton(root: Element, options: SkeletonOptions = {}): string {
  const { maxNodes, maxBytes, maxDepth } = { ...DEFAULTS, ...options };

  const lines: string[] = [];
  let bytes = 0;
  let visited = 0;
  let elided = 0;

  const walk = (el: Element, depth: number): void => {
    if (depth > maxDepth) {
      elided += el.querySelectorAll('*').length + 1;
      return;
    }
    if (visited >= maxNodes || bytes >= maxBytes) {
      elided += 1;
      return;
    }

    visited += 1;
    const line = `${'  '.repeat(depth)}${renderTag(el)}`;
    lines.push(line);
    bytes += line.length + 1;

    for (const child of Array.from(el.childNodes)) {
      // Node.TEXT_NODE === 3. Only the length survives.
      if (child.nodeType === 3) {
        const length = child.textContent?.trim().length ?? 0;
        if (length > 0) {
          const textLine = `${'  '.repeat(depth + 1)}text(${length})`;
          lines.push(textLine);
          bytes += textLine.length + 1;
        }
        continue;
      }
      // Node.ELEMENT_NODE === 1. Comments (8) and everything else are skipped.
      if (child.nodeType === 1) {
        walk(child as Element, depth + 1);
      }
    }
  };

  walk(root, 0);

  if (elided > 0) {
    lines.push(`…elided ${elided} nodes`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Write `src/core/drift/index.ts`**

```typescript
/**
 * Selector-drift safety net: detect that a platform's DOM changed, without
 * ever carrying conversation content off the user's machine.
 */

export { fingerprint } from './fingerprint';
export type { FingerprintInput } from './fingerprint';
export { checkSelectorHealth } from './selector-health';
export {
  checkOutputSanity,
  CONTENT_SHORTFALL_RATIO,
  CONTENT_SHORTFALL_MIN_TURN_CHARS,
} from './output-sanity';
export type { SanityInput } from './output-sanity';
export { buildSkeleton, SAFE_ATTR_VALUES } from './skeleton';
export type { SkeletonOptions } from './skeleton';
export type { SelectorFinding, SanityFinding, SanityRule, DriftReport } from './types';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/drift/skeleton.test.ts`
Expected: PASS (9 tests, including the leak property test).

- [ ] **Step 6: Commit**

```bash
git add src/core/drift/skeleton.ts src/core/drift/index.ts tests/unit/core/drift/skeleton.test.ts
git commit -m "feat: add leak-proof DOM skeleton builder for drift reports"
```

---

### Task 5: Wire detection into BaseParser

**Files:**
- Modify: `src/core/types/parser.ts` (add `drift?: DriftReport` to `ParseResult`)
- Modify: `src/core/parsers/base-parser.ts:63-85` (`parse()`), and add three new protected members
- Modify: `src/core/parsers/chatgpt/parser.ts`, `src/core/parsers/claude/parser.ts`, `src/core/parsers/gemini/parser.ts`
- Test: `tests/unit/core/drift/base-parser-drift.test.ts`

**Interfaces:**
- Consumes: `checkSelectorHealth`, `checkOutputSanity`, `fingerprint`, `DriftReport` from `src/core/drift`.
- Produces, on `BaseParser`:
  - `protected get requiredSelectorKeys(): readonly string[]` — defaults to the five mandatory `SelectorSet` keys: `['conversationContainer', 'messageElement', 'userMessage', 'assistantMessage', 'messageContent']`. Parsers override to add their own `custom.*` keys.
  - `protected get chromeStrings(): readonly string[]` — defaults to `[]`.
  - `protected turnTextLengthsFor(pairs: QAPair[]): number[]` — defaults to `pairs.map(() => -1)` (unknown), which suppresses `content-shortfall`. Overriding it is what turns the rule on for a platform.
  - `protected detectDrift(pairs: QAPair[]): DriftReport | undefined`
- `ParseResult` gains `drift?: DriftReport`.

**Note on `extensionVersion` and `buildTarget`:** read from `chrome.runtime.getManifest().version` when `chrome.runtime` exists, else `'unknown'`. `buildTarget` is `'firefox'` when `navigator.userAgent` contains `Firefox`, else `'chrome'` — the target is derived here and the UA string itself is never stored.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/drift/base-parser-drift.test.ts`:

```typescript
/**
 * BaseParser wiring: a parse attaches a DriftReport when something is wrong,
 * attaches nothing when the page is healthy, and NEVER fails because the
 * safety net threw.
 */
import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { BaseParser } from '../../../../src/core/parsers/base-parser';
import type { ParserConfig, PlatformInfo, QAPair, SelectorSet } from '../../../../src/core/types';

const SELECTORS: SelectorSet = {
  conversationContainer: 'main',
  messageElement: '[data-turn]',
  userMessage: '[data-turn="user"]',
  assistantMessage: '[data-turn="assistant"]',
  messageContent: '.content',
};

function makePair(question: string, answer: string, index = 0): QAPair {
  return {
    index,
    question: { id: `q${index}`, role: 'user', content: question, timestamp: new Date(0) },
    answer: { id: `a${index}`, role: 'assistant', content: answer, timestamp: new Date(0) },
  } as QAPair;
}

class TestParser extends BaseParser {
  readonly platformInfo = { id: 'chatgpt', name: 'Test' } as PlatformInfo;
  readonly selectors = SELECTORS;
  pairsToReturn: QAPair[] = [];

  canParse(): boolean {
    return true;
  }
  getTitle(): string {
    return 'Test';
  }
  getModel(): string | null {
    return null;
  }
  getButtonInjectionPoint(): HTMLElement | null {
    return null;
  }
  protected extractQAPairs(_config: ParserConfig): QAPair[] {
    return this.pairsToReturn;
  }
  protected override get chromeStrings(): readonly string[] {
    return ['ChatGPT said:'];
  }
}

function parserFor(html: string): TestParser {
  return new TestParser(new JSDOM(html).window.document);
}

describe('BaseParser drift detection', () => {
  it('attaches no drift report to a healthy parse', () => {
    const parser = parserFor(
      '<main><div data-turn="user"><span class="content">hi</span></div>' +
        '<div data-turn="assistant"><span class="content">hello</span></div></main>'
    );
    parser.pairsToReturn = [makePair('hi', 'hello there, this is a real answer')];
    const result = parser.parse();
    expect(result.success).toBe(true);
    expect(result.drift).toBeUndefined();
  });

  it('attaches a drift report when a required selector matches nothing', () => {
    const parser = parserFor('<main><div class="totally-different"></div></main>');
    parser.pairsToReturn = [makePair('hi', 'hello there, this is a real answer')];
    const result = parser.parse();
    expect(result.drift).toBeDefined();
    expect(result.drift?.selectorFindings.some((f) => f.key === 'messageElement' && f.matched === 0)).toBe(
      true
    );
  });

  it('attaches a drift report when a sanity rule fires', () => {
    const parser = parserFor(
      '<main><div data-turn="user"><span class="content">hi</span></div>' +
        '<div data-turn="assistant"><span class="content">x</span></div></main>'
    );
    parser.pairsToReturn = [makePair('hi', 'ChatGPT said:')];
    const result = parser.parse();
    expect(result.drift?.sanityFindings.map((f) => f.rule)).toContain('chrome-as-content');
  });

  it('carries a fingerprint, platform and ISO date', () => {
    const parser = parserFor('<main></main>');
    parser.pairsToReturn = [];
    const drift = parser.parse().drift;
    expect(drift?.fingerprint).toMatch(/^[0-9a-z]+$/);
    expect(drift?.platform).toBe('chatgpt');
    expect(drift?.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('never breaks the export when detection throws', () => {
    const parser = parserFor('<main><div data-turn="user"></div></main>');
    parser.pairsToReturn = [makePair('hi', 'a real answer here')];
    // Force the detector to blow up.
    vi.spyOn(
      parser as unknown as { detectDriftUnsafe: () => void },
      'detectDriftUnsafe'
    ).mockImplementation(() => {
      throw new Error('boom');
    });
    const result = parser.parse();
    expect(result.success).toBe(true);
    expect(result.conversation).toBeDefined();
    expect(result.drift).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/drift/base-parser-drift.test.ts`
Expected: FAIL — `result.drift` is `undefined` where a report is expected, and `detectDriftUnsafe` does not exist.

- [ ] **Step 3: Add `drift` to `ParseResult`**

In `src/core/types/parser.ts`, add the import and the field:

```typescript
import type { DriftReport } from '../drift/types';
```

and inside `export interface ParseResult { ... }`, after `warnings?: string[];`:

```typescript
  /**
   * Set when the page's DOM appears to have drifted from what this parser
   * expects. Content-free by construction; see `src/core/drift`.
   */
  drift?: DriftReport;
```

- [ ] **Step 4: Wire detection into `BaseParser`**

In `src/core/parsers/base-parser.ts`, add to the imports:

```typescript
import {
  checkOutputSanity,
  checkSelectorHealth,
  fingerprint,
  type DriftReport,
} from '../drift';
```

Replace the body of `parse()` (currently lines 63-85) so the drift call is inside the existing `try`:

```typescript
  parse(config?: Partial<ParserConfig>): ParseResult {
    const mergedConfig = { ...this.config, ...config };

    try {
      const pairs = this.extractQAPairs(mergedConfig);
      const conversation = this.buildConversation(pairs);
      const warnings = this.collectWarnings(pairs);

      const result: ParseResult = {
        success: true,
        conversation,
      };
      if (warnings) {
        result.warnings = warnings;
      }
      const drift = this.detectDrift(pairs);
      if (drift) {
        result.drift = drift;
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown parsing error',
      };
    }
  }
```

Then append these members to the class, just above `collectWarnings`:

```typescript
  /**
   * Selector keys whose zero-match means this parser is broken, as opposed to
   * a widget simply not being on the page. The five mandatory `SelectorSet`
   * keys are always required; a parser adds its own `custom.*` keys by
   * overriding this.
   */
  protected get requiredSelectorKeys(): readonly string[] {
    return [
      'conversationContainer',
      'messageElement',
      'userMessage',
      'assistantMessage',
      'messageContent',
    ];
  }

  /** Platform UI labels that must never appear as answer content. */
  protected get chromeStrings(): readonly string[] {
    return [];
  }

  /**
   * `textContent.length` of the turn element each pair's answer came from,
   * index-aligned with `pairs`. -1 means unknown, which suppresses the
   * `content-shortfall` rule for that pair — so the rule stays off until a
   * parser opts in by overriding this.
   */
  protected turnTextLengthsFor(pairs: QAPair[]): number[] {
    return pairs.map(() => -1);
  }

  /**
   * Assemble a drift report, or `undefined` when nothing is wrong.
   *
   * Best-effort by contract: a throw anywhere in here degrades to "no drift"
   * and the export proceeds. The safety net must never break an export.
   */
  protected detectDrift(pairs: QAPair[]): DriftReport | undefined {
    try {
      return this.detectDriftUnsafe(pairs);
    } catch {
      return undefined;
    }
  }

  /** The real work; `detectDrift` is the guard around it. */
  protected detectDriftUnsafe(pairs: QAPair[]): DriftReport | undefined {
    const selectorFindings = checkSelectorHealth(
      this.document,
      this.selectors,
      this.requiredSelectorKeys
    );
    const sanityFindings = checkOutputSanity({
      pairs,
      turnCount: this.countTurnContainers(),
      turnTextLengths: this.turnTextLengthsFor(pairs),
      chromeStrings: this.chromeStrings,
    });

    const failingSelectors = selectorFindings.filter((f) => f.required && f.matched <= 0);
    if (failingSelectors.length === 0 && sanityFindings.length === 0) {
      return undefined;
    }

    return {
      fingerprint: fingerprint({
        platform: this.platformInfo.id,
        extensionVersion: this.extensionVersion(),
        selectorKeys: failingSelectors.map((f) => f.key),
        ruleIds: sanityFindings.map((f) => f.rule),
      }),
      platform: this.platformInfo.id,
      extensionVersion: this.extensionVersion(),
      buildTarget: this.buildTarget(),
      detectedAt: new Date().toISOString().slice(0, 10),
      selectorFindings,
      sanityFindings,
    };
  }

  /** How many turn containers the DOM holds, however many pairs came out. */
  protected countTurnContainers(): number {
    try {
      return this.document.querySelectorAll(this.selectors.messageElement).length;
    } catch {
      return 0;
    }
  }

  private extensionVersion(): string {
    try {
      return chrome?.runtime?.getManifest?.().version ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * The build target, derived from the UA but never storing it — a user agent
   * string is needlessly identifying for a report whose only job is to name a
   * broken selector.
   */
  private buildTarget(): 'chrome' | 'firefox' {
    const ua = this.document.defaultView?.navigator?.userAgent ?? '';
    return /firefox/i.test(ua) ? 'firefox' : 'chrome';
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/drift/base-parser-drift.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Declare the platform chrome strings and required custom keys**

In `src/core/parsers/chatgpt/parser.ts`, add to the class:

```typescript
  protected override get chromeStrings(): readonly string[] {
    return ['ChatGPT said:', 'You said:'];
  }

  protected override get requiredSelectorKeys(): readonly string[] {
    return [...super.requiredSelectorKeys, 'custom.conversationTurn', 'custom.assistantTurn'];
  }
```

In `src/core/parsers/claude/parser.ts`:

```typescript
  protected override get requiredSelectorKeys(): readonly string[] {
    return [...super.requiredSelectorKeys, 'custom.turnContainer', 'custom.userTurnWrapper'];
  }
```

In `src/core/parsers/gemini/parser.ts` — Gemini's turn markup is the platform's own; keep the base five and add nothing, so no override is needed. Leave that file unmodified.

- [ ] **Step 7: Run the whole suite and the typecheck**

Run: `pnpm test:run`
Expected: PASS. Then run `pnpm typecheck` (or `pnpm validate`) — expected: clean.

> **Do not run `pnpm build` concurrently with `pnpm test:run`** — this repo has produced six false failure reports from exactly that, one of which blocked a legitimate release. Run them one after the other.

- [ ] **Step 8: Commit**

```bash
git add src/core/types/parser.ts src/core/parsers/ tests/unit/core/drift/base-parser-drift.test.ts
git commit -m "feat: attach drift reports to ParseResult"
```

---

### Task 6: Regression fixtures for the three real 2026-07 cases

Each of the three drift cases the spec was built from becomes a fixture test. These are the tests that prove the net catches what it exists for.

**Files:**
- Test: `tests/unit/core/drift/known-drift-cases.test.ts`

**Interfaces:**
- Consumes: `checkSelectorHealth`, `checkOutputSanity` from `src/core/drift`; `CLAUDE_SELECTORS` from `src/core/parsers/claude/selectors`.
- Produces: nothing.

Fixtures are **invented markup that reproduces the structural shape**, never captured conversation text — the repo rule is that committed fixtures use invented prose.

- [ ] **Step 1: Write the test**

Create `tests/unit/core/drift/known-drift-cases.test.ts`:

```typescript
/**
 * The three real drift cases from 2026-07, as regressions. Markup is invented
 * to reproduce each structural shape; no captured conversation text is used.
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { checkSelectorHealth, checkOutputSanity } from '../../../../src/core/drift';
import type { SelectorSet, QAPair } from '../../../../src/core/types';

function docWith(html: string): Document {
  return new JSDOM(html).window.document;
}

function pair(question: string, answer: string): QAPair {
  return {
    index: 0,
    question: { id: 'q0', role: 'user', content: question, timestamp: new Date(0) },
    answer: { id: 'a0', role: 'assistant', content: answer, timestamp: new Date(0) },
  } as QAPair;
}

describe('known drift cases', () => {
  it('case 1 — Claude container class changed: required selector matches zero', () => {
    const selectors = {
      conversationContainer: 'div.overflow-y-scroll.pt-6.flex-1',
      messageElement: 'div[data-test-render-count]',
      userMessage: 'div[data-testid="user-message"]',
      assistantMessage: 'div[data-is-streaming="false"]',
      messageContent: 'div.standard-markdown',
    } satisfies SelectorSet;

    // The live markup switched `overflow-y-scroll` to `overflow-y-auto`.
    const doc = docWith('<div class="overflow-y-auto pt-6 flex-1"></div>');
    const findings = checkSelectorHealth(doc, selectors, ['conversationContainer']);
    const container = findings.find((f) => f.key === 'conversationContainer');
    expect(container?.matched).toBe(0);
    expect(container?.required).toBe(true);
  });

  it('case 2 — Gemini title selector dead: recorded, and required when declared so', () => {
    const selectors = {
      conversationContainer: 'main',
      messageElement: '.turn',
      userMessage: '.turn.user',
      assistantMessage: '.turn.model',
      messageContent: '.content',
      conversationTitle: '.conversation-title-that-no-longer-exists',
    } satisfies SelectorSet;

    const doc = docWith('<main><div class="turn user"><p class="content">q</p></div></main>');
    const findings = checkSelectorHealth(doc, selectors, ['conversationTitle']);
    expect(findings.find((f) => f.key === 'conversationTitle')?.matched).toBe(0);
  });

  it('case 3 — ChatGPT Deep Research: parse succeeds, output is the UI label', () => {
    // The turn held a long report; the extractor returned the sr-only label.
    const turnChars = 529;
    const findings = checkOutputSanity({
      pairs: [pair('Research the market for widgets', 'ChatGPT said:')],
      turnCount: 2,
      turnTextLengths: [turnChars],
      chromeStrings: ['ChatGPT said:', 'You said:'],
    });
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain('chrome-as-content');
    expect(rules).toContain('content-shortfall');
  });

  it('an absent optional widget is not drift', () => {
    const selectors = {
      conversationContainer: 'main',
      messageElement: '.turn',
      userMessage: '.turn.user',
      assistantMessage: '.turn.model',
      messageContent: '.content',
      custom: { webSearchContainer: '.web-search' },
    } satisfies SelectorSet;

    const doc = docWith('<main><div class="turn user"><p class="content">q</p></div></main>');
    const findings = checkSelectorHealth(doc, selectors, ['conversationContainer']);
    const widget = findings.find((f) => f.key === 'custom.webSearchContainer');
    expect(widget?.matched).toBe(0);
    expect(widget?.required).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run tests/unit/core/drift/known-drift-cases.test.ts`
Expected: PASS (4 tests). These exercise code written in Tasks 2-3, so they should pass immediately — if any fails, the rule semantics in Task 3 are wrong and must be fixed there, not here.

- [ ] **Step 3: Run the full validation**

Run: `pnpm validate`
Expected: clean (lint, format, typecheck, tests).

- [ ] **Step 4: Commit**

```bash
git add tests/unit/core/drift/known-drift-cases.test.ts
git commit -m "test: add regressions for the three known 2026-07 drift cases"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| Unit 1 `SelectorHealth`, required vs optional | Task 2 |
| Unit 2 `OutputSanity`, all five rules | Task 3 |
| Unit 3 `SkeletonBuilder`, safelist, bounds, elision | Task 4 |
| Unit 4 `DriftReport` assembly + fingerprint | Tasks 1, 5 |
| `ParseResult.drift` | Task 5 |
| Leak property test | Task 4, Step 1 |
| Three real cases as fixtures | Task 6 |
| Healthy conversation → no finding | Task 3 (Step 1) and Task 5 (Step 1) |
| Absent optional widget → no finding | Task 6 |
| Fingerprint stability / divergence | Task 1 |
| Throwing detector still exports | Task 5 |
| Build target, not user agent | Task 5 |
| Error handling: best-effort everywhere | Task 5 (`detectDrift` guard), Tasks 2/4 (internal `try`) |

**Deferred to the popup-surfaces plan** (by the spec's own sequencing): the amber row, the `report` view, Copy / Copy & report, suppression storage, i18n keys, and plumbing `drift` from the content script to the popup.

**Known spec correction carried into plan 2:** the spec's data-flow diagram shows `SkeletonBuilder` running lazily when the user opens the report view. The popup has no access to the page DOM, so the skeleton cannot literally be built there — plan 2 resolves this with a `GET_DRIFT_SKELETON` message answered by the content script. `buildSkeleton` is exported from `src/core/drift` in Task 4 for that consumer; nothing in this plan calls it at parse time, which preserves the spec's intent that a user who never opens the report never has a skeleton built.
