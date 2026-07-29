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

## ⚠️ A parallel session is live in this repo — DO NOT run the worker loop

`docs/superpowers/specs/2026-07-29-exporters-redesign-design.md` (276 lines,
untracked) belongs to an **exporters-redesign session that is in progress**. It
is not abandoned work and must not be committed, moved, or cleaned by anyone
else. Leave it alone.

**Do not start the arsenal worker loop while that session is running.**
`worker_postcheck.sh` runs `git reset --hard` + `git clean -fd` whenever it
decides the tree needs restoring, and it cannot tell a worker's residue from
another session's uncommitted work. The loop's own precondition — "the main
working tree is clean before the loop starts, and stays that way" — cannot be
satisfied while a second session is editing it.

This is not hypothetical: that file has already survived several postcheck
calls this session only because each returned `ok` rather than `restored`.

Safety net if it is ever lost: backed up as git object `e9e4135`
(`git cat-file -p e9e4135 > <path>`).

There is no agent-dispatchable work left anyway (both open tasks need the
human), so there is no reason to run the loop until the redesign session ends.

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
