# Session Handover

<!-- Written at session end. A new session reading this file can resume without additional context. -->

Written 2026-07-31. Long session: owner feedback rounds, a full-project senior
review, and a fixing sweep. **Context was cleared after this was written — the
queue is the source of truth, this file is the orientation.**

## State

`main` = `c377ebc`. **Green: `pnpm test:run` 1395 tests, lint, format:check,
typecheck, both builds.** Queue: **173 merged / 16 open / 1 in progress / 1
blocked**, `queue_doctor` clean. **No open PRs.**

**26 PRs merged this session (#183-#210).**

## FIRST: check the in-flight worker

`lo-5ebc` (SEC-2) is `in_progress` with a live Task-tool worker that was dispatched
just before the context clear. Follow the protocol's post-compaction step:

```bash
ARSENAL_QUEUE_DIR="$(claude-arsenal/bin/queue_branch.sh)" \
  claude-arsenal/bin/verify_claim.sh lo-5ebc
```

- `pushed:<PR url>` -> record it with `release.sh lo-5ebc done --pr <url>`.
- `in_progress` with no branch -> the worker died (this happened twice today on
  session limits); `release.sh lo-5ebc open --reset-attempts` and re-dispatch.

## The review is COMPLETE — do not re-run it

A 13-dimension senior review ran as a `Workflow` (26 agents: 13 reviewers + 13
adversarial verifiers, 0 errors after one resume). **161 unique findings**, all
seeded into **17 grouped tasks** whose payloads embed every finding with
file/line/problem/failure-scenario/suggested-fix/evidence. A worker needs only its
payload — the journal is not required.

Dimensions covered: exports-under-hostile-input, parser robustness, security
(injection + permissions/privacy), popup UI, accessibility, i18n, dead code,
single-author consistency, types/error-handling, docs truthfulness, test quality,
build/packaging/perf.

Workflow artifacts if ever needed:
`.../workflows/scripts/full-project-senior-review-wf_4d9a4511-705.js`,
run id `wf_4d9a4511-705` (resumable; cached agents replay free).

## Shipped this session

**All 3 review criticals closed:**
- **#203 SEC-1** — `sanitizeHtml` was a 5-tag denylist whose `/^\s*javascript:/`
  only anchored *leading* whitespace, so `java&#9;script:` executed in the print
  preview. Rewritten as an **allowlist** + `safeUrl()` parsing via `new URL()`
  against a scheme allowlist. Also added URL validation to `html-exporter`'s
  structured-block path and UUID validation before the credentialed claude.ai fetch.
- **#202 EXP-1** — DOCX wrote XML-1.0-illegal control chars, so Word refused the
  file while `export()` reported success. One `safeTextRun` wrapper now covers **all
  22** `TextRun` sites (the review had named 6). U+FFFD substitution, not stripping.
- **#204 EXP-2** — PDF silently deleted CJK/Cyrillic/Arabic/Hebrew (Latin-only
  embedded fonts). Now maps uncovered codepoints to `?` **and** raises a localised
  warning (7 locales) pointing at DOCX/HTML. Note: **U+FFFD is itself outside
  `EMBEDDED_FONT_COVERAGE`** — that is why `?` was used.

**Export/parser highs:**
- **#205 D-35** — block elements flattened with no separator, so Gemini tables
  became `0 EUR19%De 6.000 EUR`. New shared `src/core/utils/dom-text.ts`
  (`" | "` between cells, newline between blocks, inline elements get nothing,
  `<pre>`/`<code>` byte-exact).
- **#206 EXP-3** — markdown fence breakout (fence length now = longest backtick run
  + 1), positional-only metacharacter escaping, non-Latin-1 SVG artifacts, nested
  ordered-list indent, Greek prose.
- **#207 PAR-1** — Claude **fabricated a date on every message** (`new Date()` +
  `setHours`); `extractTimestamp` now returns `undefined` because claude.ai never
  exposes a date. Gemini kept only the first content block (`querySelector` ->
  `querySelectorAll`). New `turns-dropped` sanity rule, which first required fixing
  Claude turn overcounting or it false-positived on every healthy conversation.
  Also armed `content-shortfall`, a drift rule that had **never fired**.
- **#208 D-37** — `renderWebSearches` put a bullet on every wrapped title line.
- **#209 TYPE-1** — 13 "failure reported as success" paths: parse failure, print
  failure, context-menu/shortcut failures, zero-pair exports, failed preference
  writes. New `ERROR_KEYS` (vs existing `WARNING_KEYS`), 7 locales.
- **#210 EXP-4** — two-row `<thead>` and `colspan`/`rowspan` put values under the
  wrong heading. Normalised the grid at parse time; **zero exporter files changed**.

**Owner-feedback rounds (popup P-1..P-8 and PDF):** #183/#187/#193/#195/#197/#200
— `--pad-x` 18->26px, width 420->436px, fixed 436x396 box, `--content-column` token,
back-arrow centred *and* left, label/control grouping 8px vs 32px, segmented pills
(no wrap in any locale), ChatGPT logo green `#10a37f`. Plus #199 heading
normalisation (source h3 now renders `##`, not `####`), #194 Deep Research capture,
#201 Deep Research HTML fidelity, #191 tilde corruption, #185/#188/#189 vitest 4 /
Vite 8 / coverage guard, #184 prose artifacts.

