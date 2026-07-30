# Session Handover

<!-- Written at session end. A new session reading this file can resume without additional context. -->

Written 2026-07-30, end of a parallel-worker session driven by `/continue`. The
owner was asked for every open decision up front, so nothing below is a guess —
each decision is written into the relevant task payload, not only here.

## State

**Queue: 154 merged / 1 open / 2 blocked + 1 new open (D-28).** `queue_doctor`
clean (158 tasks, 0 findings).

**`main` is green and everything shipped.** `pnpm validate` exits **0** end to
end: 71 test files, **1192 tests**, coverage 84.76 / 70.38 / 90.90 / 85.13
against the new 83 / 69 / 89 / 83 floors.

**Seven PRs merged this session. There is no agent-dispatchable work left** —
what remains needs a human (see the two sections at the end).

## Merged this session

| PR | What |
| --- | --- |
| #183 | P-1+P-2+P-3 in one PR — `--pad-x: 22px` token, width 420→428px, uniform chevron inset, slim tokenized scrollbars |
| #184 | A-1 — prose artifacts render in pdf and docx; a `type: 'code'` artifact with `language: 'markdown'` stays a code block |
| #185 | vitest 3.2.4 → 4.1.10 |
| #186 | R-2b — question turn fill, table rules, code-language tab |
| #187 | P-4 — settings gear + light/dark/auto theme, plus a scrollbar miss found in-browser |
| #188 | Vite 8 / Rolldown — `renderDynamicImport` replacement, **verified on a live page** |
| #189 | D-27 — transitive-reachability guard + recalibrated coverage floors |

Closed unmerged: **#181** (its warning was acted on), **#182** (approach rejected).

## Owner decisions — all recorded in the payloads

- **PDF fonts: `@fontsource` npm deps**, not vendored base64. Turned out to be
  *already implemented in #177* — see corrections.
- **P-4 gear: a header icon button BESIDE Options**, which keeps Show meta-info,
  Text size and File name. Gear = app config; Options = per-export.
- **P-4 theme scope: popup only.** Exported HTML deliberately keeps its own
  `prefers-color-scheme` block and adapts to whoever opens the file.
- **D-25: reject suppression, upgrade instead.**
- **D-27: take BOTH** the reachability check and recalibrated thresholds.
- **Release `lo-7422` is last.** The owner's words: the version rises once all of
  this "and what can come up while addressing it" is totally fixed. Enforced
  **mechanically** — `lo-7422` carries blocking deps on every task seeded this
  session, including D-28, so the loop cannot pick it early. Git tags are in its
  scope; **this repo still has no tags at all.**

## D-25 was fixed by removing the problem, not silencing it

