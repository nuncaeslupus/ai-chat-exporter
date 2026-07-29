# Selector-Drift Popup Surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** `docs/superpowers/plans/2026-07-29-selector-drift-detection-core.md` must be complete and merged. This plan consumes `ParseResult.drift` and `buildSkeleton` from `src/core/drift`.

**Goal:** Surface a drift report in the popup as a non-blocking amber row, let the user read the exact bytes that would be shared, and let them copy it — with the extension transmitting nothing.

**Architecture:** The content script answers a new `GET_DRIFT_SKELETON` message by re-detecting the parser and building the skeleton on demand; the popup gains a fifth view (`report`) that the existing delegated router picks up for free, and a suppression map in `chrome.storage.local` keyed by fingerprint.

**Tech Stack:** TypeScript (strict), Vitest + jsdom, `chrome.storage.local`, `navigator.clipboard`. No new dependencies.

## Global Constraints

- **The extension transmits nothing.** Both actions are clipboard writes; "Copy & report" additionally opens the tracker in a tab. There is no `fetch`, no relay, no server. `docs/PRIVACY.md` must remain accurate unchanged — do not edit it.
- **The preview is byte-identical to what is copied.** Not a summary of it. This is what makes "you can see nothing else is sent" verifiable rather than a promise. The same string must feed the `<pre>` and the clipboard.
- **The report body is English only**, regardless of UI locale — it is a bug report read by one maintainer. Only the surrounding UI chrome is localized.
- **No modal, no auto-opened tab, no blocked export.** Drift is frequent enough that anything demanding attention trains users to dismiss it.
- **All new user-facing strings go through `getMessage()`** with keys added to **all seven** locale bundles (`en, es, ca, fr, de, it, pt`). `tests/unit/extension/locales.test.ts` enforces parity and will fail otherwise.
- **Do not run `pnpm build` concurrently with `pnpm test:run`** — this repo has produced six false failure reports from exactly that.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/drift/format-report.ts` | Create: renders a `DriftReport` + skeleton into the one English string that is both previewed and copied |
| `src/shared/constants.ts` | Modify: add `GET_DRIFT_SKELETON` to `MESSAGE_TYPES` |
| `src/shared/messages.ts` | Modify: add the message type guard and response shape |
| `src/extension/content/content-script.ts` | Modify: return `drift` from `GET_CONVERSATION`; answer `GET_DRIFT_SKELETON` |
| `src/extension/popup/popup.html` | Modify: amber drift row in the ready view, `#view-report` section |
| `src/extension/popup/popup.css` | Modify: drift row + report view styles |
| `src/extension/popup/popup.ts` | Modify: `'report'` view, drift state, copy actions, suppression |
| `src/core/drift/suppression.ts` | Create: read/write the dismissed-fingerprint map |
| `_locales/*/messages.json` | Modify: 11 new keys × 7 bundles |

---

### Task 1: Report formatting

The one string the user sees and copies. Written first because everything downstream consumes it, and because "preview is byte-identical to the clipboard" is only enforceable if a single function produces it.

**Files:**
- Create: `src/core/drift/format-report.ts`
- Modify: `src/core/drift/index.ts` (re-export)
- Test: `tests/unit/core/drift/format-report.test.ts`

**Interfaces:**
- Consumes: `DriftReport` from `src/core/drift/types`.
- Produces: `function formatDriftReport(report: DriftReport, skeleton: string | null, pageUrlOrigin: string): string`
  - `pageUrlOrigin` is the **origin only** (`https://chatgpt.com`), never the full URL — a conversation URL contains a conversation id.
  - `skeleton` of `null` renders `(not available)` rather than omitting the section, so the shape of the report is constant.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/drift/format-report.test.ts`:

```typescript
/**
 * The report text. It is simultaneously the preview and the clipboard payload,
 * so its content-free-ness is user-verifiable: what they read is what they send.
 */
import { describe, it, expect } from 'vitest';
import { formatDriftReport } from '../../../../src/core/drift/format-report';
import type { DriftReport } from '../../../../src/core/drift/types';

const report: DriftReport = {
  fingerprint: 'a1b2c3d4',
  platform: 'chatgpt',
  extensionVersion: '1.2.0',
  buildTarget: 'chrome',
  detectedAt: '2026-07-29',
  selectorFindings: [
    { key: 'messageContent', selector: '.markdown.prose', matched: 0, required: true },
    { key: 'messageElement', selector: '[data-turn]', matched: 6, required: true },
    { key: 'custom.webSearch', selector: '.web-search', matched: 0, required: false },
  ],
  sanityFindings: [{ rule: 'content-shortfall', detail: 'pair 0: extracted 13 of 529 chars' }],
};

