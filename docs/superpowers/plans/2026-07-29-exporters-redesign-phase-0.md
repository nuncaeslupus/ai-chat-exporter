# Exporters Redesign — Phase 0 (prerequisites) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Claude conversations real per-turn timestamps, and collapse the
two export options (`includeMetadata`, `includeTimestamps`) into one
`showMetaInfo`.

**Architecture:** Both tasks are in the data layer, ahead of any visual work.
Task 1 fixes `ClaudeApiService` so the `created_at` the API already returns
reaches `Message.timestamp` — today it is dropped, and the code path that would
carry it bails out early on artifact-less conversations. Task 2 is a
type-driven rename: change the field in `ExportOptions` / `PrintOptions` /
`ExtensionPreferences`, then let `tsc` enumerate every consumer.

**Tech Stack:** TypeScript, Vite, vitest + jsdom, `docx`, `jsPDF`, `marked`,
`highlight.js`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-exporters-redesign-design.md`.
- `showMetaInfo` defaults to **true**. It gates the header block **and**
  per-turn times **and** day separators — a time is meta-info.
- Times are real for **Claude only**. ChatGPT and Gemini stay timeless; every
  format must render correctly with `timestamp` undefined. `D-18`
  (`src/core/parsers/base-parser.ts:139-144`) stands: never fabricate a time
  from the capture moment.
- `tests/unit/core/exporters/timestamp-honesty.test.ts` encodes D-18 and must
  keep passing unchanged in substance.
- Run `pnpm validate` before every commit (lint + format:check + typecheck +
  test).
- Conventional Commits. End commit messages with
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

**Task 1 — Claude timestamps**
- Modify: `src/core/services/claude-api-service.ts` — extract the positional
  pair↔API-message matcher; apply artifacts *and* timestamps through it.
- Modify: `src/extension/content/content-script.ts:236` — call site of the
  renamed method.
- Test: `tests/unit/core/services/claude-api-service.test.ts` — extend.

**Task 2 — `showMetaInfo`**
- Modify: `src/core/types/exporter.ts`, `src/core/types/config.ts`,
  `src/shared/constants.ts`, `src/shared/messages.ts` — the field itself.
- Modify: six exporters + `base-exporter.ts` — consumers.
- Modify: `src/extension/content/content-script.ts`,
  `src/extension/popup/popup.ts`, `src/extension/popup/popup.html`.
- Modify: `_locales/*/messages.json` (seven locales).
- Test: ~20 existing test files reference the old fields; they are updated
  mechanically by the same rename.

---

## Task 1: Claude per-turn timestamps

**Files:**
- Modify: `src/core/services/claude-api-service.ts:316-370`
- Modify: `src/extension/content/content-script.ts:236`
- Test: `tests/unit/core/services/claude-api-service.test.ts`

**Interfaces:**
- Consumes: `ClaudeApiChatMessage.created_at` (ISO-8601 string,
  `src/core/types/claude-api.ts:61`); `Message.timestamp?: Date`.
- Produces: `ClaudeApiService.enrichConversation(conversation, apiData):
  EnrichmentResult` — renamed from `enrichConversationWithArtifacts`, because
  it now also carries timestamps. `EnrichmentResult` is unchanged:
  `{ conversation: Conversation; warning?: string }`.

### Why this is not a one-line change

`enrichConversationWithArtifacts` returns early when the conversation contains
no artifacts:

```ts
const artifactsByMessageUuid = this.extractArtifacts(apiData);
if (artifactsByMessageUuid.size === 0) {
  return { conversation };
}
```

Timestamps riding that path would appear only in conversations that happen to
contain artifacts. It also validates only the **assistant** message count,
while questions need the `sender: 'human'` messages. Both must be fixed.

- [ ] **Step 1: Write the failing test — timestamps without artifacts**

Add to `tests/unit/core/services/claude-api-service.test.ts`. First widen the
existing `makeApiMessage` helper (line 41) so a test can set the time:

```ts
function makeApiMessage(
  uuid: string,
  index: number,
  sender: 'human' | 'assistant',
  content: ClaudeApiChatMessage['content'] = [],
  createdAt = '2026-01-01T00:00:00Z'
): ClaudeApiChatMessage {
  return {
    uuid,
    text: '',
    sender,
    index,
    created_at: createdAt,
    updated_at: createdAt,
    content,
  };
}
```

Then the new test:

```ts
describe('enrichConversation — timestamps', () => {
  it('stamps both messages of a pair even when the conversation has no artifacts', () => {
    const conversation = makeConversation([makePair(0, 'Q', 'A')]);
    const apiData = {
      uuid: 'conv-1',
      name: 'Test conversation',
      created_at: '2026-07-26T09:31:12Z',
      updated_at: '2026-07-29T15:02:47Z',
      chat_messages: [
        makeApiMessage('u1', 0, 'human', [], '2026-07-26T09:31:12Z'),
        makeApiMessage('a1', 1, 'assistant', [], '2026-07-26T09:32:40Z'),
      ],
    } as ClaudeApiConversationResponse;

    const { conversation: enriched, warning } = ClaudeApiService.enrichConversation(
      conversation,
      apiData
    );

    expect(warning).toBeUndefined();
    expect(enriched.pairs[0]?.question.timestamp).toEqual(new Date('2026-07-26T09:31:12Z'));
    expect(enriched.pairs[0]?.answer.timestamp).toEqual(new Date('2026-07-26T09:32:40Z'));
  });

  it('leaves the conversation untouched when the human count disagrees with the pairs', () => {
    const conversation = makeConversation([makePair(0, 'Q', 'A'), makePair(1, 'Q2', 'A2')]);
    const apiData = {
      uuid: 'conv-1',
      name: 'Test conversation',
      created_at: '2026-07-26T09:31:12Z',
      updated_at: '2026-07-26T09:31:12Z',
      chat_messages: [
        makeApiMessage('u1', 0, 'human'),
        makeApiMessage('a1', 1, 'assistant'),
        makeApiMessage('a2', 2, 'assistant'),
      ],
    } as ClaudeApiConversationResponse;

    const { conversation: enriched, warning } = ClaudeApiService.enrichConversation(
      conversation,
      apiData
    );

    expect(warning).toBeDefined();
    expect(enriched.pairs[0]?.question.timestamp).toBeUndefined();
  });

  it('ignores an unparseable created_at instead of stamping an Invalid Date', () => {
    const conversation = makeConversation([makePair(0, 'Q', 'A')]);
    const apiData = {
      uuid: 'conv-1',
      name: 'Test conversation',
      created_at: '2026-07-26T09:31:12Z',
      updated_at: '2026-07-26T09:31:12Z',
      chat_messages: [
        makeApiMessage('u1', 0, 'human', [], 'not-a-date'),
        makeApiMessage('a1', 1, 'assistant', [], '2026-07-26T09:32:40Z'),
      ],
    } as ClaudeApiConversationResponse;

    const { conversation: enriched } = ClaudeApiService.enrichConversation(conversation, apiData);

    expect(enriched.pairs[0]?.question.timestamp).toBeUndefined();
    expect(enriched.pairs[0]?.answer.timestamp).toEqual(new Date('2026-07-26T09:32:40Z'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm test:run tests/unit/core/services/claude-api-service.test.ts
```

Expected: FAIL — `ClaudeApiService.enrichConversation is not a function`.

- [ ] **Step 3: Extract the matcher**

In `src/core/services/claude-api-service.ts`, add above
`enrichConversationWithArtifacts`:

```ts
/**
 * Pair up each Q&A pair with the API messages that produced it.
 *
 * The DOM exposes no id related to the API's uuid, so the match is
 * *positional*: the Nth pair is the Nth human message and the Nth assistant
 * message. That assumption breaks when the two disagree in shape (an edited,
 * regenerated or deleted turn), so both counts are validated up front and a
 * mismatch bails out with a user-facing warning rather than guessing.
 */
