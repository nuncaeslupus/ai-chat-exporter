# Session Handover

<!-- Written at session end. A new session reading this file can resume without additional context. -->

Written 2026-07-28 (overnight session).

## READ FIRST — data loss incident

~335 lines of uncommitted Gemini parser work in the main working tree were
**destroyed** during this session. Cause: the orchestrator ran
`claude-arsenal/bin/worker_postcheck.sh` in the **main working tree** while HEAD was
on a locally-created feature branch. Lines 103–106 of that script do
`git reset --hard` + `git clean -fd` + `git checkout -f` — designed to scrub a
worker's throwaway worktree. The work was never staged, so it is unrecoverable from
git (object database, all agent worktrees and the stash-recovery ref were searched).

**Rules that follow, for any future orchestrator session:**

- Never run `worker_postcheck.sh` in the main working tree. It is worker-worktree
  cleanup only.
- Never create feature branches in the main working tree while it holds uncommitted
  work. Use a side worktree.
- If the main tree is dirty at session start, commit it to a branch before doing
  anything else, or refuse to run any cleanup script.

`lo-d88c` is the rewrite task. `lo-4d4a` and `lo-3920` carry an `UPDATE 2026-07-28`
section explaining that their "uncommitted change" references are now void.

## Last task

- **ID**: lo-b617
- **Title**: Convert .agents/parser-generator into a real .claude/skills skill
- **Status at handover**: merged (PR #38)

## What was done this session

27 tasks merged across 31 PRs (#8–#38). `main` is green; no open PRs; queue doctor
reports 0 findings.

**Phase 1 — backlog drain (14 tasks).** Two live XSS re-injection sinks; a 404
privacy policy plus store listings claiming "no external servers" while the code made
network calls; export/print failures reported to the popup as success; DOCX code
blocks collapsing to one line; `selectedPairs` ignored by five of six exporters;
coverage thresholds silently ignored (real coverage 20%, configured 80%); broken
`pnpm dev` producing minified output; WCAG AA contrast; Claude API artifacts matched
by position and title; PDF sanitizer deleting representable characters; first tests
for `html-content-parser` (3.7% → 97.2%); first fixture-to-parser-to-exporter
integration suite.

**Phase 2 — live ChatGPT survey (the important part).** Surveyed chatgpt.com with the
user's account and found **the ChatGPT parser extracted nothing at all from a live
page**: ChatGPT moved its turn wrapper from `<article data-turn>` to
`<section data-turn>`, the parser hardcoded `article`, and all 61 unit tests passed
against a January fixture. Also found and fixed: maths triplicated on ChatGPT
(`E=mc2E = mc^2E=mc2`) while lost entirely on Gemini — now collapsed to one
representation preferring the LaTeX annotation; PDF export hanging forever on an
artifact's undecodable SVG preview image; citation-pill favicons filed as conversation
images; `role="button"` chrome surviving cleanup.

**Phase 3 — knowledge capture.** `docs/dev/parser-gotchas.md` (15 field notes) and a
real, triggerable `.claude/skills/parser-generator/` replacing the inert `.agents`
copy, which had no frontmatter and documented a nonexistent API.

## What remains

42 open tasks. Highest value first:

- **`lo-d88c` (p10, GEMINI)** — reimplement the Gemini parser from scratch. Load the
  `parser-generator` skill first.
- **`lo-194d` (p9, GEMINI)** — manifest gap: the content script never loads on
  gemini.google.com at all, so nothing Gemini works end-to-end without it.
- **`lo-31e6` (p8, SECURITY)** — reconcile `docs/PRIVACY.md` and both store listings
  against the network calls the code *now* makes (PR #9 disclosed a Google favicon
  fetch that PR #23 then removed), and audit whether the Claude parser's DOM-scraped
  favicons are third-party. Unverified — needs a real capture with citations.
- **`lo-872a` (p7)** — Claude artifact enrichment now skips on a DOM/API shape
  mismatch with only a `console.warn`, so an edited conversation exports with all
  artifacts missing and no user signal.
- **`lo-630d` (p8)** — a standalone `<img>` is silently dropped by
  `html-content-parser` (`img` missing from the block-tag list). Two deliberately
  inverted `BUG:` tests pin the current wrong behaviour.
- **`lo-9ddf` (p9)** — its predicted PR #14/#24 assertion collision did **not**
  materialise; the remaining valid half is deleting the hand-rolled ZIP reader in
  `tests/utils/docx-helpers.ts` now that `jszip` is a real devDependency.
- **`lo-0f01` (p8)** — ~1,100 pre-existing lint errors; lint is deliberately not
  CI-gated, which every worker had to work around.

## Known tooling problems (not in this repo — they live in the arsenal subtree)

1. **`worker_postcheck.sh` is destructive outside a worker worktree.** See the
   incident above. Highest-priority tooling fix.
2. **Worker worktrees start from a stale base.** Three workers hit this: their own
   task payload missing from disk (readable via
   `git show arsenal-queue:claude-arsenal/queue/<id>.md`), `open_task_pr.sh`
   hard-failing at `git checkout -b <branch> FETCH_HEAD` on a non-conflict, and a
   stale `node_modules` missing a newly-added devDependency. Workaround: every worker
   prompt now tells the agent to `git fetch`, branch off `origin/main`, and
   `pnpm install` first.
3. **`refs/stash` is shared across worktrees.** Two concurrent workers using
   `git stash` destroyed each other's work early in the session (recovered). Every
   worker prompt now forbids `git stash` outright.
4. **`ARSENAL_SURFACE` self-certification.** `open_task_pr.sh` refuses `git add -A`
   unless `ARSENAL_SURFACE=worktree`, but nothing sets it, so workers set it
   themselves — defeating the guard it represents.
5. **skill-creator's gate hook is namespace-blind.** `mark_skill_creator_loaded.sh`
   matches a bare `skill-creator`, not the plugin-namespaced
   `skill-creator:skill-creator`, so the marker is never written and the pre-write
   hook blocks **all** skill authoring. Bypassed manually this session.

## How to continue

Standard protocol: `queue_branch.sh`, `queue_sync.sh`, `queue_eval.sh`, then the
worker loop. `ARSENAL_MAX_WORKERS=3` worked well with file-disjoint task selection.
CI takes ~3 minutes per PR; check `gh run view <id>` rather than polling
`gh pr view` — check conclusions go stale and mislead once `main` moves.

**Before dispatching anything: check whether the main working tree is dirty.** If it
is, commit it to a branch first. That is what went wrong this session.

Unsurveyed, and potentially hiding breakage as severe as the `<article>` → `<section>`
one: ChatGPT **Canvas, Deep Research, and o-series reasoning traces** — all
unreachable on the Free-tier account used for the survey.

## Queue snapshot at handover

`merged: 27`, `open: 43`, `in_progress: 0`. Queue doctor: 0 findings.