**#198 was a REVERT** — #196's fidelity work lost the whole report body. Cause:
`relay()` shipped HTML if merely non-empty; `cloneNode()` sees only the light DOM
while `innerText` sees the rendered tree. #201 re-landed it with a runtime
HTML-vs-text length comparison (`MIN_HTML_TEXT_RATIO = 0.5`).

## THE structural lesson — carry this forward

**Six guards in this repo were asserting broken behaviour or measuring nothing.**
This is the most important finding of the session, more than any single bug:

1. #196's fidelity test checked artifacts were *removed*, never that the body
   *survived* — it let a total-data-loss regression through to `main`.
2. `it('extracts timestamps')` asserted the **fabricated** date.
3. `it('exports nothing (but still succeeds) ...')` — the name documents the defect.
4. `splitTextToSize` mock returned `[text]`, so **no test in that file ever
   exercised wrapping**.
5. #200's logo contrast test asserted the brand *token*, uncoupled from the SVG.
6. The orchestrator's own XSS probe searched for `javascript:` — which cannot match
   the smuggled `java\tscript:`. It reproduced the very bug it was hunting.

**Therefore: every behavioural fix must have a test proven to FAIL first, and the
orchestrator must verify that independently** by reverting the worker's source and
re-running the worker's own tests. That was done for all 9 fixes today and is why
none regressed. Keep doing it. `lo-db60` (TEST-1) exists to repair these.

## Calibration note for the orchestrator

Of five root causes asserted from reading code, workers corrected three:
- table corruption blamed on `base-parser.ts:188` — actually
  `HtmlContentParser`, because `preserveHtml` defaults true so five of six
  exporters never read that field (only JSON does);
- U+FFFD proposed as PDF placeholder — itself unrenderable;
- `renderList` blamed for the bullet bug — it was already correct
  (`if (j === 0)`); the culprit was `renderWebSearches`.

Reliable about **what** is broken, less so about **where**. Give workers the
evidence and let them locate it.

## Owner's outstanding manual items

1. **Test build:** `<scratchpad>/CURRENT/dist/chrome` is built from an older commit
   — **rebuild against `main` before the owner tests.** Same path, so they reload
   rather than reinstall.
2. **`lo-164e` (D-38) needs a live Gemini page.** Gemini tables still are not real
   table blocks: `grep -c '<table' tests/fixtures/dom-snapshots/gemini/*.html` = 0 in
   both, and none of the strings from the owner's real export exist in the fixtures
   (they predate it). The #205 separator fix means data is no longer *corrupted*,
   but a fresh DOM capture (`parser-generator` skill) is needed to make them tables.
3. Deep Research end-to-end still wants an owner check: full body + real headings/
   tables + the `[Deep Research: Xm, N sources, M searches]` marker with real numbers.

## Next work, in order

`lo-5ebc` SEC-2 (in flight) -> `lo-db60` TEST-1 -> `lo-4faf` A11Y-1 (17 findings,
focus lost on every view change is the worst) -> `lo-2849` POPUP-1 (the `error`
state has **no CSS at all**) -> `lo-648d` I18N-1 -> `lo-2a39` DOCS-1 (26) ->
`lo-ed64` DEAD-1 (24) -> `lo-1e2f` BUILD-1 -> `lo-f356` CONSIST-1 -> the small
D-3x items -> `lo-7422` release **last**.

`lo-7422` carries blocking deps on ~50 tasks by design: the owner said the version
rises only once "all of this and what can come up while addressing it" is fixed.
**This repo still has no git tags at all**; creating the first is in that task.

## Operational gotchas (cost real time today)

- **API session limits killed 3 workers mid-flight** (resets were 3:40am and 1:10pm).
  Symptom: task-notification `status: failed` with a truncated result. Recovery:
  `release.sh <id> open --reset-attempts`, then re-dispatch. Always check for
  stranded `in_progress` rows first.
- **The safety classifier goes down intermittently**, blocking all Bash/Write while
  Read still works. Retry; it returns within minutes.
- **`release.sh done` re-runs the gate in the orchestrator's MAIN tree.** A stale
  local `main` grades new code against old — `git pull origin main` before recording
  any `done`.
- **`worker_postcheck.sh` exit 2 is a false alarm** in side-worktree mode (it wants
  `HEAD=arsenal-queue`; `queue_branch.sh` deliberately keeps the main tree on
  `main`). It did **not** restore anything. Check `git status --porcelain` instead.
- **`pkill -f "<pattern>"` kills the shell running it** — the pattern matches its own
  command line. Use `ss -lptn 'sport = :PORT'`.
- **Popup cannot be fully measured from a served page**: no `chrome.i18n`, so labels
  render as raw keys (much longer than real strings — this produced a false
  measurement today), and main-view/pair-chooser rows never render in the
  "detecting" state. Load unpacked, or toggle views one at a time.
- **Every jsPDF mock** in `tests/unit/core/exporters/` needs any newly-used jsPDF
  method added, or it throws inside `export()` and is swallowed into an error result,
  surfacing as an unrelated assertion failure.