describe('formatDriftReport', () => {
  it('leads with the fingerprint so duplicates collapse in a tracker', () => {
    expect(formatDriftReport(report, null, 'https://chatgpt.com')).toMatch(/^drift a1b2c3d4/m);
  });

  it('lists only the failing required selectors under "not matching"', () => {
    const text = formatDriftReport(report, null, 'https://chatgpt.com');
    expect(text).toContain('messageContent');
    expect(text).toContain('.markdown.prose');
    // A required selector that DID match is not a failure and must not be listed
    // as one; a zero-match optional selector is not a failure either.
    const failing = text.split('not matching:')[1]?.split('\n\n')[0] ?? '';
    expect(failing).not.toContain('messageElement');
    expect(failing).not.toContain('custom.webSearch');
  });

  it('lists the sanity rules that fired', () => {
    const text = formatDriftReport(report, null, 'https://chatgpt.com');
    expect(text).toContain('content-shortfall');
    expect(text).toContain('extracted 13 of 529 chars');
  });

  it('includes the build identity but never a user agent', () => {
    const text = formatDriftReport(report, null, 'https://chatgpt.com');
    expect(text).toContain('1.2.0');
    expect(text).toContain('chrome');
    expect(text).not.toMatch(/Mozilla|AppleWebKit/);
  });

  it('carries the origin only, never a full conversation URL', () => {
    const text = formatDriftReport(report, null, 'https://chatgpt.com');
    expect(text).toContain('https://chatgpt.com');
    expect(text).not.toContain('/c/');
  });

  it('renders the skeleton when present', () => {
    const text = formatDriftReport(report, 'main#main\n  div[data-turn="user"]', 'https://chatgpt.com');
    expect(text).toContain('div[data-turn="user"]');
  });

  it('says so explicitly when the skeleton is unavailable', () => {
    expect(formatDriftReport(report, null, 'https://chatgpt.com')).toContain('(not available)');
  });

  it('is English regardless of UI locale', () => {
    // No getMessage() call anywhere in the module — the report has one reader.
    const text = formatDriftReport(report, null, 'https://chatgpt.com');
    expect(text).toContain('page structure report');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/drift/format-report.test.ts`
Expected: FAIL — cannot resolve `src/core/drift/format-report`.

- [ ] **Step 3: Write the implementation**

Create `src/core/drift/format-report.ts`:

```typescript
/**
 * Renders a drift report into the single string that is both shown in the
 * preview and written to the clipboard.
 *
 * One function on purpose: "the preview is byte-identical to what is copied"
 * is only enforceable while there is exactly one place the text is produced.
 *
 * Deliberately English-only and free of `getMessage()`. This is a bug report
 * with one reader; a localised payload would be worse for that reader.
 */

import type { DriftReport } from './types';

export function formatDriftReport(
  report: DriftReport,
  skeleton: string | null,
  pageUrlOrigin: string
): string {
  const failing = report.selectorFindings.filter((f) => f.required && f.matched <= 0);

  const lines: string[] = [
    `drift ${report.fingerprint} — ${report.platform} page structure report`,
    '',
    `platform:  ${report.platform}`,
    `origin:    ${pageUrlOrigin}`,
    `version:   ${report.extensionVersion} (${report.buildTarget})`,
    `detected:  ${report.detectedAt}`,
    '',
    'Selectors not matching:',
  ];

  if (failing.length === 0) {
    lines.push('  (none — every required selector matched)');
  } else {
    for (const finding of failing) {
      const count = finding.matched < 0 ? 'invalid selector' : '0 matches';
      lines.push(`  ${finding.key}: ${finding.selector}  → ${count}`);
    }
  }

  lines.push('', 'Output checks that failed:');
  if (report.sanityFindings.length === 0) {
    lines.push('  (none)');
  } else {
    for (const finding of report.sanityFindings) {
      lines.push(`  ${finding.rule}: ${finding.detail}`);
    }
  }

  lines.push(
    '',
    'Page structure (tag names, classes and attribute names only —',
    'every text node is replaced by its character count):',
    ''
  );
  lines.push(skeleton && skeleton.length > 0 ? skeleton : '  (not available)');

  return lines.join('\n');
}
```

- [ ] **Step 4: Re-export it**

In `src/core/drift/index.ts`, add:

```typescript
export { formatDriftReport } from './format-report';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/drift/format-report.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/drift/format-report.ts src/core/drift/index.ts tests/unit/core/drift/format-report.test.ts
git commit -m "feat: render drift reports into the previewed and copied text"
```

---

### Task 2: Plumb drift from the content script to the popup

**This task resolves a gap in the spec.** The spec's data-flow diagram shows `SkeletonBuilder` running lazily "when the user opens the report view". The popup has no access to the page's DOM — it runs in its own document — so the skeleton cannot literally be built there. It is built in the content script, on demand, in response to a new message. The spec's *intent* is preserved exactly: nothing is built until the user opens the report view.

**Files:**
- Modify: `src/shared/constants.ts:20-27` (`MESSAGE_TYPES`)
- Modify: `src/shared/messages.ts`
- Modify: `src/extension/content/content-script.ts:74-97` and `:691-720`
- Test: `tests/unit/extension/content/drift-messages.test.ts`

**Interfaces:**
- Consumes: `buildSkeleton`, `DriftReport` from `src/core/drift`.
- Produces:
  - `MESSAGE_TYPES.GET_DRIFT_SKELETON = 'get_drift_skeleton'`
  - `interface GetDriftSkeletonMessage { type: 'get_drift_skeleton' }`
  - `function isGetDriftSkeletonMessage(message: unknown): message is GetDriftSkeletonMessage`
  - `GET_CONVERSATION` response gains `drift?: DriftReport` alongside its existing `data`.
  - `GET_DRIFT_SKELETON` response: `{ success: true; skeleton: string; origin: string }` or `{ success: false; error: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/extension/content/drift-messages.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/extension/content/drift-messages.test.ts`
Expected: FAIL — `MESSAGE_TYPES.GET_DRIFT_SKELETON` is undefined and `isGetDriftSkeletonMessage` is not exported.

- [ ] **Step 3: Add the message type**

In `src/shared/constants.ts`, inside `MESSAGE_TYPES`, after `GET_CONVERSATION`:

```typescript
  GET_DRIFT_SKELETON: 'get_drift_skeleton',
```

In `src/shared/messages.ts`, add alongside the existing guards (match the file's existing guard style):

```typescript
/**
 * The popup asking the content script for a structural skeleton of the current
 * page. Built on demand: a user who never opens the report view never has one.
 */
export interface GetDriftSkeletonMessage {
  type: typeof MESSAGE_TYPES.GET_DRIFT_SKELETON;
}

export function isGetDriftSkeletonMessage(message: unknown): message is GetDriftSkeletonMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === MESSAGE_TYPES.GET_DRIFT_SKELETON
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/extension/content/drift-messages.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Return `drift` from `GET_CONVERSATION`**

In `src/extension/content/content-script.ts`, change `parseConversation()` to keep the last drift report. Replace the field declaration at line 48 and the method at lines 74-97:

```typescript
  private conversation: Conversation | null = null;
  /** Drift from the most recent parse. Content-free; see `src/core/drift`. */
  private drift: DriftReport | undefined;
  private initialized = false;
```

and inside `parseConversation()`, after `const parseResult = parser.parse();`:

```typescript
    this.drift = parseResult.drift;
```

Add the accessor next to `getConversation()`:

```typescript
  getDrift(): DriftReport | undefined {
    return this.drift;
  }
```

Then in the `onMessage` listener, extend the `GET_CONVERSATION` branch (currently lines 694-701):

```typescript
      if (isGetConversationMessage(message)) {
        // Re-parse conversation to get latest content
        await contentScript.initialize();
        const conversation = contentScript.getConversation();
        const drift = contentScript.getDrift();
        sendResponse({
          success: true,
          data: conversation,
          ...(drift && { drift }),
        });
      }
```

- [ ] **Step 6: Answer `GET_DRIFT_SKELETON`**

Add a branch to the same listener, before the final `else`:

```typescript
      } else if (isGetDriftSkeletonMessage(message)) {
        // Built here and only here: the popup has no access to the page DOM,
        // and building it lazily means a user who never opens the report view
        // never has one in memory.
        const parser = detectParser();
        const container = parser
          ? document.querySelector(parser.selectors.conversationContainer)
          : null;
        // Falling back to <body> is deliberate: when canParse() is false, the
        // container selector is exactly what we know least about.
        const root = container ?? document.body;
        sendResponse({
          success: true,
          skeleton: buildSkeleton(root),
          origin: window.location.origin,
        });
```

Add the imports at the top of the file:

```typescript
import { buildSkeleton, type DriftReport } from '../../core/drift';
import { isGetDriftSkeletonMessage } from '../../shared/messages';
```

- [ ] **Step 7: Run the suite and typecheck**

Run: `pnpm test:run`, then `pnpm typecheck`.
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add src/shared/constants.ts src/shared/messages.ts src/extension/content/content-script.ts tests/unit/extension/content/drift-messages.test.ts
git commit -m "feat: plumb drift reports and on-demand skeletons to the popup"
```

---

### Task 3: Suppression store

**Files:**
- Create: `src/core/drift/suppression.ts`
- Test: `tests/unit/core/drift/suppression.test.ts`

**Interfaces:**
- Produces:
  - `const DRIFT_SUPPRESSION_KEY = 'drift_suppressed_fingerprints'`
  - `async function isDriftSuppressed(fingerprint: string): Promise<boolean>`
  - `async function suppressDrift(fingerprint: string): Promise<void>`
  - Storage shape: `Record<string, true>`. A missing `chrome.storage` resolves to "not suppressed" rather than throwing — the safety net must never break the popup.

Because the fingerprint already contains the extension version, shipping a fix automatically restores the prompt with no migration and no cleanup job.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/drift/suppression.test.ts`:

```typescript
/**
 * Suppression: a fingerprint the user has dismissed or copied is not raised
 * again. The fingerprint embeds the extension version, so shipping a fix
 * restores the prompt with no migration.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DRIFT_SUPPRESSION_KEY,
  isDriftSuppressed,
  suppressDrift,
} from '../../../../src/core/drift/suppression';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: (key: string) => Promise.resolve({ [key]: store[key] }),
        set: (items: Record<string, unknown>) => {
          Object.assign(store, items);
          return Promise.resolve();
        },
      },
    },
  });
});

describe('drift suppression', () => {
  it('reports an unknown fingerprint as not suppressed', async () => {
    await expect(isDriftSuppressed('abc123')).resolves.toBe(false);
  });

  it('suppresses a fingerprint once recorded', async () => {
    await suppressDrift('abc123');
    await expect(isDriftSuppressed('abc123')).resolves.toBe(true);
  });

  it('suppresses only that fingerprint', async () => {
    await suppressDrift('abc123');
    await expect(isDriftSuppressed('def456')).resolves.toBe(false);
  });

  it('keeps earlier fingerprints when a new one is added', async () => {
    await suppressDrift('abc123');
    await suppressDrift('def456');
    await expect(isDriftSuppressed('abc123')).resolves.toBe(true);
    expect(store[DRIFT_SUPPRESSION_KEY]).toEqual({ abc123: true, def456: true });
  });

  it('resolves to not-suppressed when storage is unavailable', async () => {
    vi.stubGlobal('chrome', {});
    await expect(isDriftSuppressed('abc123')).resolves.toBe(false);
    await expect(suppressDrift('abc123')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/core/drift/suppression.test.ts`
Expected: FAIL — cannot resolve `src/core/drift/suppression`.

- [ ] **Step 3: Write the implementation**

Create `src/core/drift/suppression.ts`:

```typescript
/**
 * Which drift fingerprints the user has already dealt with.
 *
 * No migration or cleanup job is needed: the fingerprint already contains the
 * extension version, so shipping a fix produces a new fingerprint and the
 * prompt returns on its own.
 */

export const DRIFT_SUPPRESSION_KEY = 'drift_suppressed_fingerprints';

type SuppressionMap = Record<string, true>;

async function read(): Promise<SuppressionMap> {
  try {
    const result = await chrome.storage.local.get(DRIFT_SUPPRESSION_KEY);
    const map = result?.[DRIFT_SUPPRESSION_KEY];
    return typeof map === 'object' && map !== null ? (map as SuppressionMap) : {};
  } catch {
    // No storage permission, no chrome global (tests), quota error: treat as
    // "nothing suppressed". The safety net must never break the popup.
    return {};
  }
}

export async function isDriftSuppressed(fingerprint: string): Promise<boolean> {
  return (await read())[fingerprint] === true;
}

export async function suppressDrift(fingerprint: string): Promise<void> {
  try {
    const map = await read();
    map[fingerprint] = true;
    await chrome.storage.local.set({ [DRIFT_SUPPRESSION_KEY]: map });
  } catch {
    // Failing to remember a dismissal only means the row reappears next time.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/core/drift/suppression.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/drift/suppression.ts tests/unit/core/drift/suppression.test.ts
git commit -m "feat: suppress drift prompts per fingerprint"
```

---

### Task 4: Locale keys

Done before the UI so the UI can reference real keys, and so `locales.test.ts` never sees a half-populated bundle.

**Files:**
- Modify: `_locales/en/messages.json`, `_locales/es/messages.json`, `_locales/ca/messages.json`, `_locales/fr/messages.json`, `_locales/de/messages.json`, `_locales/it/messages.json`, `_locales/pt/messages.json`

**Interfaces:**
- Produces the 11 keys the popup consumes in Task 5 and Task 6.

- [ ] **Step 1: Add the keys to `_locales/en/messages.json`**

```json
  "driftRowTitle": {
    "message": "This page may have changed",
    "description": "Amber row shown when the page structure no longer matches what the parser expects"
  },
  "driftRowDetail": {
    "message": "Your export may be incomplete.",
    "description": "Second line of the drift row"
  },
  "driftRowAction": {
    "message": "See what happened",
    "description": "Opens the drift report view"
  },
  "driftReportTitle": {
    "message": "Page structure report",
    "description": "Title of the drift report view"
  },
  "driftReportIntro": {
    "message": "This is the whole report. It has no part of your conversation in it — every piece of text is replaced by how many characters it had. Nothing is sent anywhere unless you choose to share it.",
    "description": "Explains the report preview above the text"
  },
  "driftReportCopy": {
    "message": "Copy report",
    "description": "Copies the report to the clipboard and stays in the popup"
  },
  "driftReportCopyAndReport": {
    "message": "Copy & report",
    "description": "Copies the report, then opens the issue tracker"
  },
  "driftReportCopied": {
    "message": "Copied",
    "description": "Inline confirmation after a successful copy"
  },
  "driftReportCopyFailed": {
    "message": "Couldn't copy — select the text above",
    "description": "Shown when the clipboard write fails"
  },
  "driftReportDismiss": {
    "message": "Don't show this again",
    "description": "Suppresses this drift fingerprint"
  },
  "driftReportLoading": {
    "message": "Reading the page structure…",
    "description": "Shown while the content script builds the skeleton"
  }
```

- [ ] **Step 2: Add translations to the other six bundles**

Spanish (`_locales/es/messages.json`):

```json
  "driftRowTitle": { "message": "Puede que esta página haya cambiado", "description": "Amber row shown when the page structure no longer matches what the parser expects" },
  "driftRowDetail": { "message": "Puede que la exportación esté incompleta.", "description": "Second line of the drift row" },
  "driftRowAction": { "message": "Ver qué ha pasado", "description": "Opens the drift report view" },
  "driftReportTitle": { "message": "Informe de estructura de la página", "description": "Title of the drift report view" },
  "driftReportIntro": { "message": "Este es el informe completo. No contiene ninguna parte de tu conversación: cada texto se sustituye por el número de caracteres que tenía. No se envía nada a ningún sitio salvo que decidas compartirlo.", "description": "Explains the report preview above the text" },
  "driftReportCopy": { "message": "Copiar informe", "description": "Copies the report to the clipboard and stays in the popup" },
  "driftReportCopyAndReport": { "message": "Copiar y notificar", "description": "Copies the report, then opens the issue tracker" },
  "driftReportCopied": { "message": "Copiado", "description": "Inline confirmation after a successful copy" },
  "driftReportCopyFailed": { "message": "No se pudo copiar: selecciona el texto de arriba", "description": "Shown when the clipboard write fails" },
  "driftReportDismiss": { "message": "No volver a mostrar", "description": "Suppresses this drift fingerprint" },
  "driftReportLoading": { "message": "Leyendo la estructura de la página…", "description": "Shown while the content script builds the skeleton" }
```

Catalan (`_locales/ca/messages.json`):

```json
  "driftRowTitle": { "message": "Potser aquesta pàgina ha canviat", "description": "Amber row shown when the page structure no longer matches what the parser expects" },
  "driftRowDetail": { "message": "Pot ser que l'exportació sigui incompleta.", "description": "Second line of the drift row" },
  "driftRowAction": { "message": "Mira què ha passat", "description": "Opens the drift report view" },
  "driftReportTitle": { "message": "Informe d'estructura de la pàgina", "description": "Title of the drift report view" },
  "driftReportIntro": { "message": "Aquest és l'informe complet. No conté cap part de la teva conversa: cada text se substitueix pel nombre de caràcters que tenia. No s'envia res enlloc si no decideixes compartir-ho.", "description": "Explains the report preview above the text" },
  "driftReportCopy": { "message": "Copia l'informe", "description": "Copies the report to the clipboard and stays in the popup" },
  "driftReportCopyAndReport": { "message": "Copia i notifica", "description": "Copies the report, then opens the issue tracker" },
  "driftReportCopied": { "message": "Copiat", "description": "Inline confirmation after a successful copy" },
  "driftReportCopyFailed": { "message": "No s'ha pogut copiar: selecciona el text de dalt", "description": "Shown when the clipboard write fails" },
  "driftReportDismiss": { "message": "No ho tornis a mostrar", "description": "Suppresses this drift fingerprint" },
  "driftReportLoading": { "message": "S'està llegint l'estructura de la pàgina…", "description": "Shown while the content script builds the skeleton" }
```

French (`_locales/fr/messages.json`):

```json
  "driftRowTitle": { "message": "Cette page a peut-être changé", "description": "Amber row shown when the page structure no longer matches what the parser expects" },
  "driftRowDetail": { "message": "Votre export est peut-être incomplet.", "description": "Second line of the drift row" },
  "driftRowAction": { "message": "Voir ce qui s'est passé", "description": "Opens the drift report view" },
  "driftReportTitle": { "message": "Rapport de structure de page", "description": "Title of the drift report view" },
  "driftReportIntro": { "message": "Voici le rapport complet. Il ne contient aucune partie de votre conversation : chaque texte est remplacé par son nombre de caractères. Rien n'est envoyé nulle part à moins que vous ne choisissiez de le partager.", "description": "Explains the report preview above the text" },
  "driftReportCopy": { "message": "Copier le rapport", "description": "Copies the report to the clipboard and stays in the popup" },
  "driftReportCopyAndReport": { "message": "Copier et signaler", "description": "Copies the report, then opens the issue tracker" },
  "driftReportCopied": { "message": "Copié", "description": "Inline confirmation after a successful copy" },
  "driftReportCopyFailed": { "message": "Copie impossible — sélectionnez le texte ci-dessus", "description": "Shown when the clipboard write fails" },
  "driftReportDismiss": { "message": "Ne plus afficher", "description": "Suppresses this drift fingerprint" },
  "driftReportLoading": { "message": "Lecture de la structure de la page…", "description": "Shown while the content script builds the skeleton" }
```

German (`_locales/de/messages.json`):

```json
  "driftRowTitle": { "message": "Diese Seite hat sich möglicherweise geändert", "description": "Amber row shown when the page structure no longer matches what the parser expects" },
  "driftRowDetail": { "message": "Der Export ist möglicherweise unvollständig.", "description": "Second line of the drift row" },
  "driftRowAction": { "message": "Ansehen, was passiert ist", "description": "Opens the drift report view" },
  "driftReportTitle": { "message": "Bericht zur Seitenstruktur", "description": "Title of the drift report view" },
  "driftReportIntro": { "message": "Das ist der vollständige Bericht. Er enthält keinen Teil deiner Unterhaltung — jeder Text ist durch seine Zeichenanzahl ersetzt. Es wird nichts gesendet, solange du es nicht selbst teilst.", "description": "Explains the report preview above the text" },
  "driftReportCopy": { "message": "Bericht kopieren", "description": "Copies the report to the clipboard and stays in the popup" },
  "driftReportCopyAndReport": { "message": "Kopieren & melden", "description": "Copies the report, then opens the issue tracker" },
  "driftReportCopied": { "message": "Kopiert", "description": "Inline confirmation after a successful copy" },
  "driftReportCopyFailed": { "message": "Kopieren fehlgeschlagen — markiere den Text oben", "description": "Shown when the clipboard write fails" },
  "driftReportDismiss": { "message": "Nicht mehr anzeigen", "description": "Suppresses this drift fingerprint" },
  "driftReportLoading": { "message": "Seitenstruktur wird gelesen…", "description": "Shown while the content script builds the skeleton" }
```

Italian (`_locales/it/messages.json`):

```json
  "driftRowTitle": { "message": "Questa pagina potrebbe essere cambiata", "description": "Amber row shown when the page structure no longer matches what the parser expects" },
  "driftRowDetail": { "message": "L'esportazione potrebbe essere incompleta.", "description": "Second line of the drift row" },
  "driftRowAction": { "message": "Vedi cosa è successo", "description": "Opens the drift report view" },
  "driftReportTitle": { "message": "Report sulla struttura della pagina", "description": "Title of the drift report view" },
  "driftReportIntro": { "message": "Questo è il report completo. Non contiene alcuna parte della tua conversazione: ogni testo è sostituito dal numero di caratteri che conteneva. Non viene inviato nulla a nessuno se non scegli di condividerlo.", "description": "Explains the report preview above the text" },
  "driftReportCopy": { "message": "Copia il report", "description": "Copies the report to the clipboard and stays in the popup" },
  "driftReportCopyAndReport": { "message": "Copia e segnala", "description": "Copies the report, then opens the issue tracker" },
  "driftReportCopied": { "message": "Copiato", "description": "Inline confirmation after a successful copy" },
  "driftReportCopyFailed": { "message": "Impossibile copiare: seleziona il testo qui sopra", "description": "Shown when the clipboard write fails" },
  "driftReportDismiss": { "message": "Non mostrare più", "description": "Suppresses this drift fingerprint" },
  "driftReportLoading": { "message": "Lettura della struttura della pagina…", "description": "Shown while the content script builds the skeleton" }
```

Portuguese (`_locales/pt/messages.json`):

```json
  "driftRowTitle": { "message": "Esta página pode ter mudado", "description": "Amber row shown when the page structure no longer matches what the parser expects" },
  "driftRowDetail": { "message": "A exportação pode estar incompleta.", "description": "Second line of the drift row" },
  "driftRowAction": { "message": "Ver o que aconteceu", "description": "Opens the drift report view" },
  "driftReportTitle": { "message": "Relatório da estrutura da página", "description": "Title of the drift report view" },
  "driftReportIntro": { "message": "Este é o relatório completo. Não contém nenhuma parte da sua conversa: cada texto é substituído pelo número de caracteres que tinha. Nada é enviado para lado nenhum a não ser que decida partilhá-lo.", "description": "Explains the report preview above the text" },
  "driftReportCopy": { "message": "Copiar relatório", "description": "Copies the report to the clipboard and stays in the popup" },
  "driftReportCopyAndReport": { "message": "Copiar e reportar", "description": "Copies the report, then opens the issue tracker" },
  "driftReportCopied": { "message": "Copiado", "description": "Inline confirmation after a successful copy" },
  "driftReportCopyFailed": { "message": "Não foi possível copiar — selecione o texto acima", "description": "Shown when the clipboard write fails" },
  "driftReportDismiss": { "message": "Não mostrar novamente", "description": "Suppresses this drift fingerprint" },
  "driftReportLoading": { "message": "A ler a estrutura da página…", "description": "Shown while the content script builds the skeleton" }
```

- [ ] **Step 3: Run the parity test**

Run: `pnpm vitest run tests/unit/extension/locales.test.ts`
Expected: PASS — all seven bundles carry the same key set.

- [ ] **Step 4: Commit**

```bash
git add _locales/
git commit -m "i18n: add drift report strings in all seven locales"
```

---

### Task 5: The `report` view

**Files:**
- Modify: `src/extension/popup/popup.html` (add `#view-report` after `#view-options`)
- Modify: `src/extension/popup/popup.css`
- Modify: `src/extension/popup/popup.ts:37` (`VIEWS`)
- Test: `tests/unit/extension/popup/drift-report-view.test.ts`

**Interfaces:**
- Consumes: `formatDriftReport` (Task 1), `MESSAGE_TYPES.GET_DRIFT_SKELETON` (Task 2), the locale keys (Task 4).
- Produces, on the popup controller:
  - `private drift: DriftReport | undefined`
  - `private reportText: string | null` — the exact string in the `<pre>` and on the clipboard
  - `private async openReportView(): Promise<void>`

Adding `'report'` to `VIEWS` is the whole router change — navigation is delegated on `[data-nav]`, so a `data-nav="report"` button needs no wiring.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/extension/popup/drift-report-view.test.ts`:

```typescript
/**
 * The report view. The assertion that matters is the last one: the text in the
 * preview and the text on the clipboard are the same string, because that is
 * what makes "you can see nothing else is sent" verifiable.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';

const html = readFileSync(join(process.cwd(), 'src/extension/popup/popup.html'), 'utf-8');

describe('report view markup', () => {
  let doc: Document;

  beforeEach(() => {
    doc = new JSDOM(html).window.document;
  });

  it('declares a report view section', () => {
    expect(doc.getElementById('view-report')).not.toBeNull();
  });

  it('starts hidden like every other submenu', () => {
    expect(doc.getElementById('view-report')?.hasAttribute('hidden')).toBe(true);
  });

  it('is reachable from the drift row through the delegated router', () => {
    const trigger = doc.querySelector('[data-nav="report"]');
    expect(trigger).not.toBeNull();
  });

  it('has a back button to main', () => {
    const back = doc.querySelector('#view-report [data-nav="main"]');
    expect(back).not.toBeNull();
  });

  it('has a preview element, a copy button and a copy-and-report button', () => {
    expect(doc.getElementById('drift-report-preview')).not.toBeNull();
    expect(doc.getElementById('drift-report-copy')).not.toBeNull();
    expect(doc.getElementById('drift-report-copy-and-report')).not.toBeNull();
  });

  it('states the privacy guarantee above the preview', () => {
    const intro = doc.querySelector('[data-i18n="driftReportIntro"]');
    expect(intro).not.toBeNull();
  });

  it('carries a drift row in the main view', () => {
    expect(doc.getElementById('drift-row')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/extension/popup/drift-report-view.test.ts`
Expected: FAIL — none of those elements exist.

- [ ] **Step 3: Add the drift row to the main view**

In `src/extension/popup/popup.html`, inside `<div id="main-content">`, immediately after the closing `</div>` of `#warning-card` (line 95):

```html
              <!--
                Selector drift. Non-blocking on purpose: a degraded export is
                usually still wanted, and anything demanding attention trains
                users to dismiss it. Hidden unless `data-drift="true"`.
              -->
              <button type="button" class="drift-row" id="drift-row" data-nav="report" hidden>
                <svg class="drift-row-icon" width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.4"/>
                  <path d="M8 4.8v3.6M8 10.9h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
                <span class="drift-row-body">
                  <span class="drift-row-title" data-i18n="driftRowTitle">This page may have changed</span>
                  <span class="drift-row-detail" data-i18n="driftRowDetail">Your export may be incomplete.</span>
                </span>
                <span class="drift-row-action" data-i18n="driftRowAction">See what happened</span>
              </button>
```

- [ ] **Step 4: Add the report view section**

In `src/extension/popup/popup.html`, after the closing `</section>` of `#view-options`:

```html
        <!--
          Page structure report. Same three bands as the pair chooser: fixed
          header, scrolling body, fixed footer. The preview is the exact string
          that goes to the clipboard — not a summary of it — which is what makes
          "nothing else is sent" something the user can check rather than trust.
        -->
        <section class="popup-view" id="view-report" hidden>
          <div class="submenu-header">
            <button type="button" class="submenu-back" data-nav="main" data-i18n-label="submenuBack">
              <svg width="7" height="11" viewBox="0 0 8 12" fill="none" aria-hidden="true">
                <path d="M6.5 1 1.5 6l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <h2 class="submenu-title" data-i18n="driftReportTitle">Page structure report</h2>
          </div>
          <div class="drift-report-body">
            <p class="drift-report-intro" data-i18n="driftReportIntro">
              This is the whole report. It has no part of your conversation in it — every piece of
              text is replaced by how many characters it had. Nothing is sent anywhere unless you
              choose to share it.
            </p>
            <pre class="drift-report-preview" id="drift-report-preview" tabindex="0"></pre>
          </div>
          <div class="submenu-footer drift-report-footer">
            <span class="drift-report-status" id="drift-report-status" role="status"></span>
            <button type="button" class="drift-report-secondary" id="drift-report-copy" data-i18n="driftReportCopy">
              Copy report
            </button>
            <button type="button" class="submenu-done" id="drift-report-copy-and-report" data-i18n="driftReportCopyAndReport">
              Copy &amp; report
            </button>
          </div>
        </section>
```

- [ ] **Step 5: Register the view**

In `src/extension/popup/popup.ts`, line 37:

```typescript
const VIEWS = ['main', 'content', 'options', 'filename', 'report'] as const;
```

and update the doc comment above it from "four views" to "five views".

- [ ] **Step 6: Add the styles**

Append to `src/extension/popup/popup.css`, following the file's existing custom-property conventions:

```css
/* --------------------------------------------------------------------------
   Selector drift: an amber row in the ready view, and the report view.
   Amber, not red: the export still happened and is usually still wanted.
   -------------------------------------------------------------------------- */

.drift-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  margin-bottom: 10px;
  text-align: left;
  border: 1px solid var(--warning-border);
  border-radius: 8px;
  background: var(--warning-bg);
  color: var(--warning-text);
  cursor: pointer;
}

.drift-row[hidden] {
  display: none;
}

.drift-row-icon {
  flex: none;
  margin-top: 1px;
}

.drift-row-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.drift-row-title {
  font-weight: 600;
}

.drift-row-detail {
  opacity: 0.85;
}

.drift-row-action {
  flex: none;
  align-self: center;
  text-decoration: underline;
}

.drift-report-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.drift-report-intro {
  margin: 0 0 10px;
  color: var(--text-secondary);
}

.drift-report-preview {
  margin: 0;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--surface-sunken);
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre;
  overflow-x: auto;
  user-select: text;
}

.drift-report-footer {
  gap: 8px;
}

.drift-report-status {
  flex: 1;
  min-width: 0;
  color: var(--text-secondary);
}
```

> If any custom property above (`--warning-bg`, `--warning-border`, `--warning-text`, `--border-subtle`, `--surface-sunken`, `--text-primary`, `--text-secondary`) does not exist in `popup.css`, use the nearest existing equivalent already used by `.warning-card` and `.submenu-footer` rather than inventing a new token. Check the `:root` block at the top of the file first.

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/extension/popup/drift-report-view.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 8: Commit**

```bash
git add src/extension/popup/popup.html src/extension/popup/popup.css src/extension/popup/popup.ts tests/unit/extension/popup/drift-report-view.test.ts
git commit -m "feat: add the drift report view and amber drift row"
```

---

### Task 6: Wire the popup behaviour

**Files:**
- Modify: `src/extension/popup/popup.ts`
- Test: `tests/unit/extension/popup/drift-behaviour.test.ts`

**Interfaces:**
- Consumes: `formatDriftReport`, `isDriftSuppressed`, `suppressDrift`, `MESSAGE_TYPES.GET_DRIFT_SKELETON`.
- Produces: no new exports; behaviour only.

**Behaviour contract:**

| Trigger | Effect |
| --- | --- |
| `GET_CONVERSATION` response carries `drift`, fingerprint not suppressed | `#drift-row` is unhidden in the ready view |
| fingerprint already suppressed | row stays hidden |
| `#drift-row` clicked | router switches to `report`; skeleton is requested **then**, not before |
| skeleton request in flight | status line shows `driftReportLoading` |
| skeleton request fails | report renders with `(not available)` — never an empty view |
| `#drift-report-copy` clicked | clipboard write; status shows `driftReportCopied`; **popup stays open**; fingerprint suppressed |
| `#drift-report-copy-and-report` clicked | clipboard write, then `chrome.tabs.create` on the tracker URL; fingerprint suppressed |
| clipboard write throws | status shows `driftReportCopyFailed`; the `<pre>` is selectable so the user can copy by hand |

- [ ] **Step 1: Write the failing test**

Create `tests/unit/extension/popup/drift-behaviour.test.ts`:

```typescript
/**
 * Drift behaviour in the popup. Follow the existing popup.test.ts harness for
 * loading popup.html into jsdom and stubbing `chrome`; this file only adds the
 * drift-specific expectations.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatDriftReport } from '../../../../src/core/drift/format-report';
import type { DriftReport } from '../../../../src/core/drift/types';

const report: DriftReport = {
  fingerprint: 'a1b2c3d4',
  platform: 'chatgpt',
  extensionVersion: '1.2.0',
  buildTarget: 'chrome',
  detectedAt: '2026-07-29',
  selectorFindings: [
    { key: 'messageContent', selector: '.markdown.prose', matched: 0, required: true },
  ],
  sanityFindings: [],
};

describe('drift report payload', () => {
  it('is one string, so the preview and the clipboard cannot diverge', () => {
    const skeleton = 'main#main\n  div[data-turn="user"]\n    text(12)';
    const a = formatDriftReport(report, skeleton, 'https://chatgpt.com');
    const b = formatDriftReport(report, skeleton, 'https://chatgpt.com');
    expect(a).toBe(b);
    expect(a).toContain(skeleton);
  });

  it('never contains conversation text, only character counts', () => {
    const skeleton = 'main#main\n  div[data-turn="user"]\n    text(12)';
    const text = formatDriftReport(report, skeleton, 'https://chatgpt.com');
    expect(text).toContain('text(12)');
    expect(text).not.toMatch(/[Ww]hat is the capital/);
  });
});

describe('drift row visibility', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.todo('unhides #drift-row when a response carries an unsuppressed drift report');
  it.todo('leaves #drift-row hidden when the fingerprint is suppressed');
  it.todo('requests the skeleton only when the report view opens');
  it.todo('keeps the popup open after Copy report');
  it.todo('shows driftReportCopyFailed when the clipboard write throws');
  it.todo('suppresses the fingerprint after either copy action');
});
```

> The `it.todo` entries are placeholders **only** until Step 3, where each is
> replaced with a real assertion against the harness in
> `tests/unit/extension/popup/popup.test.ts`. Do not commit this task with any
> `it.todo` remaining — read that file for its `chrome` stub and DOM bootstrap
> and write the six tests against it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/extension/popup/drift-behaviour.test.ts`
Expected: the two payload tests PASS (they exercise Task 1), the six `todo` entries report as pending.

- [ ] **Step 3: Replace every `it.todo` with a real test**

Read `tests/unit/extension/popup/popup.test.ts` for the existing bootstrap (how it loads `popup.html`, stubs `chrome.tabs`, `chrome.runtime` and `chrome.storage`, and instantiates the controller). Write the six tests against that same harness, asserting on:
`document.getElementById('drift-row')?.hidden`, the message type passed to the `chrome.tabs.sendMessage` stub, `document.getElementById('drift-report-preview')?.textContent`, the text of `#drift-report-status`, and the `chrome.storage.local.set` calls.

- [ ] **Step 4: Implement the behaviour in `popup.ts`**

Add the imports:

```typescript
import { formatDriftReport } from '../../core/drift/format-report';
import { isDriftSuppressed, suppressDrift } from '../../core/drift/suppression';
import type { DriftReport } from '../../core/drift/types';
```

Add the tracker URL constant near the other module-level constants:

```typescript
/**
 * Where "Copy & report" sends the user. The report is already on their
 * clipboard by then — they paste it wherever they prefer, so this is a
 * convenience, not a submission endpoint. The extension posts nothing.
 */
const ISSUE_TRACKER_URL = 'https://github.com/nuncaeslupus/ai-chat-exporter/issues/new';
```

Add the fields to the controller class:

```typescript
  private drift: DriftReport | undefined;
  /** The exact bytes shown in the preview and written to the clipboard. */
  private reportText: string | null = null;
  private pageOrigin = '';
```

In `checkCurrentPage()`, where the `GET_CONVERSATION` response is handled and the ready state is set, capture the drift and paint the row:

```typescript
    this.drift = result.response.drift;
    void this.renderDriftRow();
```

Add the methods:

```typescript
  /**
   * Show the amber row only for a fingerprint the user has not already dealt
   * with. Suppression is per fingerprint, and the fingerprint embeds the
   * extension version — so shipping a fix brings the prompt back by itself.
   */
  private async renderDriftRow(): Promise<void> {
    const row = document.getElementById('drift-row');
    if (!row) return;
    const drift = this.drift;
    row.hidden = !drift || (await isDriftSuppressed(drift.fingerprint));
  }

  /**
   * Build the report when the view opens, never before: a user who never opens
   * it never has a skeleton built for them.
   */
  private async openReportView(): Promise<void> {
    const preview = document.getElementById('drift-report-preview');
    const status = document.getElementById('drift-report-status');
    const drift = this.drift;
    if (!preview || !drift) return;

    this.setStatusText(status, getMessage('driftReportLoading'));
    const skeleton = await this.requestSkeleton();
    this.reportText = formatDriftReport(drift, skeleton.text, skeleton.origin || this.pageOrigin);
    preview.textContent = this.reportText;
    this.setStatusText(status, '');
  }

  /** Ask the content script for the page skeleton. A failure is not fatal. */
  private async requestSkeleton(): Promise<{ text: string | null; origin: string }> {
    const tabId = this.currentTabId;
    if (tabId === undefined) return { text: null, origin: '' };
    const result = await sendTabMessage<{ success: boolean; skeleton?: string; origin?: string }>(
      tabId,
      { type: MESSAGE_TYPES.GET_DRIFT_SKELETON }
    );
    if (!result.ok || !result.response.success) return { text: null, origin: '' };
    return { text: result.response.skeleton ?? null, origin: result.response.origin ?? '' };
  }

  private setStatusText(element: HTMLElement | null, text: string): void {
    if (element) element.textContent = text;
  }

  /**
   * Copy the report. The popup stays open — `navigator.clipboard.writeText`
   * runs here, so there is no reason to close it, and the confirmation lands
   * inline where the user is looking.
   */
  private async copyReport(): Promise<boolean> {
    const status = document.getElementById('drift-report-status');
    if (!this.reportText) return false;
    try {
      await navigator.clipboard.writeText(this.reportText);
      this.setStatusText(status, getMessage('driftReportCopied'));
      if (this.drift) await suppressDrift(this.drift.fingerprint);
      return true;
    } catch {
      // The <pre> is selectable, so failing to copy is recoverable by hand.
      this.setStatusText(status, getMessage('driftReportCopyFailed'));
      return false;
    }
  }
```

Wire the three handlers in `setupEventListeners()`:

```typescript
    document.getElementById('drift-row')?.addEventListener('click', () => {
      void this.openReportView();
    });

    document.getElementById('drift-report-copy')?.addEventListener('click', () => {
      void this.copyReport();
    });

    document
      .getElementById('drift-report-copy-and-report')
      ?.addEventListener('click', () => {
        void (async () => {
          await this.copyReport();
          // The popup closes when the tab opens. Acceptable: this is the final
          // step, and the payload is already on the clipboard.
          await chrome.tabs.create({ url: ISSUE_TRACKER_URL });
        })();
      });
```

> `#drift-row` also carries `data-nav="report"`, so the delegated router
> switches the view; this listener only fills it. Both fire on the same click,
> in DOM order — the view is already `report` by the time the fill resolves.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/extension/popup/`
Expected: PASS, with zero `todo` entries remaining.

- [ ] **Step 6: Run the full validation**

Run: `pnpm validate`
Expected: clean. Then, **separately**, run `pnpm build` and confirm it succeeds.

- [ ] **Step 7: Verify in the browser**

Load the unpacked build, open a supported chat page, and confirm by hand:
1. A healthy conversation shows **no** amber row.
2. The report view's preview text is monospace, scrolls horizontally inside its own box, and contains no conversation prose.
3. **Copy report** leaves the popup open and shows the inline confirmation.
4. Reopening the popup after a copy does **not** show the row again.

- [ ] **Step 8: Commit**

```bash
git add src/extension/popup/popup.ts tests/unit/extension/popup/drift-behaviour.test.ts
git commit -m "feat: surface drift reports in the popup with copy and report actions"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| Ready view amber row, non-blocking | Task 5 (markup), Task 6 (visibility) |
| Post-export warning state as an entry point | Task 5 — the row sits inside `#main-content` alongside `#warning-card`, so it renders in both `ready` and `warning` |
| New `report` view, no router change | Task 5 (`VIEWS` + `data-nav="report"`) |
| Three bands: header / scrolling monospace body / footer | Task 5 |
| Copy report keeps the popup open | Task 6 (`copyReport`) |
| Copy & report copies then opens the tracker | Task 6 |
| Preview byte-identical to the clipboard | Task 1 (one formatter), Task 6 (`this.reportText` feeds both) |
| Suppression keyed by fingerprint | Task 3, Task 6 |
| i18n in all seven locales, English report body | Task 4, Task 1 |
| Clipboard failure surfaces inline | Task 6 |
| Skeleton built lazily | Task 2 (`GET_DRIFT_SKELETON`), Task 6 (`openReportView`) |
| Skeleton over cap is truncated, never dropped | Detection-core plan, Task 4 |
| `docs/PRIVACY.md` unchanged | Global constraints — no task edits it |

**Spec correction recorded:** the spec's data flow shows the skeleton built in the popup. It is built in the content script and returned over `GET_DRIFT_SKELETON`; the popup has no page-DOM access. The user-visible behaviour the spec specifies — nothing built until the report view opens — is unchanged.

**Deferred, per the spec:** a relay for one-click Send; drift reporting from a context-menu export, which has no surface to show it in.
