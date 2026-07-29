# Session Handover

<!-- Written at session end. A new session reading this file can resume without additional context. -->

Written 2026-07-29, end of the selector-drift session (continues the overnight
session of 2026-07-28/29).

## State

**Queue: 128 merged / 2 open / 0 in progress / 2 blocked.** `queue_doctor`
clean (131 tasks, 0 findings). `main` is green: lint, `format:check`, typecheck,
**1062 tests**, both builds OK.

**Both open tasks need the human.** There is no agent-dispatchable work left.

## Shipped this session — 14 PRs, all merged

| PR | What |
| --- | --- |
| #141 | D-18: per-message timestamps are no longer fabricated; local time, not UTC |
| #142 | popup stopped conflating "unsupported page" with "parse found nothing" |
| #143 | SD-1: drift types, fingerprint, selector health, output sanity |
| #144 | D-19: a zero-pair parse no longer paints a normal ready screen |
| #145 | SD-2: leak-proof DOM skeleton builder |
| #146 | SD-6: drift suppression store |
| #147 | SD-3: `ParseResult.drift` — drift detection on the live parse path |
| #148 | SD-4: report formatting (the one string that is previewed AND copied) |
| #149 | SD-5: `GET_DRIFT_SKELETON` — content-script plumbing |
| #150 | pagination test flake that had refused a legitimate release |
| #151 | SD-8: report view + amber drift row + 7 locale keys |
| #152 | SD-9: copy / copy-and-report / suppression behaviour + 3 locale keys |
| #153 | ChatGPT Deep Research read out of its sandboxed cross-origin iframe |
| #154 | D-20: stop sweeping every selector on every parse |

The **selector-drift safety net is complete**. Design:
`docs/superpowers/specs/2026-07-29-selector-drift-safety-net-design.md`.
Plans: `docs/superpowers/plans/2026-07-29-selector-drift-{detection-core,popup-surfaces}.md`.

## Verified, not assumed

- **The leak property test is not vacuous.** Mutation-tested twice in a
  throwaway worktree: inverting the attribute safelist, and emitting raw text
  nodes instead of `text(N)`. Both mutations fail the test. This is the basis
  for telling users nothing but structure is shared — re-run that check if
  `skeleton.ts` is ever refactored.
- **The drift perf cost was measured, not estimated.** `chatgpt.test.ts` in
  isolation: 168 ms/test pre-drift → 224 ms/test after #147 → 188 ms/test after
  #154. The residual ~12% is the feature's intended cost (required-key check,
  turn count, sanity rules on every parse).

## Needs the human

| Task | Needs |
| --- | --- |
| `lo-766f` (p7) port the harness fixes upstream | access to the claude-arsenal plugin repo |
| `lo-7422` (p4) release v1.2.0 | a store decision — see below |
| `lo-4143` (blocked) | **retired**, absorbed into #151/#152. No action. |
| `lo-fc5f` (blocked, p2) Google Drive | reframed as a backup tool; needs design |

**Two store re-reviews are now pending, not one.** `scripting` (PR #116) and
`https://*.web-sandbox.oaiusercontent.com/*` (PR #153). Factor both into
`lo-7422`.

**Unverified in a real browser** — both need a human on a live page:
1. The drift amber row and report view at 320 px (unit tests cover markup,
   router, copy actions, suppression — not how it reads).
2. Whether #153's frame script actually attaches inside the real sandbox iframe,
   and whether the frame's text is fully rendered or virtualized. It degrades to
   `lo-f132`'s honest placeholder if not, so a failure is safe but silent.

## A parallel session is live: the exporters redesign

An **exporters-redesign session is in progress** and owns that work. It is
correctly isolated in its own worktree, `.claude/worktrees/exporters-redesign-spec`
(branch `worktree-exporters-redesign-spec`), and has committed:

- `2bd6456` — `docs/superpowers/specs/2026-07-29-exporters-redesign-design.md`
  (292 lines, direction 1a)
- `docs/superpowers/plans/2026-07-29-exporters-redesign-phase-0.md`

**Do not touch that worktree or seed queue tasks from that spec** — the session
owns both. It briefly had the spec untracked in the *main* tree, which this
session flagged as at-risk; it has since moved it into isolation, so the main
tree is clean and the loop's precondition holds again.

Its phase-0 plan overlaps this session's work in two places worth knowing:
`lo-c03f` (lazy-load exporters) is a sequencing prerequisite it names, and its
"timestamps vs. meta" decision builds directly on PR #141, which stopped
per-message timestamps being fabricated.

## Process lessons worth keeping

- **`release.sh done` re-runs the gate in the orchestrator's MAIN tree**, not on
  the PR branch. Any task that creates new test files therefore fails the gate
  until its PR is merged ("No test files found"). Correct order: merge, then
  record `done`. The guard is right to refuse; it just cannot tell
  "unsatisfiable yet" from "failed".
- **Payload gates must include `pnpm format:check`.** CI enforces it; two PRs
  passed every local gate and failed CI on prettier alone.
- **`cd` to the repo root before every arsenal script.** The Bash tool's working
  directory persists between calls, and running `worker_postcheck.sh` from a
  stale cwd inside a finished worker's worktree restores *that* worktree.
- **A locale-only task cannot pass** `tests/unit/extension/locales.test.ts` — it
  fails on any declared key nothing references. Keys land with their consumers.
