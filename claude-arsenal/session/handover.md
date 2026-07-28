# Session Handover

<!-- Written at session end. A new session reading this file can resume without additional context. -->

Written 2026-07-28 (afternoon session, follows the overnight session).

## READ FIRST — git history was rewritten today

`main` and all 51 branches were **force-pushed** after a `git filter-repo` purge
(commit `7f71ca3` onward). Any clone or worktree created before ~16:00 today is
on dead history. Recover with `git fetch --all --prune && git reset --hard origin/main`
— do **not** try to merge.

The purge removed real captured conversation data that had been public since the
initial commit: 111 real ChatGPT conversation titles, the owner's display name,
a Claude org UUID, an uploaded filename, and a real conversation UUID. Verified
zero hits across all history afterwards.

**Two things remain outstanding and only a human can do them:**

1. **GitHub Support request.** `refs/pull/*` were rejected by the force-push
   (GitHub owns them), so the old blobs are still fetchable by SHA via PR refs.
   Ask Support to GC unreachable objects after a history rewrite. Until then the
   purge is incomplete.
2. The repo was public with that data since January — treat it as disclosed.

Runbook with full detail: `tmp/history-purge-runbook.md` (gitignored).

## Rule established this session

**No real conversation data in the repo. Fictional/staged conversations only.**
Captures live in `tmp/examples/` (gitignored); only sanitized fixtures with
invented prose are committed. Both `real-capture.html` fixtures were rebuilt this
way — structure preserved byte-for-byte, all prose replaced.

## What shipped (PRs #39–#55, all merged, main green)

Queue: **42 merged / 36 open**, `queue_doctor` 0 findings.

- **Gemini works end to end for the first time** — parser (#41), manifests (#40),
  registry (#48), popup gate (#51), Deep Research (#55).
- Content script **2.24 MB → 48.6 KB** eager (#42, lazy `import()`).
- Two skills built: **`parser-generator`** upgraded with live widget-coverage
  verification (#53) and **`exporter-generator`** created from the inert
  `.agents/` copy (#52), with a content-type × format completeness matrix.
- Privacy: `docs/PRIVACY.md`, README, `usage.md` and both v1.1.1 store listings
  corrected against an audited network-call inventory (#49, #50); favicon sink
  removed and "no remote subresource in exported HTML" pinned by test (#54).

## Verified live in Chrome by the user

Gemini recognised, `v1.1.1` shown, no "You said" prefix, **Deep Research exports
correctly with its 55 cited sources**. Lazy-loading (#42) works in a real browser.

## What is NOT verified

- ChatGPT and Claude exports were never opened in a browser this session. No PDF
  or DOCX has been rendered and looked at by anyone.
- Gemini `getTitle()`/`getModel()` are dead against the live page — every Gemini
  export is filed "Gemini Conversation" with no model (`lo-3c90`). The liveness
  guard passes because the January fixture still has the old markup.

## How to continue

Standard protocol: `queue_branch.sh`, `queue_sync.sh`, `queue_eval.sh`, workers.
`ARSENAL_MAX_WORKERS=3` with **file-disjoint** selection worked well.
**Verify CI yourself before recording `done`** — a worker's "typecheck clean" was
wrong once this session and a red PR was recorded as done.

**`dist/` is gitignored and never rebuilt automatically.** After merging anything,
run `pnpm build` before telling the user to reload the extension — this bit us
twice.

### Highest-value open work

- **`lo-f132` (p9, ChatGPT)** and **`lo-2478` (p8, Claude)** — the same
  Deep-Research/widget treatment Gemini just got. **Both are blocked on a human
  capture** (paid features, real interaction): ask the user for
  `copy(document.querySelector('main').outerHTML)` per widget into
  `tmp/examples/`. Capture with panels **expanded** — Gemini's report only exists
  in the DOM while open.
- **`lo-3c90` (p8)** — Gemini title/model selectors dead on live page.
- **`lo-5d45` / `lo-5970` (p7)** — exporter gaps found by the completeness matrix.
- **`lo-2416` (p9)** — every payload's mechanical gate passes vacuously
  (0 of 70 had a fenced gate block). New payloads written this session do have
  real gate blocks; the backlog does not.
- **`lo-0f01` (p8)** — ~1,163 eslint errors, un-gated. Must run alone.

## Tooling notes

- claude-arsenal revendored **0.20.5 → 0.21.0** (`worker_postcheck.sh` now
  snapshots to `refs/arsenal-rescue/` before destructive restores).
- The upstream `claude-arsenal` repo's GitHub Actions are **failing on billing**,
  so `tag-release.yml` never ran and `v0.21.0` was never tagged. The owner is
  handling that separately.
- skill-creator's PreToolUse gate mismatches the namespaced skill name
  (`skill-creator:skill-creator`), so the marker is never written. Strip the
  `<plugin>:` prefix before comparing.