private static matchPairsToApiMessages(
  conversation: Conversation,
  apiData: ClaudeApiConversationResponse
): { matched: { pair: QAPair; human?: ClaudeApiChatMessage; assistant?: ClaudeApiChatMessage }[] } | { warning: string } {
  const humanMessages = apiData.chat_messages.filter((m) => m.sender === 'human');
  const assistantMessages = apiData.chat_messages.filter((m) => m.sender === 'assistant');
  const pairCount = conversation.pairs.length;

  if (assistantMessages.length !== pairCount || humanMessages.length !== pairCount) {
    const warning =
      `Artifact contents and message times were left out of this export: the page shows ${String(pairCount)} ` +
      `replies but Claude reports ${String(assistantMessages.length)}, so they could not be ` +
      'matched to the right reply (this happens when a turn was edited, regenerated ' +
      'or deleted). Reload the conversation and export again.';
    console.warn(`[Claude API Service] ${warning}`);
    return { warning };
  }

  return {
    matched: conversation.pairs.map((pair, index) => ({
      pair,
      human: humanMessages[index],
      assistant: assistantMessages[index],
    })),
  };
}

/** An API `created_at` as a Date, or undefined when it is absent or unparseable. */
private static parseApiTime(iso?: string): Date | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
```

Add `QAPair` **and** `ClaudeApiChatMessage` to the existing
`import type { … } from '../types';` block (line 6) — neither is imported
today; the file currently pulls only `ClaudeApiConversationResponse`,
`ClaudeApiRequest`, `Artifact` and `Conversation`.

- [ ] **Step 4: Rewrite the enrichment to use it**

Replace the body of `enrichConversationWithArtifacts` and rename it:

```ts
static enrichConversation(
  conversation: Conversation,
  apiData: ClaudeApiConversationResponse
): EnrichmentResult {
  const artifactsByMessageUuid = this.extractArtifacts(apiData);
  const match = this.matchPairsToApiMessages(conversation, apiData);

  if ('warning' in match) {
    return { conversation, warning: match.warning };
  }

  const enrichedPairs = match.matched.map(({ pair, human, assistant }) => {
    const apiArtifacts = assistant ? artifactsByMessageUuid.get(assistant.uuid) : undefined;
    const questionTime = this.parseApiTime(human?.created_at);
    const answerTime = this.parseApiTime(assistant?.created_at);

    return {
      ...pair,
      question: {
        ...pair.question,
        ...(questionTime && { timestamp: questionTime }),
      },
      answer: {
        ...pair.answer,
        ...(answerTime && { timestamp: answerTime }),
        ...(apiArtifacts && {
          metadata: { ...pair.answer.metadata, artifacts: apiArtifacts },
        }),
      },
    };
  });

  return { conversation: { ...conversation, pairs: enrichedPairs } };
}
```

Note the early `artifactsByMessageUuid.size === 0` return is **gone** — that
was the bug. The count guard now runs for every Claude conversation, so a
mismatched artifact-less conversation warns where it used to stay silent;
that is intended, since the times would be wrong too.

- [ ] **Step 5: Update the call site**

`src/extension/content/content-script.ts:236` —
`ClaudeApiService.enrichConversationWithArtifacts(` becomes
`ClaudeApiService.enrichConversation(`. Check for others:

```bash
grep -rn "enrichConversationWithArtifacts" src tests
```

Rename every hit, including the existing test file's `describe` blocks.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm test:run tests/unit/core/services/claude-api-service.test.ts
```

Expected: PASS, including the pre-existing artifact tests.

- [ ] **Step 7: Verify the exporters now emit a date range**

The date range and day separators were dead because nothing wrote
`timestamp`. Confirm the plumbing lights up:

```bash
pnpm test:run tests/unit/core/exporters/timestamp-honesty.test.ts tests/unit/core/exporters/header-and-day-separator.test.ts
```

Expected: PASS. `timestamp-honesty` asserts the *absence* case (a
conversation with no real timestamps gets no range and no separators) — it
must still pass, because ChatGPT and Gemini are unchanged.

- [ ] **Step 8: Full validate and commit**

```bash
pnpm validate
git add src/core/services/claude-api-service.ts src/extension/content/content-script.ts tests/unit/core/services/claude-api-service.test.ts
git commit -m "$(cat <<'EOF'
feat: carry Claude's per-message created_at into Message.timestamp

The enrichment fetch already returned created_at per message and used it
only to key artifacts. Two things blocked it reaching the export: the
method returned early when a conversation had no artifacts, and it
validated only the assistant message count, so questions had nothing to
match against.

Extract the positional matcher both now share, validate both counts, and
stamp question and answer. Claude is the only platform with a real
per-turn time; D-18 stands everywhere else.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Merge the two options into `showMetaInfo`

**Files:**
- Modify: `src/core/types/exporter.ts:88-105`, `src/core/types/config.ts:78-92`,
  `src/shared/constants.ts:34-35`, `src/shared/messages.ts:64-65`
- Modify: `src/core/exporters/{base,pdf,docx,html,json,txt,structured-md}-exporter.ts`
- Modify: `src/extension/content/content-script.ts:176-177,319-320`
- Modify: `src/extension/popup/popup.ts:360-366,526-529`, `popup.html:314-324`
- Modify: `_locales/{en,es,…}/messages.json` (seven locales)
- Test: the ~20 exporter/popup test files that set these options

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `ExportOptions.showMetaInfo: boolean` and
  `ExtensionPreferences.showMetaInfo: boolean`, replacing `includeMetadata`
  and `includeTimestamps` everywhere. `PrintOptions.showMetaInfo` likewise.

> **Coordinate before landing:** `src/extension/popup/` is being worked on
> concurrently. This is the only task that touches it.

- [ ] **Step 1: Write the failing test — one flag drives both**

Create `tests/unit/core/exporters/show-meta-info.test.ts`:

```ts
/**
 * showMetaInfo gates the header block and per-turn times together: a message
 * time is meta-info, so one switch governs both.
 */
import { describe, it, expect } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { blobToText } from '../../../utils/exporter-helpers';

function timedPair(): QAPair {
  return {
    id: 'p0',
    index: 0,
    selected: true,
    question: {
      id: 'q0',
      role: 'user',
      content: 'Question',
      timestamp: new Date('2026-07-26T09:31:12Z'),
    },
    answer: {
      id: 'a0',
      role: 'assistant',
      content: 'Answer',
      timestamp: new Date('2026-07-26T09:32:40Z'),
    },
  } as unknown as QAPair;
}

const conversation = {
  id: 'c1',
  title: 'Lighthouse notes',
  platform: 'claude',
  url: 'https://claude.ai/chat/1',
  createdAt: new Date('2026-07-26T09:31:12Z'),
  pairs: [timedPair()],
} as unknown as Conversation;

const baseOptions = { format: 'txt', filename: 'test' } as unknown as ExportOptions;

describe('showMetaInfo', () => {
  it('emits the metadata header and the per-turn time when on', async () => {
    const result = await new TextExporter().export(conversation, conversation.pairs, {
      ...baseOptions,
      showMetaInfo: true,
    });
    const text = await blobToText(result.blob!);

    expect(text).toContain('claude.ai/chat/1');
    expect(text).toMatch(/09:3\d/);
  });

  it('emits neither when off', async () => {
    const result = await new TextExporter().export(conversation, conversation.pairs, {
      ...baseOptions,
      showMetaInfo: false,
    });
    const text = await blobToText(result.blob!);

    expect(text).not.toContain('claude.ai/chat/1');
    expect(text).not.toMatch(/09:3\d/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm test:run tests/unit/core/exporters/show-meta-info.test.ts
```

Expected: FAIL — `showMetaInfo` is not a known property, and the time is
absent because `includeTimestamps` is undefined.

- [ ] **Step 3: Change the four type/constant declarations**

`src/core/types/exporter.ts` — replace the two fields with one:

```ts
  /** Whether to include the metadata header block and per-message times */
  showMetaInfo: boolean;
```

and in `DEFAULT_EXPORT_OPTIONS`, replace both entries with `showMetaInfo: true`.

Do the same in `src/core/types/config.ts` (`PrintOptions` and
`DEFAULT_PRINT_OPTIONS` — note it currently has `includeTimestamps: false`
against `true` elsewhere; the merged default is **true**),
`src/shared/constants.ts`, and `src/shared/messages.ts`.

- [ ] **Step 4: Let the compiler enumerate the rest**

```bash
pnpm typecheck
```

Every remaining consumer is now an error. Fix each by replacing
`options.includeMetadata` and `options.includeTimestamps` with
`options.showMetaInfo`. Where a line reads both, it collapses to one:

```ts
// before
const daySeparator = this.daySeparator(options.includeTimestamps);
// after
const daySeparator = this.daySeparator(options.showMetaInfo);
```

Re-run `pnpm typecheck` until clean.

Also rename the parameter in `base-exporter.ts`: `formatTimestampSuffix(date,
includeTimestamps)` becomes `formatTimestampSuffix(date, showMetaInfo)`, and
`daySeparator(includeTimestamps)` becomes `daySeparator(showMetaInfo)`. After
the merge there is exactly one flag; two names for it is drift. Update their
doc comments to say the flag gates times *and* the header block.

- [ ] **Step 5: Add the storage migration**

Where user preferences are read, map the old shape forward once:

```ts
/**
 * Preferences stored before the two options merged carry `includeMetadata`
 * (and possibly `includeTimestamps`). The header block was the user-visible
 * half, so it decides the merged value; a stored `includeTimestamps` is
 * discarded, since it controlled nothing that ever rendered.
 */
function migrateMetaInfo(stored: Record<string, unknown>): boolean {
  if (typeof stored.showMetaInfo === 'boolean') return stored.showMetaInfo;
  if (typeof stored.includeMetadata === 'boolean') return stored.includeMetadata;
  return true;
}
```

Find the read path with `grep -rn "getUserPreferences" src` and apply it there.

- [ ] **Step 6: Collapse the popup to one row**

In `popup.html`, delete the `optionIncludeTimestamps` row (lines ~320-324) and
retarget the surviving row's `data-i18n` to `optionShowMetaInfo`. In
`popup.ts`, delete the `timestampsToggle` block (lines 378-382) and its change
listener (line 529); rename `metadataToggle` to `metaInfoToggle` and point it
at `prefs.showMetaInfo` / `persistPreference({ showMetaInfo: … })`.

- [ ] **Step 7: Update the seven locales**

The seven locales are `ca`, `de`, `en`, `es`, `fr`, `it`, `pt`. In each
`_locales/<lang>/messages.json`: delete `optionIncludeTimestamps`, rename
`optionIncludeMetadata` (currently "Header with the chat details" in English)
to `optionShowMetaInfo`, and reword to the merged meaning. The `description`
is identical in every locale:

`"Label for the toggle controlling whether exports include the metadata header block and per-message times"`

| Locale | `message` |
|---|---|
| `en` | `Show meta-info` |
| `es` | `Mostrar metadatos` |
| `ca` | `Mostra les metadades` |
| `de` | `Meta-Infos anzeigen` |
| `fr` | `Afficher les métadonnées` |
| `it` | `Mostra i metadati` |
| `pt` | `Mostrar metadados` |

So, for example, `_locales/de/messages.json`:

```json
"optionShowMetaInfo": {
  "message": "Meta-Infos anzeigen",
  "description": "Label for the toggle controlling whether exports include the metadata header block and per-message times"
}
```

Verify none is orphaned:

```bash
grep -rln "optionIncludeTimestamps\|optionIncludeMetadata" _locales src
```

Expected: no output.

- [ ] **Step 8: Sweep the test files**

```bash
grep -rln "includeMetadata\|includeTimestamps" tests
```

Each hit sets these in an options literal. Replace both keys with a single
`showMetaInfo`. Where a test deliberately set them to *different* values, it
can no longer — split it into two cases, one per value of `showMetaInfo`, and
keep whichever assertions still make sense. `timestamp-honesty.test.ts` sets
both to `true`, so it becomes `showMetaInfo: true` with no change in meaning.

- [ ] **Step 9: Run the full suite**

```bash
pnpm validate
```

Expected: PASS, including `show-meta-info.test.ts` from Step 1.

- [ ] **Step 10: Verify in the real extension**

Load the unpacked build and check the popup shows **one** "Show meta-info" row
that persists across popup reopens, and that a Claude export contains times
with it on and none with it off.

```bash
pnpm build:chrome
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: merge includeMetadata and includeTimestamps into showMetaInfo

Two checkboxes governed one idea, and one of them governed nothing: no
parser wrote Message.timestamp, so includeTimestamps rendered nothing in
any format. A message time is meta-info, so one switch now gates the
header block, the per-turn times and the day separators together.

Stored preferences migrate from includeMetadata; a stored
includeTimestamps is discarded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## What Phase 0 does not do

The visual redesign — the shared type system, the six per-format rewrites, the
embedded fonts, the five-token code palette — is Phase 1+2, planned separately
once these two land. Their task detail depends on the merged flag's final
signature and on what a real Claude timestamp looks like in each format.