Attempt 1 (#182) made `test:coverage` exit 0 via
`dangerouslyIgnoreUnhandledErrors: true` in `vitest.config.ts` — which suppresses
**every** unhandled error in **every** vitest run. That trades one eroded signal
for a broader one, in a task that exists *because* of signal erosion. Rejected;
the owner chose the vitest 4 upgrade so `onUnhandledError` could filter by
message.

**The upgrade removed the symptom entirely, so no filter was needed.** Verified
on merged `main` rather than taken on report: three consecutive
`pnpm test:coverage` runs, all exit 0, **zero** `onTaskUpdate` hits. `lo-6fbb` is
recorded against #185 with **no suppression anywhere**.

## Corrections worth carrying forward

- **A stale local `main` makes `release.sh` lie.** `release.sh done` re-runs the
  acceptance gate in the orchestrator's main tree. If that tree is behind
  `origin/main`, gates fail against old code — R-0's gate "failed" this way and
  looked like missing test coverage, which nearly became a bogus divergence task.
  **`git pull origin main` before recording any `done`.** The side-worktree design
  means the main tree never changes branch, so it is easy to forget it also never
  *advances*.
- **`worker_postcheck.sh` exit 2 is a false alarm in side-worktree mode.** It
  expects `HEAD=arsenal-queue`, but `queue_branch.sh` deliberately keeps the main
  tree on `main`. It reported "could not restore" and — importantly — **did not
  restore**, so nothing was destroyed. Check `git status --porcelain` manually
  instead. Do **not** "fix" this by moving the main tree onto the ledger branch.
- **R-2b's item 1 was already done.** `@fontsource/*` deps, the
  `generate-pdf-fonts.mjs` postinstall, tracked `pdf-fonts.generated.ts` and
  `addFileToVFS` all landed in **#177**, while the payload still listed it as an
  open owner decision. Scope was cut before dispatch. **Check `main` before
  believing a payload's "not done yet".**
- **`pkill -f "<string>"` kills the shell running it** — the pattern matches its
  own command line. Use `ss -lptn 'sport = :PORT'` to find the pid.

## Browser verification caught a real defect the tests could not

- **Found: `.drift-report-preview` still had the OS default scrollbar**
  (`scrollbar-width: auto`). Six of seven scroll areas got P-3's slim bar; the
  `<pre>` scrolling long DOM-skeleton lines was missed — exactly the wide grey
  gutter P-3 existed to remove. Routed back into the still-open #187 rather than a
  third `popup.css` PR. Re-verified after: **8/8 areas `thin`.**
- **Why no test caught it:** P-3's gate was `contrast.test.ts`, which guards
  scrollbar *colours* but cannot see a scroll area never given the rule at all.
  Green before and after.
- **Theme override verified against a real media query**, not a mocked
  `matchMedia`: pane in dark scheme, `data-theme="light"` forces white,
  `data-theme="dark"` holds dark.
- Confirmed: 428px width, 22px `--pad-x`, 56+320 box intact, no horizontal
  overflow, gear 30×30 at exactly 22px from the right edge.
- **Known limitation:** the popup opens in its "detecting" state and the main-view
  rows never render without the Chrome APIs, so main-view chevrons cannot be
  measured this way. The Options chevron measured 32px from the popup edge
  (= 22px pad + 10px), corroborating the uniform inset.

## Two guards were found vacuous

- **The lazy-chunk checker went blind under Vite 8.** Rolldown's minifier
  re-quotes strings as backticks, so `check-bundle-size.cjs` fell from checking
  **16 chunks to 1** while still printing `ok`. #188 fixed the checker and proved
  the old one blind by reverting `renderChunk` to a no-op (old logic still exited
  0). Independently re-verified on a fresh build: **0 un-rewritten relative
  dynamic imports, 34 `getURL` sites.**
- **D-27's new guard was proven non-vacuous twice** — by its author and again
  independently: green baseline → inject an unimported `src/` file → fails naming
  exactly that file → green after removal.

## Vite 8 is verified on a real page — and how, because it is counter-intuitive

Rolldown has **no** `renderDynamicImport` equivalent (options 1 and 2 were ruled
out against Rolldown 1.2.1's real type declarations), so #188 uses a `renderChunk`
textual rewrite. The owner loaded `dist/chrome` unpacked on a live Claude
conversation and exported PDF and DOCX: both logged `Successfully exported`.

**The Network tab showed no `chunk-` entries, and that is expected, not a
failure** — a content script's `chrome-extension://` imports are extension-context
fetches and are not attributed to the page. The real proof is arithmetic: the
eager bundle is **56,976 B**, while PDF needs `chunk-pdf-exporter.js` (222 KB) +
`chunk-jspdf.es.min.js` (399 KB) and DOCX needs `chunk-docx-exporter.js`
(367 KB). Those cannot be in a 57 KB eager bundle, so the dynamic imports must
have resolved. No 404s and no `Failed to fetch dynamically imported module`
anywhere. **Do not re-litigate this; record it as verified.**

## D-28 — the one real defect found, needs a human to diagnose

**`lo-6333` (new, priority 10).** The owner confirmed on a live ChatGPT page that
**Deep Research still exports `lo-f132`'s placeholder**, not the report. This is
exactly the silent failure the previous handover flagged as unverified, now
observed. Degradation works correctly (no exception, no fabricated content); the
*capture* (#153 / `lo-9001`) is broken.

Already ruled out, so nobody wastes a cycle: the built manifest is correct
(`https://*.web-sandbox.oaiusercontent.com/*`, `all_frames: true`, matching
`host_permissions`), `deep-research-frame.js` is emitted and present, and lazy
chunks are fine.

The payload's step 1 is the fork: **determine whether the frame script runs at
all** (`chrome://extensions` → Inspect views, plus a temporary unconditional log
at the top of `deep-research-frame.ts`). If it never runs, the leading hypothesis
is an **opaque origin** needing `match_origin_as_fallback: true`. If it runs but
relays nothing, the candidates are `innerText` on a virtualized report, the
500 ms quiet period never settling before the 30 s ceiling, or the parent's
strict origin regex at `deep-research-relay.ts:20`. **Its gate needs a live page
and cannot be closed by a bash block.**

## Loose end, not acted on

`lo-4143` (SD-7) still reads `blocked`. The previous handover recorded it as
**retired, absorbed into #151/#152, no action needed**. It is queue noise rather
than work; left alone because retiring a task is the owner's call. Consider
closing it deliberately.

`lo-fc5f` (Google Drive) remains `blocked` pending design — reframed as a backup
tool.

## Process notes

- **Isolation was probed, not assumed.** `worktree_probe.sh` returned
  `available`; the first batch ran as a lone worker to confirm the Task tool
  honored `isolation: worktree` before ramping to 2. It did.
- **File-level conflicts are not dep edges by default.** Tasks touching the same
  file were serialized with explicit `blocks` deps — R-2b behind A-1
  (`pdf-exporter.ts`), P-4 behind P-1 (`popup.css`), Vite 8 behind vitest 4
  (`package.json`). Without this, `queue_batch.sh` will happily hand back two
  workers for one file.
- **P-1/P-2/P-3 were deliberately one PR.** One CSS rhythm change; three PRs
  would have re-measured the same padding and conflicted in one file. Recording
  the same PR URL against all three tasks is fine.
- **A still-open PR can absorb a follow-up.** The scrollbar miss went back to the
  worker via a message on its existing branch, keeping one `popup.css` PR instead
  of three.
- **vitest 4 accepts Vite 8** — `peerDependencies.vite: "^6 || ^7 || ^8"`. The two
  upgrades were sequenced for the `package.json` conflict, not compatibility.
- **Coverage floors are now tight by design** (83/69/89/83 vs measured
  84.76/70.38/90.90/85.13). A legitimate refactor that dips will fail CI; that is
  intended, not a bug. `coverage.all` is gone in vitest 4 and `all: true` is
  **inert** — `tests/unit/import-reachability.test.ts` now carries the
  "someone added an untested module" signal.
