# Changelog

All notable **user-visible** changes to claude-arsenal are recorded here, one
`## [X.Y.Z]` section per version bump (see root `CLAUDE.md` § Versioning).
"User-visible" means what a downstream consumer would want to know about
before or after updating — a new skill, a new flag, a new option, a breaking
change — not an internal refactor, a doc fix, or a test.

CI's `version-bump` job requires a heading here matching the bumped
`.bundle-version` on every PR that changes a shipped file; it only checks that
the heading exists, not that the entry says anything useful, so write one a
consumer would actually want to read.

`/init`'s upgrade banner and `check_update.sh` print the entries between a
consumer's installed version and the one they're updating to, automatically,
every time they update — that's the whole reason this file exists instead of
being a changelog nobody reads.

Format: `## [X.Y.Z] - YYYY-MM-DD`, newest first, plain bullets below.

## [5.26.0] - 2026-11-11

Slow CI, addressed where it starts. A measured review of seven repositories
built with this workflow found none was slow from having too many tests: the
time was in workflow shape, fixtures rebuilt per test, tests re-running a
measurement a gate already runs, and tests that grep prose. What that review
found is now the default a session works to, so the same mistakes are not made
again in the next repo.

### The defaults (each can be overridden with a written reason)
- **CI** (`references/ci-minutes.md` § CI defaults): pull requests run **one
  language version** — the oldest supported — on **Linux only**; the full
  version/OS matrix, release and installer builds and the slow test tier run on
  the default branch, nightly or tags; superseded runs are cancelled; every job
  has a timeout; no step runs twice; the test runner runs in parallel.
- **Tests** (`execution` § `references/test-cost.md`): every module with
  branching, parsing, boundary or data-loss logic has tests, and a core module
  with none is a finding; no tests that grep prose, pin constants or glue, or
  re-run a gate's measurement; duplicates become one table or property test;
  an expensive fixture is built once per module or session; subprocess spawns
  are batched; slow tests are marked and kept off every push. Fast tier: about
  60 seconds, a starting value.
- **`python-bootstrap`** applies both when it writes a test target or CI.

### Added
- **`scripts/ci_shape.py` checks your workflows.** Run
  `python3 claude-arsenal/scripts/ci_shape.py` to see, per push/PR workflow, a
  missing `cancel-in-progress`, jobs with no `timeout-minutes`, a macOS or
  Windows runner on the pull-request path, a `matrix` spelling out more than
  one language version or OS where pull requests reach it, and as notes: the
  same command run by two jobs, and a missing path filter (a filtered workflow
  carrying a required check blocks the PRs it skips). Read-only, stdlib only; `--fail-on-problems` makes it a gate.
  `references/ci-minutes.md` § Measuring it points at it.
- **`execution` has a test-cost rule.** A test is owed per failure mode of logic
  that branches, parses or can lose data, not per function; no tests that grep
  prose, re-run a gate's measurement, or pin constants; expensive fixtures are
  built once per module; a test slower than about a second needs a reason or a
  slow tier. The detail is in the skill's `references/test-cost.md`, loaded only
  when a task adds many tests or a slow one.
- **`review` flags tests that do not earn their cost**, citing the same
  reference.
- **`repo-audit` has a test-diet pass** (`references/test-diet.md`): measure
  first, classify what should be cut, merged or moved off the every-push path,
  state the protection each cut loses. "Proportionate, keep" is a valid result.
  It runs in **every** audit, and the report always has a `Test diet` section:
  verdict, measurements, what to trim, and core modules with no tests.

Nothing changes in an existing repo until you run the script or a skill loads
the new reference; no test of yours is touched.

## [5.25.0] - 2026-11-10

### Changed
- **The annotatable reader is lighter to use.** Import now sits in the top bar
  next to Save / Export; the floating bottom-right buttons (Top, Import, Clear,
  Export) are gone, and Clear with them. The page is light only, and inline
  diagram SVGs lose their dark-mode ink so they stay readable on it. The
  Contents index starts collapsed.
- **Zoom uses a wide screen.** The first tap or click on a picture or diagram
  widens it to the window, less a 16px gutter, rather than zooming inside the
  text column; on a phone it still zooms to 250% with pan.

### Added
- **`--bake` warns on personal data** in a note: an email address or a
  `/home/<user>`, `/Users/<user>` or `C:\Users\<user>` path. The reader
  reference now asks for both the export and the reviewed copy to be read for
  names, emails, phones, handles and home paths before they are committed.
## [5.24.0] - 2026-11-10

### Added
- `create_reader.py --notes <export> --bake` writes `…-reviewed.html`: the
  reviewer's returned notes pasted in place, read-only and full length, beside
  the text they were written on. Run it before bumping the revision and commit it
  with the export, so the review lives in the repo next to the document. A rebuild
  does not remove it.
- Screens review: a `screens.md` (one `## Sxx · name` per screen, a summary, the
  picture) runs through the same reader, for UI projects that review screenshots
  or mockups. `specify` offers it for user-facing problems; the recipe is in
  `references/annotatable-reader.md`.
- Pictures and SVG diagrams in any reader zoom in place: tap or click enlarges one
  inside the column and pushes the note field below it, pinch or Ctrl+wheel zooms
  the picture only (not the page), tap again to fit. No overlay to close.
- Local images are embedded as data: URIs, so a reader opened from Downloads or a
  phone shows them.

### Changed
- An export now names the document it came from. `--notes` refuses another
  document's export (exit 2); the page's Import asks before loading one.

## [5.23.0] - 2026-11-09

### Fixed
- Skills no longer reach into sibling skills through `${CLAUDE_SKILL_DIR}/..`
  (`design`, `review`, `ship`, `github`, `explore-idea`). Those paths do not
  resolve once a skill is installed outside the marketplace layout; each now
  cites the vendored `claude-arsenal/` path or names the sibling skill.
- `session-end`'s handoff reference no longer mentions a `--merge` flag that
  `write_handoff.py` never had, nor a private project name in an example.

### Added
- `skill-workshop`'s validator fails any `${CLAUDE_SKILL_DIR}/..` path,
  fenced or inline (`skill-dir-escape`), and resolves `claude-arsenal/…`
  script cites against init's assets so vendored paths validate upstream.

## [5.22.0] - 2026-11-09

- `query_status.py --fix`: stamps `status: merged` on archived task files in
  `_history/` whose issue closed as completed but that predate the required
  `status:` field. Without the flag, the problem line now points at it.

## [5.21.2] - 2026-11-09

- `references/repo-housekeeping.md`: the release-workflow example now pins
  `astral-sh/setup-uv`, `actions/upload-artifact`, `actions/download-artifact`
  and `pypa/gh-action-pypi-publish` to commit SHAs (version in a trailing
  comment), like `actions/checkout` in 5.21.1. Copying the example no longer
  gives you a workflow that follows moving tags.

## [5.21.1] - 2026-11-09

- `query_status`: a task whose issue closed as completed and whose file is
  already in `_history/` but has no `status:` line (archives written before the
  field was required) now reads "its archived file has no `status:` — add
  `status: merged`", instead of telling you to move it to `_history/`, where it
  already is.
- `repo-housekeeping` reference: the release-workflow example pins
  `actions/checkout` to the v4.4.0 commit SHA, as the shipped queue workflow does.

## [5.21.0] - 2026-11-09

- `claim_task.sh`: in serialized in-place mode a claim is now refused (exit 2)
  while the checkout already has changes no task made, and the stray paths are
  listed. In that mode the task's PR commits the whole tree with `git add -A`,
  so a local settings edit or a large untracked directory of yours used to ride
  into it. Commit or stash them, or list the directory in `.git/info/exclude`.
  Worktree-isolated runs are unaffected; `ARSENAL_ALLOW_SHARED_ADD=1` skips it.

## [5.20.7] - 2026-11-05

- `bugreport`: kernel log times in `timeline` and the summary no longer run
  early by the device's total time asleep since boot. dmesg seconds stop
  during suspend, so the old boot-based conversion drifted by hours on a
  phone that had slept; the kernel's own `PM: suspend entry/exit … UTC`
  lines now pin each stretch to the wall clock when the report has them.

## [5.20.6] - 2026-11-05

### Fixed

- The annotatable reader from `create_reader.py` no longer loses a note typed
  just before the page closes: pending saves are flushed on `pagehide` /
  `beforeunload`, and with storage blocked the unload warning fires for an
  edit still inside the save debounce.
- Importing notes into a newer reader keeps a section note whose heading was
  renamed or removed: it lands under "Unplaced notes" and is in the next
  export, instead of being silently dropped.
- The reader's notes dialog is now a real modal dialog for keyboard and
  screen-reader users: `role="dialog"`, `aria-modal`, focus moves in on open
  and returns on close (also on Escape), and the page behind is `inert`.
  Regenerate existing readers to pick these up.

## [5.20.5] - 2026-11-05

### Fixed

- `arsenal-queue.yml` pins `actions/checkout` to the v4.4.0 commit SHA instead
  of the movable `@v4` tag, so a retagged or compromised upstream release cannot
  change what runs with the workflow's write token. Re-run `/init` to pick it up.

## [5.20.4] - 2026-11-05

### Fixed

- `adversarial_review.sh emit` no longer takes minutes on a tree with large
  untracked files that git does not ignore. Only the first 1 MiB of untracked
  content is inlined as diffs. Files past that are fingerprinted: they stay in
  the digest, so changing one still makes a receipt stale, and `emit` warns and
  suggests `.git/info/exclude`. The cap is set by `ARSENAL_REVIEW_UNTRACKED_BYTES`.
  The emptiness check was a quadratic bash substitution and is now a regex
  match. On 51 MB of untracked HTML, `emit` went from 183 s to 17 s (#546).

## [5.20.3] - 2026-11-05

### Fixed

- `validate.py`'s `content.ref-unconditional` check accepts Spanish load
  conditions (`cuando`, `si`, `antes de`, `en caso de` …), so a skill written in
  Spanish no longer fails the skill-workshop gate on every reference it cites
  with a condition (#550).

## [5.20.2] - 2026-11-05

### Fixed

- `merge_ready.sh` and `pr_audit.py` no longer pass a PR whose `mergeable_state`
  is `behind`, `dirty` or `unknown`. A `behind` PR ran CI on an old base, so a
  squash merge would land code never tested together; the next action now says
  to update the branch. `unknown` is fetched once more before it blocks (#540).

## [5.20.1] - 2026-11-05

### Fixed

- `/init` no longer adds a `.gitignore` line your repo already has in another
  spelling: `.claude/worktrees/` and `/.claude/worktrees/` ignore the same path,
  so the second is now recognised and skipped (#539). Patterns whose meaning
  changes with the leading slash, such as `tmp/` and `/tmp/`, are still kept
  apart.

## [5.20.0] - 2026-11-04

- **`bugreport` (android section, off by default) is feature-complete.** New in this release:
  - **Security checkup (F10):** `analyze_bugreport.py` now flags sideloaded apps holding
    accessibility, device-admin, notification, overlay, usage or install access; USB
    debugging; an always-on VPN; an unlocked bootloader; a security patch over 90 days
    older than the report; and user-installed CA certificates (zip reports only). Play
    Protect is not reported: a bugreport's text does not expose it.
  - **`--advice`** adds each finding's one-line remedy; `references/advice.md` holds the
    full steps per finding.
  - **`create_bugreport.py --redact`** writes a copy safe to send: identifiers become
    tokens, and a `.zip` output drops binary members (listed in `dropped`) because they
    cannot be scrubbed.
  - **`compare_bugreport.py`** diffs two `analyze_bugreport.py --output` files: new, gone
    and changed findings, plus moves in the memory and battery rankings.

## [5.19.0] - 2026-11-04

- **`review-bots` now defaults to none (CI-only).** It used to list three vendor bots, so a
  repo running none of them had the PR loop wait for a signal that never came. **If your
  repo uses a review bot, list it:** `review-bots = ["yourbot[bot]"]` in
  `arsenal/config.toml`, or `init.py --review-bots yourbot[bot]`. Existing installs see one
  `NEW SETTING review-bots` line until they set it, and the setup interview now asks which
  bots review the repo.
- **Uncommitted edits to vendored files are kept.** `init.py` (run at every session start)
  used to overwrite a changed bundle file and replace a vendored skill folder outright,
  destroying edits nobody had committed. It now leaves such a file or folder alone and
  prints `MODIFIED LOCALLY — left as is: <path>`; commit or discard it, then re-run.
  Committed edits are still replaced: the bundle is upstream's.
- **Hooks no longer run twice** when the plugin is installed and `/init` also registered
  them in `.claude/settings.json`: each duplicated plugin hook (skill-edit gate, compaction
  resume) stands down when the project's settings run the same script.

## [5.18.0] - 2026-11-04

- The setup interview is no longer first-install only. While `arsenal/config.toml` has
  no `setup-interview` key, every `init.py` run — `--silent` session starts and
  upgrades included — prints `SETUP INTERVIEW PENDING`, and the session asks the
  interview before picking up work. Hosts installed before the interview existed, or
  whose first install skipped it, are now asked once.
- Answering records `setup-interview = "<date>"`; the new `--interview-declined` flag
  records `"declined"` for a user who skips it. Either stops the line for good.
- New interview question and flag `--merge-policy` (`always`, `after-ci`,
  `after-review`, `after-ci-and-review`, `never`). Whatever is chosen, the agent merges
  by itself once `merge_ready.sh` passes, without asking.
- The interview and `pr-review-loop.md` now say how CodeRabbit behaves on small repos:
  no auto-review under 10 stars, but on a public repo `@coderabbitai review` still gets
  a review (about one per hour); on a private Free-plan repo only a summary.
  `--suggest-bot-triggers` prints that note on stderr when CodeRabbit is configured.

## [5.17.0] - 2026-11-04

- `analyze_bugreport.py` gains seven detector families, each with its `--family` table:
  `battery` (F1, screen-off drain blamed on the top partial wakelock, checkin v15 and v36),
  `reboots` (F3, battery shutdown as last boot reason, system_server watchdog kills with
  the blocked thread), `crashes` (F5, repeated `am_crash` per package and native crashes
  decoded from `.pb` tombstones in a zip), `network` (F7, Wi-Fi scan storms, SSIDs never
  shown), `peripherals` (F8, GPS held by a background app), `storage` (F9, low `/data`
  free space with the largest caches) and `battery-health` (F11, learned capacity under
  80% of design).
- Thresholds are starting values; a section whose layout a detector does not recognise
  is still a `not_parsed` row, never a silent miss.

## [5.16.0] - 2026-11-04

- New `bugreport` skill (android section) for Android bugreports: `query_bugreport.py`
  (show / sample / locate a section), `validate_bugreport.py` (layout and which
  detector inputs parsed) and `summary` for the device header. Output is JSON,
  capped in size, with PII redacted by default.
- `analyze_bugreport.py` runs a ranked checkup: swap thrashing, ANRs blamed on system
  pressure or on the app's own main thread, kill → restart loops, and thermal
  throttling. Each finding lists its subjects, evidence offsets and an `advice_id`.
  `--family memory|anr|thermal|churn` adds that family's tables. A section it cannot
  read becomes a `not_parsed` row with the `query` command that reaches it, so the
  run does not fail. More families (crashes, battery, reboots, …) come in later
  releases.

## [5.15.0] - 2026-10-29

- New `scripts/render_diagrams.py`: renders each ```drawspec fence in a spec or plan
  to `diagrams/<doc>-<n>.svg` and puts the image above it, with the JSON source
  collapsed under "Diagram source". Diagrams now show as pictures on GitHub instead
  of JSON, in light and dark mode. `--check` exits 1 when an SVG is stale, for CI.
  Needs drawspec 0.4 or later; `uvx` fetches it when it is not installed.
- `create_reader.py` ignores that image and wrapper, so the HTML reader still draws
  each diagram once.

## [5.14.1] - 2026-10-29

### Fixed
- **`merge_ready.sh` no longer fails on PRs with long review-bot comments.** It passed each API response to Python through an environment variable, and Linux caps one at 128 KiB, so a PR carrying a few long bot comments exited 2 with "Argument list too long". The responses now go through temporary files.

## [5.14.0] - 2026-10-27

### Added
- **Overnight repo audit** (`repo-audit`, `references/overnight.md`):
  - `audit_estimate.py` prices a scope before anything runs: files, lines, ≈ tokens (12 per line, a starting value to tune) and workers.
  - The audit asks for scope and a token ceiling first, then runs one subsystem at a time, riskiest first, checking the budget before each.
  - A run that stops early reports what it did not cover, and never edits code.
- **`review_metrics.py`:** one line per risk tier for the last N days, so you can see whether relaxing a tier raises reverts.
  - From git: merges, reverts and fix-ups within 7 days.
  - From digest records: mean review rounds and who found the problems.
- **Digest:** the header now carries the 30-day metrics line, and `render --audit <ledger>` adds the night's audit findings as a card above the PRs.

## [5.13.0] - 2026-10-27

### Added
- **Lean-code rules** (`references/lean-code.md`, loaded only when implementing or reviewing).
  - Before writing code, a four-step check: is it needed at all → does the stdlib or platform already do it → does the repo already have it → only then the minimum that passes the gate.
  - One-line rules: smallest diff, delete before adding, no speculative options, no impossible-state guards, no unrequested refactors, no comments restating code, no dependency for a few lines.
  - A never-cut list: validation, error handling, security, accessibility, tests.
- **Reviewer `SCOPE` tag:** code a task did not need is reported as `RISK | … — SCOPE: …` with the lines that could go. It never blocks on its own; the author removes it or answers why it stays.
- **Digest size flag:** add `expected_lines` (your estimate, written before implementing) to the record notes. A PR over twice that shows `⚠ 2.4x expected size` on its card, and a green mark turns amber.

## [5.12.0] - 2026-10-27

### Added
- **Review digest: decide on a night's work without opening GitHub.**
  - `digest.py record` stores each PR's facts in a hidden block in its body: risk tier, a red/amber/green mark, state, a summary of at most 60 words, each problem found (who found it, how it was fixed, which commit), what is still open, and how to undo it.
  - `digest.py render` turns open and recently merged PRs into one page: folded cards, red first, each with **Approve / Deny / Question**. It also makes a Markdown version for chat.
  - Agents render it at session end, at the token-budget stop and every `digest-every` merges (default 5).
- **`apply_decisions.py` acts on what you decided**, from the page's exported file or typed lines like `approve 42; deny 43: split it`.
  - An approval only counts for the commit you saw; if the PR changed since, it is reported as stale.
  - Approved PRs merge in dependency order. A denied PR is closed; a denied merged PR gets a revert PR.
  - Questions are posted on the PR for the next session to answer.
- **`[review] digest-decisions = true`** makes a digest approval count as your human approval. This lets `solo-gated` work when agents open PRs with your own GitHub account. It is off by default; `/init` offers it with the solo presets.
- Config: `digest-delivery` (`file` | `chat` | `both`) and `digest-every`.

## [5.11.0] - 2026-10-27

### Added
- **Risk-tiered approval (`[review] preset`).** `/init` now asks who approves what: `solo-trust` (the agent merges every PR; high-risk merges are flagged `Ratify: pending` for you to confirm later), `solo-gated` (you approve medium- and high-risk PRs), `team` (0/1/2 human approvals by tier) or `manual`. A PR's tier comes from its changed files (`risk-paths`, `risk-lines`, new `always-human-paths` and `low-paths`); `approval-low|medium|high` override a row. Human approvals only count on the head commit and never from a bot or the PR author. Merge commits now carry `Risk-tier` / `Reviewed-by` / `Approved-by` trailers. `review_policy.py explain` prints your effective flow. **Nothing changes until you set a preset** — re-run `/init --interview` or add `preset = "…"` under `[review]` in `arsenal/config.toml`.
- **Note on any paragraph in an annotatable reader.** Every paragraph, list item and table in a spec or plan reader has a ✎ at its right; tapping it opens a note box right below that spot, so you write while the text that prompted the note stays in view. The export quotes the paragraph each note is about (`> ¶ “…”`), `--notes` re-seeds them, and a note whose paragraph a later revision rewrote is kept at the end of its section instead of dropped. Regenerate a reader to get it.

## [5.10.9] - 2026-10-25

### Changed
- **The PR review `/loop` prompt is one line now.** `query_pr_state.py` prints a `next` field with the action for the current state (the agree/disagree/ambiguous rubric on `bot_commented`, rebase on `conflicts`, …), so the loop no longer carries the whole rubric into every 2-minute tick. Update a loop you started from the old one-liner by restarting it from the `github` skill.
- AGENTS.md's references table lists only when to open each file, not what is inside it (~125 tokens less on every turn of every session).

## [5.10.8] - 2026-10-25

### Changed
- **Smaller skills listing:** every skill description was tightened (5550 → 3998 chars across all 23), keeping each one's "Use when" trigger and "Not for" exclusion. Every session pays this listing on every turn.
- The `ARSENAL_*` tuning-knob table moved from `references/worker-loop.md` (read on every task pickup) to `references/performance-tuning.md` § Tuning knobs.
- Examples and pointers no longer name a specific review bot or skills this bundle does not ship (`engineering-core`, `code-review`).
- Removed leftover references to the coordination branch retired in v0.25.0.
- `queue-next` points at AGENTS.md for the fetch, claim and PR rules instead of restating them (~300 tokens less per invocation).
- `ship` walks the checklists in `references/template.md` instead of keeping a second, drifted copy in Steps 3–6; the template gains the items only the skill had (client notification, flaky tests, deployment order, on-call).
- `explore-idea` Step 6 uses the decision-log table from `references/ideas-backlog.md`, which has the optional `Sub-project` column the skill's copy lacked.
- The full task-file example moved from AGENTS.md to `references/state-layout.md` § Task format; AGENTS.md keeps the field list.

## [5.10.7] - 2026-10-25

### Fixed
- **Skill-edit gate:** a relative path is now resolved against the session's working directory, so `cd …/skills/<name>` followed by `sed -i … SKILL.md` is gated like the absolute form. A host with no `python3` no longer has every Edit/Write/Bash call refused — only calls that name a skill path.
- Plugin hooks quote `${CLAUDE_PLUGIN_ROOT}` and run through `bash`, so a plugin root with a space in it (e.g. `C:/Users/First Last`) no longer silently disables them.
- `detect_surface.sh` detects redis on macOS, which has no `timeout`.
- The skill-edit gate and the prompt hook start fewer `python3` processes per call.

## [5.10.6] - 2026-10-25

### Fixed
- **Session start no longer reprints the whole pending changelog.** `check_update.sh --check-only` (run at every session start while an update is pending) and the `/init` upgrade banner now show the newest 5 entries and one line counting the rest. A consumer a month behind was paying 15–40k tokens of release notes per session.
- `sweep-claims` no longer releases a claim whose task has a hand-opened PR naming it by the `arsenal-task:` body marker (it only recognised `arsenal/<id>-…` branches), which handed the task to a second session.
- `handle_sync.py` defaults `--label` to your `task-label` setting instead of a hardcoded `arsenal:task`, so a renamed label no longer yields duplicate handles. `create_task.py` prints the `arsenal-id:<id>` label too.
- `branch_protection.py --force` now keeps linear history, conversation resolution, last-push approval, branch lock and block-creations; the PUT used to switch them off.
- The post-merge archive step no longer reports "archived" when its `git add`/`commit` failed.
- `handle_sync.py` no longer claims tasks were "held back" when the only warning was the by-title notice.

## [5.10.5] - 2026-10-20

- `references/performance-tuning.md` gains **Time from PR to merge**: measured
  medians (54 → 9 → 5 min) and what cut them — CI as the only gate, scoped local
  checks, merge on green, capped review rounds, a cheaper suite. **Making the
  tests themselves cheaper** adds: regenerate only the inputs a test reads, rank
  files serially, leave product-measurement tests alone, match CI's interpreter.

## [5.10.4] - 2026-10-20

- **`prune-claims` no longer fails on more than 100 claim refs.** GitHub's
  `matching-refs` endpoint ignores `page` and `per_page`, so paging it read the
  same refs ten times, reported the listing as truncated, and DELETEd every ref
  once and then 422'd on the nine copies. `matching_refs()` now makes one
  request, and `plan_prune_claims` plans one delete per ref.

## [5.10.3] - 2026-10-20

- **`references/performance-tuning.md` covers the tests themselves.** Two new
  sections: making slow tests cheaper (reuse the product's own selection,
  memoise pure helpers per module, one end-to-end pipeline test, exhaustive
  sweeps state their cost) and not adding tests the suite has to carry (one
  test per behaviour rather than per finding, no tests about the process
  itself, scoped runs while editing).

## [5.10.2] - 2026-10-20

- **The scheduled queue job prunes finished claim refs again.** `prune-claims`
  sent its `DELETE` to `git/heads/<claim>` instead of `git/refs/heads/<claim>`,
  which GitHub answers with 404, so the "release abandoned claims, prune
  finished ones" job failed on every run and claim refs piled up. After
  updating, the next runs delete the backlog (a run capped by the truncation
  guard leaves the rest to the next one).

## [5.10.1] - 2026-10-14

- **Spec and plan readers no longer share a name across documents (#517).**
  Readers and their exports are stamped to the minute,
  `<repo>-<doc>-v<N>-<YYYY-MM-DD-HHMM>-reader.html` / `-notes.md`, so two
  workspace specs reviewed the same day stay apart in Downloads. Earlier
  date-only readers are still cleaned up and still recognised by the
  validators. `SOURCE_DATE_EPOCH` pins the stamp.
- **A bare placeholder no longer hides the rest of the reader.** Raw
  `<title>`, `<script>`, `<style>`, `<textarea>` and similar tags outside code
  are shown as text instead of swallowing everything after them.
- **Opening a reader no longer fills it with old notes.** Notes saved in the
  browser are keyed on the document's revision and, for workspace specs, the
  workspace. Notes already applied to revision N no longer reappear in revision
  N+1's reader, and one workspace's notes no longer show up in another's. To
  carry unapplied notes forward, use `--notes <export>` as before. Notes typed
  into a reader built before this update are not shown by a rebuilt one, so
  export them first.
- **The reader is easier to read and to annotate.** The document is set in a
  book face. Empty note fields are a quiet single line that opens into a
  writing card on focus, and a written note stands out as a solid card. A
  single document gets flat contents with no repeated title band. Tables are
  tidier, and `**Revision**` / `**Status**` header lines stay one per line.

## [5.10.0] - 2026-10-13

- **`/init` credits claude-arsenal in your README.** It adds a "built with
  claude-arsenal" badge, linking the project, under `README.md`'s title, once,
  between `claude-arsenal:attribution` markers that later refreshes update in
  place. It works like a license notice you are free to drop: delete the block
  and it is not put back, or set `attribution = false` in `arsenal/config.toml`
  before it is added. Commit the README change with the refresh.
- **`design` plans past drawspec's budget can be drawn again.** `sync_plan_graph.py`
  now draws the Depends column's transitive reduction (an edge a longer path
  already implies is left out), and a plan still past 15 nodes / 16 edges is
  split into a phase overview plus one graph per phase, each within the budget.
  `validate_plan.py` accepts a path for each dependency instead of a literal
  edge, reads a split graph as one, and only **warns** on a fence too big to draw
  — it no longer demands a graph `create_reader.py` refuses. Rerun
  `sync_plan_graph.py --apply` on a plan whose reader stopped building.
- **`create_reader.py` runs drawspec from PyPI.** The fallback after
  `$ARSENAL_DRAWSPEC` and `drawspec` on PATH is now
  `uvx --from 'drawspec>=0.2,<0.3' drawspec`, pinned so your reader does not
  change under you; faster to fetch, and works where git over HTTPS is blocked.
  `pip install drawspec` puts it on PATH.
- **Review loop: a bot acknowledging your trigger is no longer read as a skip.**
  `review_sources.py` classifies acknowledgements ("Review triggered", "review
  requested/queued/started") as in progress, and anything a bot posts after the
  loop's own trigger on the same head waits one `bot-wait-min` instead of ending
  the loop `bot_skipped`; only a rate limit there is final. `pr-review-loop.md`
  notes per-hour on-demand quotas: with several PRs open, trigger the one a bot
  review is worth most on first.
- **`pypi-release` documents an automated release** (`references/automated-release.md`):
  a `release.yml` that publishes on a merged version bump (or a pushed `v*` tag,
  checked against the version) with `twine check --strict`, PyPI trusted
  publishing behind a `pypi` environment with a required reviewer, then
  `gh release create` — plus the owner's one-time setup, SHA-pinned actions and
  how to gate the release on green CI.

## [5.9.1] - 2026-10-13

- `references/repo-housekeeping.md` now walks a package's **first publish** in
  order — the pending trusted publisher the owner has to register, the release
  workflow that must match it by filename and environment, the warning that
  merging it publishes — with a workflow that releases on a version bump, and a
  check that the built archive does not ship vendored tooling.

## [5.9.0] - 2026-10-12

- **`repo_health.py` checks packaging metadata.** For a package whose name is on PyPI it reports a `GAP` when `pyproject.toml`'s `[project]` lacks a description, readme, license, `requires-python`, or a `[project.urls]` entry pointing at the repository (without it the index page cannot link back). For an unpublished package the same list is appended to the `NOTE`, as what to add before a first publish.
- **Choosing a license is a guided question.** A missing-license gap now points at the new `references/repo-housekeeping.md`: the three questions that decide between a permissive, patent-granting, copyleft or no-license choice, and a checklist for publishing a package (name check, metadata, back-links, version = tag = release, publishing from CI without a stored token).
- **`branch_protection.py --repo OWNER/REPO` no longer reads the wrong workflows.** Run from a checkout of a *different* repository, it used that checkout's `pull_request` job names as the required checks when the target had no PR history, which would have blocked every PR there on checks that never run. It now requires a PR only in that case.

## [5.8.0] - 2026-10-12

- **`/init` lists the repository housekeeping that is missing.** The first deliberate run (the one that protects the default branch) now also runs the new read-only `claude-arsenal/scripts/repo_health.py` and prints one `repo_health: GAP …` line per missing item, each with the command that fixes it: no description, topics or license; a default branch not called `main`; an unprotected default branch; secret scanning or push protection off; a Pages site or PyPI package with no homepage link; a newest version tag with no release; a PyPI version with no tag. A `NOTE` line flags a `pyproject.toml` package that is not on PyPI, or a same-named PyPI project that does not link back to your repo. It changes nothing by itself and is skipped with `--no-branch-protection`. Run it by hand at any time; `--fail-on-gaps` exits 1 for use in CI.

## [5.7.0] - 2026-10-12

- **New settings are announced.** Session start (`init.py`, including `--silent`) prints `NEW SETTING <key> (since vX.Y.Z, default …): …` for each config key a release adds that your `arsenal/config.toml` neither sets nor acknowledges. Silence them by setting the key or `config-acknowledged = "X.Y.Z"`. Nothing is printed when nothing is pending (#496).
- **`[review] reviewer-identity = "distinct-login" | "distinct-session"`** (default `distinct-session`). A reviewer posting with the PR author's login clears the head when its marker (`adversarial_review.sh marker --post <pr>`) names a session that is not one of the PR's `Claude-Session` trailers; the reviewer must run as its own session, not as a subagent (#495). A repo whose second reader is a human or a bot on another login can set `distinct-login`, under which a CLEAR from the author's own login never counts.
- **The adversarial review counts as the review when no bot can.** `after-ci-and-review` (and `after-review`) accept a clearing adversarial-review marker for the head SHA when no bot or human review is available; `review_sources.py` reports rate-limited, capped or skipped bots as `unavailable` instead of `pending` (its JSON changes accordingly). New `bot-unavailable-notices` key adds your bot's own wording (#507).
- **explore-idea keeps a durable ideas backlog.** `/explore-idea capture <text>` (or pasting a list of ideas) sorts them into `status/ideas.md` with stable `I-N` ids and proposed sub-projects. The `D-N` decision log is saved there and never re-asked in later sessions; `specify` cites the `I-N` ids it covers, and the board prints one `ideas:` line when the file exists (#504).
- **`design` plans draw their dependency graph as a drawspec diagram** generated from the task table's Depends column (`sync_plan_graph.py --apply`). `validate_plan.py` fails on every edge a drawspec graph and the table disagree on, and **warns** (exit 0) on the old ASCII graph with the fix — run `sync_plan_graph.py --apply` once on an existing plan that still has one (#506).
- **Annotatable readers** put one note field after each section with text and none on bare headings, read better (≈70-char lines, clearer headings, distinct note fields, dark mode, phone layout), and are named `<repo>-<doc>-v<N>-<date>-reader.html`, with exports `…-notes.md` to match (`--output FILE` overrides). A rebuild removes older readers of the same document (an annotated file with typed notes is kept), and a requested download no longer counts as a saved backup (#505).
- **`open_task_pr.sh --branch <name>`** (or `ARSENAL_PR_BRANCH`) commits and pushes on a designated branch instead of creating `arsenal/<id>-<slug>`, with every check still run. With no PR tool available it prints the full PR body, including `Closes #N`, so you can open the PR yourself (#503).
- **`claim_task.sh` manual hint** now names the branch to create and says to use your harness's GitHub tool (e.g. `create_branch`); a 403 from the shell token means "use the tool", not an error to stop on (#502).
- **`create_task.py --body`** with its own `## Acceptance gate` fenced block no longer gets a second, placeholder gate appended; a body whose gate section has no fenced block is refused (#501).
- **The skill-edit gate no longer blocks commands that only run a skill script**, including from a heredoc or `-c` program via `subprocess`, `sys.executable` or `os.system`. Writes into a skill folder are still blocked (#500).

## [5.6.0] - 2026-10-10

- **`ship` now checks the README's hero image.** Step 1 asks whether a hero (banner) image still matches what ships, and points to a new on-demand reference, `ship/references/readme-hero.md`: when a change means redrawing it (a renamed or removed headline feature, a new lead feature), and how to make one render everywhere (1280 × 640, the GitHub social-preview size; a PNG, since GitHub's `<img>` view of an SVG loads no fonts; an absolute URL so PyPI and mirrors show it; no versions or counts on it, so releases do not stale it). It says nothing about how a hero should look. One line added to the `ship` body; the reference loads only when needed. No resident-context cost.

## [5.5.1] - 2026-10-10

- **The orchestrator tick starts the full gate only after the second reader clears the head.** `references/orchestrator-tick.md` now orders each PR head as: second reader → CLEAR on that exact head → `fast_gate.sh --full` → merge. Running the full clean-checkout gate beside the review wasted it on every BLOCKed round and slowed every other session sharing the cores. The cheap per-round `preflight-gate` is unchanged. `merge_ready.sh` and `references/github-automation.md` state the same order. No resident-context cost.

## [5.5.0] - 2026-10-07

- **A ready-made test selector for `preflight-gate`.** `claude-arsenal/bin/select_tests.py` prints the tests a change could affect — the ones named after a changed file or naming it — and falls back to every test whenever it meets a file it cannot place, so review rounds stop paying for the whole suite without silently skipping anything it cannot see. Example: `preflight-gate = 'pytest $(python3 claude-arsenal/bin/select_tests.py --tests "**/test_*.py")'`. `--always`, `--ignore` and `--include` tune it; see `references/ci-minutes.md`. It does not follow imports, so keep it out of `host-gate`. No resident-context cost.

## [5.4.0] - 2026-10-06

- **`github` no longer polls a PR in cloud sessions that get PR events.** When the session offers `subscribe_pr_activity` (claude.ai cloud sessions), the skill subscribes to the PR and acts on each CI, review and conflict event as it arrives, instead of running a `/loop` every 2 minutes. Local CLI sessions keep the `/loop` review loop unchanged. A silent review bot, a reaction or a quiet window sends no event, so the skill schedules one check-in whenever the PR is waiting on something other than running CI.
- **`query_pr_state.py` now works where GitHub GraphQL is blocked.** Cloud sessions get a 403 on GraphQL, which made the script exit 2 on every call, so the review loop never ran there. It now falls back to REST for the repo name, PR state, CI rollup, reviews and review threads. One gap: REST cannot see whether a thread was resolved, so with `--unresolved-only` only threads whose latest reply is from a human drop out. Bot `bot-triggers` commands are now posted through REST too.

## [5.3.0] - 2026-10-05

- **Every longer session keeps resume notes, not only `execution`.** `AGENTS.md` now tells any session on work longer than a few steps to keep `tmp/<id-or-slug>-notes.md` with a `## Resume` section (Decided / Ruled out / Next step). The compaction hooks have always re-injected that section; until now only the `execution` skill said to write it, so other sessions had nothing to restore. Costs about 60 tokens of resident context. `/init` now adds `tmp/*-notes.md` and `tmp/.arsenal-sessions/` to `.gitignore` so the notes stay out of `git status`. Re-run `/init` to pick up both.

## [5.2.0] - 2026-10-05

- **Compaction keeps your decisions even without a notes file.** A new `PreCompact` hook asks the summary to keep the task in progress, decisions taken, approaches ruled out, the next step, and your corrections. Before this, the resume hooks only helped a session that had written `tmp/<task-id>-notes.md`, which in practice meant only sessions running `execution`; any other session was left with whatever the default summary kept. Re-run `/init` to register the hook in `.claude/settings.json`; plugin installs get it on update.

## [5.1.0] - 2026-10-03

- **Parked tasks keep their work.** New `bin/park_task.sh <task_id> "<reason>"` pushes a stopped task's uncommitted tree to `arsenal/wip/<task_id>` and prints a `resume:` command that restores it, still uncommitted, on any machine (#482). Workers now run it before returning `open` (gate failure, round cap, refused review), and the worker loop copies the `wip:`/`resume:` lines into the task notes, the issue and `handover.md`. Before this, a task stopped at the review cap on a cloud container was lost with the container.
- **Round-cap messages only offer what you can do.** On a cloud surface, `adversarial_review.sh` now says only the repo owner can raise `review-max-rounds` and tells the agent to park the task. Under `pre-pr-review = "required"` it no longer suggests "fix and open the PR", which that gate refuses (#484).
- **`requires:` now matches what the surface measured.** `task_select.py` reads `arsenal/session/surface_profile.json` by default; `--capability` adds to it, `--no-profile` ignores it. Declare your own probes under `[capabilities]` in `arsenal/config.toml` (e.g. `"net:example.com" = "curl -sf …"`, `"data" = "test -d data/raw"`); `detect_surface.sh` grants each one only where its command exits 0 (#481).
- **Agent worktrees are no longer residue.** `worker_postcheck.sh` ignores registered git worktrees nested in your tree, so a worker run with `isolation: worktree` no longer trips a restore that stops the loop. `init.py` also adds `/.claude/worktrees/` to `.gitignore` (#485).
- **The session-start refresh no longer dirties your tree.** `init.py --silent`, run from the copy vendored into your repo, rewrote the `# source:` line of `claude-arsenal/.arsenal-manifest` to your own repository's URL (#480, #483). It now keeps the recorded upstream. If an earlier refresh already rewrote it, restore the line with `git checkout -- claude-arsenal/.arsenal-manifest` (or set it back to the marketplace URL) before your next update.

## [5.0.1] - 2026-10-01

- **Spec/plan readers keep your notes.** Three bugs in the annotatable reader that `create_reader.py` generates are fixed (#477). Regenerate a reader to pick up the fixes:
  - clearing a note no longer brings the original note back after a reload;
  - blocked browser storage no longer hides the notes embedded in the reader;
  - "Copy" reports success only when the copy really happened, and otherwise tells you to select the text and copy it yourself.

## [5.0.0] - 2026-10-01

Prompts rewritten for the current Claude model generation (Opus 5.5, Sonnet 5.5, Fable 5.1), following Anthropic's prompting guides for those models. Skills do the same jobs with less context and calmer, explained instructions.

- **Less context, every turn.** The always-loaded tier (vendored `AGENTS.md` plus the skill list) dropped from 4,162 to about 2,765 tokens, and skill bodies dropped from about 38k to 22.5k tokens in total. Rarely needed detail moved to references that load only when needed: `har` query grammar, `queue-next` claim gotchas, `github` multi-PR stacking.
- **Breaking: text that moved.** If your own prompts or tooling quote arsenal prose, these moved:
  - `AGENTS.md` now points to `github-automation.md`, `worker-loop.md § Credit guards` and `evidence-gates.md` instead of repeating them.
  - Model dispatch for workers and reviewers lives only in `worker-loop.md § Credit guards`; the snippet in `reviewer.md` is gone.
  - Gate-speed tuning moved from `evidence-gates.md` to `performance-tuning.md § Making the gate faster`.
  - The reviewer's follow-up-round rules now arrive in the review packet.
- **Agents finish the job.** Workers and `execution` carry the plan through to the PR without pausing between tasks. Pre-existing bugs and unrequested cleanup are reported as follow-ups, not fixed. A code change needs one real check (tests, build, typecheck or the command itself) before it is called done.
- **Reviews report everything.** `review`, the reviewer agent and `repo-audit` give every finding a severity and a confidence, and filtering is a separate step. `repo-audit` sizes its fan-out to the repo, has no mandatory re-verify pass, and no longer asks which model to use. The reviewer prompt is about half its old size.
- **Short task labels.** Task files take an optional `label:` (up to 5 words). Board output and sessions name tasks as `<label> (t-id)` instead of a bare id. `create_task.py --label` writes one.
- **New `autonomy` key** (`ask-often | ask-when-blocked | autonomous`, default `ask-when-blocked`) says how often a session stops to ask.
- **Setup interview.** `/init` can ask four questions: autonomy, verification profile, review time budget and bot wait. It suggests `bot-triggers` for the review bots you use. Every question can be skipped, and an upgrade does not ask again; run `/init --interview` to answer later.
- **Per-skill effort.** `queue-status` and `pin-check` run at `effort: low`.
- **skill-workshop** (not vendored by `/init`):
  - New `references/model-prompting.md` with the prompting rules for this generation.
  - New style checks, now errors: CAPS emphasis, ritual re-checks, "think step by step", report-only-high-severity, hard-coded model names, turn-ending "Shall I…", and reference links with no load-when trigger.
  - New `model-upgrade` mode documents how to repeat this alignment for the next model generation.
- **Skill-load record.** A `PostToolUse` hook appends each skill load to `tmp/arsenal-metrics/skill-loads.tsv`. CANARY lines stay.

## [4.26.0] - 2026-10-01

- **Verification is bounded.** One PR had run 8 review rounds of ~40 minutes. The review loop now ends:
  - **Rounds follow the branch.** The round counter is kept per branch, so rebases and base merges no longer restart it. `review-max-rounds` now defaults to **2**: one full review, plus a follow-up only for BLOCKERs. `adversarial_review.sh emit --reset` starts over deliberately. Set the key back to 3 if you relied on it.
  - **Each round has a budget.** Every packet states it (`review-budget-min`, default 10). The reviewer runs targeted tests only; the full suite and mutation runs are reserved for the new `strict` profile.
  - **Findings come with severity and confidence.** The reviewer now reports every finding with a severity and a confidence instead of dropping the uncertain ones.
- **New `verification` profile** (`fast | balanced | strict`, default `balanced`) decides how much local checking a PR needs, given what CI and the review bots did. With CI and a bot both green on a low-risk diff, no local review round runs. `risk-paths` and `risk-lines` mark changes that always get one.
- **New `review_sources.py --pr N`.** It reports CI and each review bot as `ok`, `pending`, `skipped`, `rate-limited` or `absent`, and prints the decision line every caller now follows. It reads the bots' skip, rate-limit and pause notices, including commit statuses that read "success" on a skipped review and summary comments edited in place.
- **The bot wait ends.** After `bot-wait-min` (default 20), `--trigger` asks a silent or skipped bot once, using its `bot-triggers` entry (`"login=comment"`, or `request-reviewer` for bots requested as reviewers; a paused bot gets its resume command). After one more wait the bot is `absent` and the loop moves on. `query_pr_state.py` has new states `bot_skipped`, `bot_rate_limited` and `bot_absent`, and a `--local-review-done` flag.
- **The full test suite runs once per tree.** `fast_gate.sh --full` and `open_task_pr.sh` record a receipt keyed by tree hash and reuse it while the tree is unchanged. Green CI on the PR head counts as the merge-time evidence, except under `strict`.
- **One review procedure.** `execution`, `github`, `ship` and the worker agent all point to `references/pre-pr-review.md` (about half its old size). `ship` reuses the last verdict unless commits landed after it.

## [4.25.0] - 2026-09-30

- **Long tasks survive context compaction.** `execution`'s notes file
  (`tmp/<task-id>-notes.md`) now opens with a **Resume** block — *Decided* (do not
  reopen), *Ruled out*, *Next step* — kept current after RED, GREEN and each
  decision. A new `SessionStart` hook (matcher `compact`,
  `claude-arsenal/bin/compact_resume.sh`) prints that block and a short
  `git status` right after compaction, so the session resumes from disk rather
  than from a lossy summary. It is silent when there is no notes file from the
  last 7 days.
- **Each session resumes its own task.** A companion `PostToolUse` hook records
  which notes file each session edits (`tmp/.arsenal-sessions/<session_id>`), so
  several agents sharing one checkout each get their own notes back. Without a
  record it uses a notes file whose task id is in the branch name, and only then
  the newest one — flagged as a guess to confirm. `/init` registers it in `.claude/settings.json`; re-run `/init`
  (or let the session-start refresh do it) to pick it up.
- The core plugin's `hooks.json` now uses the standard `{matcher, hooks: [...]}`
  shape for its `SessionStart` entries.

## [4.24.1] - 2026-09-29

- **Queue workflow fixes now reach existing installs.** `/init` (and the
  session-start refresh) used to leave `.github/workflows/arsenal-queue.yml`
  alone whenever it differed from the shipped copy, which included every older
  shipped version nobody had touched, so no upstream fix ever arrived. A copy
  that matches any version arsenal has shipped is now refreshed, and init
  prints `refreshed`; commit it with the bundle update. That delivers 4.24.0's
  cheaper triggers without a manual diff. A copy you edited is still left alone.

## [4.24.0] - 2026-09-29

- **`/init` now checks the newest release.** A plugin cache frozen at an old
  version used to report "up to date" because init only compared the repo
  against itself. It now prints `ARSENAL OUTDATED: this init is X, the latest
  release is Y` with the update commands, and **refuses to set up a new repo**
  from a stale plugin unless you pass `--allow-stale`. On an existing repo it
  only warns. The lookup is one `git ls-remote`, cached for six hours; offline
  it is skipped, and `ARSENAL_UPSTREAM_CHECK=0` turns it off.
- **Hooks keep working from a subdirectory.** The skill-edit gate, its markers
  and the statusLine are now registered as
  `bash "${CLAUDE_PROJECT_DIR:-.}"/claude-arsenal/bin/…`. The old relative form
  failed on every Bash call once the session `cd`'d into a subfolder. Re-running
  `/init` (or the session-start `init.py --silent`) upgrades the entries in place.
- **The skill-edit gate no longer blocks running a skill script** in the same
  command as a heredoc that edits an unrelated file, such as editing a spec and
  then running `validate_spec.py` on it. Writing to the script is still gated.
- **Every spec and plan gets its annotatable reader.** A new hook installed by `/init` fires whenever a spec or plan is written, by `specify`, `design` or another plugin's planning skill, and tells the session the reader is stale and how to rebuild it. `ship` treats `claude-arsenal/scripts/reader_check.py branch` failing (a spec/plan changed without a reader built from its current text) as No-Go; add it to `host-gate` to run it on every PR.
- **Specs and plans are revisioned.** Headers carry `**Revision**`, `**Status**` and `**Revision log**`; notes exports are named `<project>-<spec|plan>-notes-<date>-r<N>.md`. `validate_spec.py` / `validate_plan.py` fail on a named notes file that isn't committed, and `--require-approved` must pass before `design` plans from a spec or a plan is seeded into tasks.
- `query_status.py` warns when a notes export for this project sits uncommitted in a Downloads folder (including localized and XDG ones).
- `AGENTS.md` and the CLAUDE.md block now say `specify`/`design` take precedence over other plugins' planning skills and where specs/plans live. `/init` no longer creates the unused `arsenal/specs/` and `arsenal/plans/` folders (existing ones are left alone).
- **Diagrams via drawspec.** Specs, plans and docs draw diagrams as fenced ```` ```drawspec ```` blocks (JSON describing what the diagram means); `create_reader.py` validates each and inlines it as SVG that follows the page's colours. A broken diagram fails the run and names the block. Documents without a drawspec fence don't need drawspec. `ARSENAL_DRAWSPEC` picks the command; otherwise `drawspec` on PATH, then `uvx --from git+https://github.com/nuncaeslupus/drawspec drawspec`. See `claude-arsenal/references/diagrams.md`.
- **`/init` protects your default branch.** On first run it applies GitHub branch protection: PRs required, admins included, and only checks that actually report on your PRs made required (a review bot that skips is never required). Existing protection is left alone; the result is recorded as `branch-protection` in `arsenal/config.toml`; `--no-branch-protection` opts out. It fails soft (no `gh`, no login, a plan without protection) and prints the manual steps.
- **`host-gate` and `merge-policy` are a deliberate choice.** `/init` prints `HOST-GATE UNSET` with a command suggested from your tooling and flags a `merge-policy` your CI can't satisfy; the session asks you. `host-gate = "none"` records "no gate" explicitly.
- The session protocol now says every change goes through a PR, ad hoc requests included, not only claimed queue tasks.
- `create_reader.py` names the reader of any document other than `spec.md` / `specification.md` / `plan.md` after the document (`<stem>-reader.html`, `<stem>-annotated.md`), so design docs sharing a `docs/**/specs/` folder no longer overwrite each other's reader.
- **Local gates carry CI.** New `claude-arsenal/bin/fast_gate.sh`: `preflight-gate` (fast, scoped to changed files via `$ARSENAL_CHANGED_FILES`) for every review round; `--full` (`host-gate`) once before the PR and once before merge. Review rounds no longer re-run the full suite per push. `/init` asks for a `preflight-gate`, and for a private or CI-less repo recommends `merge-policy = "always"` with a real `host-gate` and `pre-pr-review = "required"` (advice only). See `references/ci-minutes.md`, which includes a once-per-PR CI trigger block.
- **`arsenal-queue.yml` bills fewer minutes:** the keyword check skips drafts and runs on `ready_for_review`, a newer push cancels the older check, and every job has a timeout. `/init` leaves a modified installed workflow alone, so diff `.github/workflows/arsenal-queue.yml` against `claude-arsenal/workflows/arsenal-queue.yml` to pick this up.
- New `usage_report.py --actions` estimates this month's billed Actions minutes per repo and workflow (needs `gh`).
- **New `explore-idea` skill** (workflow section): talks a new or vague idea into shape before any spec exists — sizes it out loud (spike / bounded / architectural), asks one multiple-choice question at a time with pros, cons and a recommendation, drafts a research prompt instead of guessing, keeps a D-1…D-N decisions log, and hands off to `specify` only after an explicit yes. `AGENTS.md` routes idea work to it ahead of other plugins' brainstorming skills.
- `specify` takes that decisions log as input and self-reviews the spec before the reader is generated: no placeholders, contradictions or ambiguous requirements, scope fits one plan, nothing from the conversation dropped. Several skill descriptions were shortened to stay in the listing budget; their triggers are unchanged.


## [4.23.0] - 2026-09-23

- **`open_task_pr.sh <task-id> --preflight` asks whether the run would refuse,
  without paying for it.** It runs everything the real command does before its
  expensive step — the review receipt, the task gate, the shared-checkout
  guard, the issue handle, the archive — then puts the tree back and prints
  `preflight:ok`. It opens no PR, cuts no branch, writes no commit, and needs
  no `<title>`. On one measured run that was 305ms of archive plus a 2.2s task
  gate against a `host-gate` of 13m25s below it, so a refusal that used to
  arrive thirteen minutes in now arrives in seconds. It cannot tell you the
  host gate *passes* — running it is the cost being avoided — so it checks only
  that the gate's first word resolves on this machine, which is the failure a
  fresh worktree actually hits, and reports that as a note rather than a
  refusal.
- **New `preflight-gate` key in `arsenal/config.toml`.** Empty by default. A
  repo can name its own cheap check, run only under `--preflight` and on the
  same side of the archive as `host-gate` — which is the only place a gate that
  measures the repo's own task files can be checked at all. Name something that
  takes seconds; anything worth minutes belongs in `host-gate`.
- **A `Ctrl-C` during the host gate no longer strands the task file.** The
  archive moves the task into `tasks/_history/` stamped `status: merged`, which
  the selector reads as finished work. Every refusal undid that; a signal took
  none of those paths, so an interrupt during the longest step in the run left
  the task out of the queue with nothing merged. `open_task_pr.sh` now restores
  it on `INT` and `TERM`, on the real path as well as under `--preflight`.
- **Timing reports record `preflight` as its own event**, not as a short
  `task-pr`, so runs that stop before the expensive half by design do not pull
  down the p50 of the runs that open a PR.

## [4.22.0] - 2026-09-23

- **The timing report now says which part of a task-PR run cost the time.** A
  consumer's measured `task-pr` was 13m26s with 13m25s of it in a single event
  with no internal structure, so the report could say the loop was slow and not
  which step — the question it exists to answer. `open_task_pr.sh` now records
  ten phases (`review`, `task-gate`, `fetch`, `issue`, `branch`, `archive`,
  `host-gate`, `commit`, `push`, `pr`) as `task-pr:<phase>` rows, and the phase
  that was running when a refused run exits carries its exit code, so the table
  says where the loop stops as well as that it did. Nothing changed in the TSV
  schema and no new file is written.
- **Your own Makefile can record its sub-targets into the same table.**
  `host-gate` is the host's command and the bundle cannot know it is four make
  targets, so `arsenal_timing_record <event>:<target> "" <ms> <rc>` is now a
  documented entry point — `references/performance-tuning.md` § Phases has the
  three-line recipe. A `host-gate:test` row then sits in the p50/p95 table
  beside everything else, with no hand-instrumentation to redo next time.
- `references/evidence-gates.md` gains the measurement behind a common evidence
  sweep: one `python -m <module>` per module spent **6.22s** over five modules
  against **2.16s** for the same five in one process, about two thirds of it
  interpreter startup — and it scales with the module count, which parallelism
  cannot reach.
- `references/pre-pr-review.md` now says to scope the suite while mutating. One
  test file per mutation, the full suite once at the end: against a
  seven-minute suite, thirty mutations run full is three and a half hours to
  learn what four minutes would have said.

## [4.21.2] - 2026-09-22

- `arsenal_timings.py` and `references/performance-tuning.md` disagreed about
  how to read the timing table: the script's header led with p95, the reference
  led with total. Total is right — a 90-second step that runs once a day is not
  the bottleneck a 9-second one running 200 times is — and both now say so in
  the same order.
- The last row of the shapes table in `references/performance-tuning.md` was
  missing its `Read` cell, so the one shape that routes to a different section
  rendered as a row with nowhere to go.

## [4.21.1] - 2026-09-22

- `/init` now gitignores `.claude/skills/*/findings.md`. That file is
  skill-workshop's per-skill alignment report — author-local by design, pinned
  to `file:line` in whichever version of the skill was on disk when it ran. A
  re-vendor moves those lines, so a repo that ran the workshop once carried a
  stale untracked report per skill from then on. Existing repos get the entry
  on their next `/init`; nothing is deleted, and re-running the workshop
  overwrites the report in place.

## [4.21.0] - 2026-09-22

- **The loop now records how long its expensive steps take.** `gate_run.sh`,
  `open_task_pr.sh`, `adversarial_review.sh` and `merge_ready.sh` each append
  one tab-separated row — timestamp, event, label, duration, exit code, task id
  — to `tmp/arsenal-metrics/metrics.tsv`. No paths, no file contents, no diff,
  no network: the file is local, self-ignoring (`git add -A` cannot pick it up)
  and never uploaded anywhere.

- **`claude-arsenal/scripts/arsenal_timings.py` reads it back.** p50/p95/count
  by boundary ordered by total time, review rounds per change, and the slowest
  individual runs. Collection is always on and costs milliseconds; reading is
  this script, so nothing enters a context window until you ask. Run it with
  `python3 claude-arsenal/scripts/arsenal_timings.py` (`--days N`, `--days 0`
  for everything).

- **New reference: `claude-arsenal/references/performance-tuning.md`.** The
  measurement-to-remedy map — which shape in that report means the gate is run
  too often, which means one suite is the long pole, which means parallelism
  cannot help, and which means the round count rather than the round cost is
  the bill. It routes to the existing sections rather than restating them.

- **Two new environment knobs.** `ARSENAL_METRICS=off` disables collection
  entirely; `ARSENAL_METRICS_MAX_LINES` (default 5000) bounds the file.

## [4.20.0] - 2026-09-22

- **New config key `review-bots`.** Which review bots the PR review loop waits
  on is now set in `arsenal/config.toml` instead of being three vendor names
  hardcoded in `query_pr_state.py`:

  ```toml
  review-bots = ["reviewer[bot]"]
  ```

  The three that shipped before (`gemini-code-assist[bot]`,
  `coderabbitai[bot]`, `claude[bot]`) remain the default, so nothing changes
  for a repo already running one of them. `--watch-bots` still overrides per
  call.

- **A repo with no review bot should set `review-bots = []`.** Before this,
  the loop waited for a signal that was never coming and sat at `waiting`
  until someone read the JSON and worked out why. An empty list is the same
  CI-only mode as `--watch-bots ""`: green CI plus the quiet window reaches
  `ready_to_merge`, and nothing ever reports `bot_commented`. The `github`
  skill's `references/pr-review-loop.md` says what that trades away.

- The `har` skill's `--ua-suffix` worked example now uses a `yourproject/0.1`
  placeholder instead of naming a specific downstream project — copying it no
  longer makes your crawler identify itself as somebody else's.

## [4.19.1] - 2026-09-22

- `references/github-automation.md` now names a fourth reason CI reports
  nothing at all: a PR that conflicts with its base produces **no workflow
  run**, because `on: pull_request` builds `refs/pull/<n>/merge` and that ref
  cannot be computed. The three causes already documented are outages, where
  waiting is right; this one is a stale branch, where waiting is wrong and
  switching `merge-policy` to `after-review` would drop the CI half for a PR
  whose CI is fine. One `gh pr view <n> --json mergeable,mergeStateStatus`
  separates them, and the section says to run it before concluding CI is
  unavailable.
- Same section: resolve a conflict **last**, not on discovery. Merging the base
  moves the head, and every verdict and review claim on the PR is bound to a
  head — so resolving early throws away a gate run you already paid for.

## [4.19.0] - 2026-09-22

Windows + Git Bash works. Five separate faults made the merge step unreachable
there and two of the three session-start steps crash; all five are fixed.

- **A legacy console codepage no longer kills a script.** Every shipped Python
  entry point now reconfigures stdout/stderr to UTF-8 with `errors="replace"`.
  On a cp1252 console (the default on a Spanish Windows) `→` had no encoding, so
  `init.py --silent` died on the one run that mattered — the upgrade — and
  `--list-sections` died every time. A progress line now degrades to `?`.
- **`github_channel.sh --api` works under Git Bash.** The `gh` endpoint is passed
  without its leading slash, which MSYS was rewriting into a Windows path. The
  curl channel is unchanged.
- **Bundle scripts hand `python3` a path it can open.** Each resolves its own
  directory through `cygpath -m` when one exists — the identity everywhere else.
  A python.org interpreter reads `/c/Users/...` as relative to the drive root.
- **`init.py`'s refresh report no longer counts line endings as changes.** With
  `core.autocrlf=true` a byte comparison called every vendored file stale; one
  update reported 95 files refreshed of which 38 had no content change at all.
- **A vendored tree now records where it came from.** `.arsenal-manifest` carries
  a `# source: <url>` line, and `check_update.sh`'s INERT report prints that URL
  instead of `<marketplace-url>`. A non-subtree install has no `arsenal` remote
  by definition, and nothing else in the tree named upstream.
- **The skill-workshop gate stops refusing read-only tree scans.** `os.walk`,
  `os.listdir`, `os.scandir` and `glob.glob` over a skill folder join the
  `Path.rglob` forms already allowed. Writes are still refused.

## [4.18.0] - 2026-09-22

- `adversarial_review.sh emit` takes a new **`--checks <file>`** option. Point it
  at a file holding the commands you already ran against this exact tree and
  their real exit codes, and the packet carries them as a fenced section telling
  the reviewer to read them instead of re-running them. Re-running what the
  author just ran is most of what a review round costs. Nothing in the bundle
  runs the commands or invents the file — which checks your repo has is your
  repo's business. A `--checks` path that does not exist refuses (exit 2) rather
  than quietly emitting without the section.
- Guidance on what actually makes a gate slow: `-n auto` is for CPU-bound
  suites and does nothing for a suite bound by process spawns (measured flat
  from 8 to 32 workers); deliberately-slow key-derivation tests are a cost to
  budget rather than a defect to fix, and the shape that keeps both speed and
  meaning is one test at production parameters with the rest reduced.
- The rule that pays for all of it: **while editing, run only the suite covering
  what you touched; run the whole gate once, before opening the PR.** With the
  caveat that the gate itself must not learn to skip suites — the selectivity
  belongs in the editing loop, where being wrong costs a re-run and certifies
  nothing.

## [4.17.0] - 2026-09-22

- The pre-PR adversarial review is now **bounded**. Round 1 is the cold read it
  always was; from round 2 the packet carries the previous reviewer's reply
  verbatim plus only what you changed since that round read the tree, and asks
  two narrow questions instead of re-reading the whole diff. Before this, every
  round was a fresh cold read of a surface the last round's fixes had just
  grown — which has no fixed point, and ran to six and eight rounds in practice.
- New config key **`review-max-rounds`** (`arsenal/config.toml`, default `3`).
  Past the cap, `emit` refuses with exit 2 and names the three ways out: split
  the change, open the PR declaring the finding you judge a false positive, or
  raise the cap. The counter is bound to the base commit, so rebasing or
  splitting resets it.
- `emit` also refuses, with exit 2, when nothing has changed since the round
  that last read the tree. Re-running a review on an identical tree is verdict
  shopping, not a second opinion.
- `verdict` now reports which round closed, and says that `RISK` and `NOTE` do
  not earn another round.

## [4.16.0] - 2026-09-21

### Changed

- The caching guidance in `references/evidence-gates.md` no longer treats "cache
  inputs" as one unconditionally safe move. It now splits into **immutable
  inputs** (dependencies, virtualenvs, layers — free pass, keyed on a content
  hash) and **inputs derived from the tree under test** (an untracked-file
  listing, a `git status` read, a source scan). The second kind is mutable and
  is the thing being verified: a session-long snapshot goes stale the moment any
  test writes into the tree, and the test then passes against a tree that no
  longer exists. Cache it for the session only if nothing in the suite mutates
  the tree; otherwise key it on a tree digest so a mutation misses instead of
  serving a stale read.

### Added

- New subsection on fixture scope under parallel workers: a `session`-scoped
  fixture is computed **once per worker** under `pytest-xdist`, not once — eight
  workers means eight times. It also explains when caching and the long-pole
  split work against each other: with setup cost `F` and test cost `T`,
  splitting a file across `k` workers gives roughly `F + T/k`, so when `F`
  dominates, splitting that file buys almost nothing and the fix is to make `F`
  cheaper instead.

## [4.15.0] - 2026-09-21

### Added

- `references/evidence-gates.md` gains *Caching: inputs yes, outcomes no* — the
  third lever for a slow suite, with the line that keeps it honest. Caching
  inputs (dependencies, virtualenvs, compiled extensions, Docker layers) makes
  setup cheaper and changes nothing about what ran. Caching **outcomes**
  (`pytest --lf`, `testmon`, a "no relevant files changed" skip) changes the
  gate's claim from *this tree passes* to *nothing I chose to run failed* — fine
  in the edit loop, wrong in `host-gate`. Includes cache-key guidance: key on a
  content hash, and make a miss cost time rather than coverage.

## [4.14.0] - 2026-09-21

### Added

- Guidance for keeping a parallel test suite fast once `-n auto` stops paying:
  under `--dist loadfile` the slowest single file sets the suite's wall clock,
  so no worker count gets past it. `references/evidence-gates.md` gains *When one
  file is the long pole* — how to measure which file it is, where to split it
  (along the expensive fixture boundary, not across it), when `--dist load` is
  the better answer, and why a slow-by-nature test belongs in its own file.
- `execution` now says where a new test should live, not just what it should
  assert: adding to the suite's slowest file slows every future run for
  everyone.

## [4.13.2] - 2026-09-21

### Fixed

- `open_task_pr.sh` now documents why the task gate runs **before** the task
  file is archived while the repo's `host-gate` runs **after** it. The practical
  rule, new in `references/evidence-gates.md`: a task's acceptance gate must not
  depend on state the archive produces — a gate asserting "every merged task is
  archived", or one that simply reuses `host-gate`, is unsatisfiable there by
  construction and fails as `the task gate failed`, pointing at the task instead
  of at the ordering. Checks that need the final tree belong in `host-gate`.
- Corrected a stale comment in `open_task_pr.sh` that still described the host
  gate as running twice and called the surviving call a re-run. It has run once,
  over the archived tree, since 3.3.0.

## [4.13.1] - 2026-09-21

### Fixed

- **The half-upgrade remedy pointed at a script that has not shipped since
  v2.0.0.** When a subtree merge lands the bundle without refreshing the
  vendored skills, `check_update.sh` prints the steps to finish the job — and
  it opened with the `vendor-skills.sh` step, removed in v2.0.0. On any install from v2.0.0 on that file
  does not exist, so the one message a half-upgraded consumer reads started
  with a command that could not run, and `init.py` — which does the vendoring
  now, and is the whole remedy — read like its afterthought. The warning now
  names `vendor-skills.sh` only on a layout that actually has one.
- **`references/github-automation.md` promised a repair that nothing performs.**
  It said that without `.github/workflows/arsenal-queue.yml`, "the next session
  repairs stale claims and unhandled task files itself before starting". No
  step of the session protocol sweeps anything. A claim left by a session that
  died between claiming and opening its PR stays until a person removes it, and
  `query_status` — which has no PR data — counts it `claimed`, indistinguishable
  from work in progress. The reference now says so and gives the
  `queue_hooks.py sweep-claims` command to run by hand.
- **`docs/UPDATE.md` § Rolling back recommended a rollback that rolls nothing
  back.** It correctly noted that a marketplace install does not pin a version,
  then offered `/plugin marketplace remove` + `add` — which rebuilds the cache
  from the same tip of `main`. The section now splits by install: the
  clone-based and subtree installs roll back properly (with the commands), and
  the plugin install has no self-service rollback, with the stopgaps that do
  exist listed in order.

## [4.13.0] - 2026-09-21

### Fixed — a green board no longer means "nothing is outstanding"

Every issue fetch in the queue was filtered to the task label — the session-start
protocol's step 2, and the queue doctor. So `query_status.py`'s consistency check
only ever ran in one direction: it verified that each task file has an issue
handle, and could not see an issue that had no task file. An issue carrying
neither `arsenal:task` nor `arsenal:queue` was invisible to every check the queue
has, and the board reported `open 0` while real work sat open on GitHub. That is
how three findings in this repo went unnoticed for a day.

`query_status.py` takes `--open-issues <file>` — a narrow fetch of open issues
carrying neither label — and names them:

```
query_status: 2 open issue(s) are on neither the board nor the import path:
  #391, #392 — label one `arsenal:queue` to import it as a task, or
  `arsenal:task` if it already has a task file.
```

A **note**, not a problem: an issue is allowed to live outside the queue, so this
does not fail `--fail-on-problems`. But omitting the fetch now says so too —
`no --open-issues file — issues outside the board were not checked, so 'open 0'
here does not mean nothing is outstanding` — because an unasked question is not a
clean answer. Session-start step 2 in `AGENTS.md` carries the extra fetch.

## [4.12.0] - 2026-09-21

### Fixed — `task_select.py` could hang forever on an inherited stdin

It read state from stdin whenever stdin was not a terminal:
`not sys.stdin.isatty()` then `sys.stdin.read()`. But "not a terminal" is not
"data is waiting" — an open pipe whose writer never closes blocks forever, and
that is exactly what a harness hands a subprocess whose stdin it inherited.
`task_select.py` runs on the session-start path, so the failure mode was a
session that never started, with nothing on any stream to say why.

**Breaking, if you pipe state in without a flag.** `--state -` now means stdin,
the spelling `issue_for_task.py` already used:

```bash
echo '{"t-abc123": "done"}' | task_select.py --state -   # was: no flag at all
```

Omitting the flag with a non-terminal stdin no longer reads it, and says so on
stderr rather than quietly selecting as though every task were open. `--issues`
and `--state <file>` are unaffected, and every invocation in `AGENTS.md` and the
references uses one of those, so a session following the protocol sees no
change.

## [4.11.0] - 2026-09-21

### Changed — the audit hunts for simplicity, and three files say their thing once

- **`repo-audit` has a ninth hunt group: simplicity and instruction economy.**
  What costs more to read than it earns — a procedure stated three times, a
  checklist restating the step above, an enumerated list where one open
  question would do. Instructions are paid by every session that loads them,
  and length that does not earn its keep makes the agent do the job worse, not
  better. This group found real defects the other eight missed.
- **`references/issue-taxonomy.md` prompts judgment instead of listing
  patterns** — 144 lines to 59, at the density of `research-categories.md`,
  which does the same dispatch job. Naming the patterns handed a worker
  something to match instead of code to read.
- **`skill-workshop`'s SKILL.md states its gate procedure once.** It said it
  three times — "The two passes", a checklist restating the first three of
  them, and a commit-time bullet pointing back — in the skill the pre-edit
  hook requires loaded before any skill file is touched.
- **`repo-audit`'s Gotchas name the reference rather than condensing it.** Two
  of them restated sections `output-shape.md` states in full, with nothing
  signalling the fuller decision tree existed, so the short version read as
  complete.

Measured: `issue-taxonomy.md` 1755 → 880 tokens, `repo-audit/SKILL.md` 1842 →
1696, `skill-workshop/SKILL.md` 3195 → 3120. The resident tier is unchanged —
no description was touched.

## [4.10.3] - 2026-09-21

### Fixed — the docs agree with what installs, and the doc checker stops crying wolf

- **The `python` section has six skills, and both listings now say so.**
  `pin-check` declares `section: python` and installs correctly, but
  `docs/INSTALL.md`'s profile table and the scaffolded `arsenal/config.toml`
  comment both named five — and the INSTALL walkthrough told you to expect 17
  skill folders where `--profile python` produces 18. The walkthrough was
  teaching you that a correct install was wrong.
- **`ship`'s `<!-- ship: adversarial-review=skip -->` marker is documented.**
  The flag registry in `CLAUDE.md` calls itself "the full registry of flags a
  core skill honors" and did not list it.
- **`validate_markdown.py` no longer flags `<word>` as an unfilled template
  token.** `<word>` is how every CLI usage line, type parameter and HTML snippet
  in a doc names a variable, so the check fired on documented, intentional text
  — six times on the skill that ships it. `TODO`/`FIXME`/`TBD`/`XXX` are
  unambiguous and stay. If you relied on the angle-bracket check, note that a
  genuinely unfilled `<PLACEHOLDER>` in prose is no longer reported.

## [4.10.2] - 2026-09-21

### Fixed — four small correctness defects

- **`Closes: #42` now passes keyword-guard.** The colon form is GitHub's own,
  and the guard required whitespace — so it failed a PR that would have closed
  the issue correctly. (`Closes#42`, which closes nothing on GitHub either, is
  still refused.)
- **The skill validator enforces all four reserved words.** R-FM-2 reserves
  `anthropic`, `claude`, `mcp` and `agent`; the validator checked the first two,
  and its failure message named only those — so `mcp-bridge` passed, and an
  author was told the rule was narrower than it is.
- **`query_har.py --list-only` means something.** It was parsed and never read
  (listing is the default), so it existed only to be ignored. It is now the
  opposite of `--show`, and asking for both is refused instead of silently
  resolved.
- **`claim_task.sh` builds its ref payload with `json.dumps`.** A task id
  carrying a quote or a backslash produced malformed JSON; every other payload
  in the bundle was already built this way.

## [4.10.1] - 2026-09-21

### Fixed — `query_status.py --json` told a machine caller less than a human

- **Every finding now reaches both output formats.** The `--json` branch printed
  `problems` and returned; `warnings` and `notes` were rendered only after that
  return, so a duplicate task id, malformed front matter, a title collision and
  the mixed-priority-convention warning were invisible in JSON mode. JSON is the
  documented cheap-fetch path, so the automated caller — the one that cannot
  notice for itself — was the blind one: `--json --fail-on-problems` never
  learned the board had two tasks sharing an id. Both paths now emit the same
  stderr, and a test diffs them.
- **Reading the board is one pass over the issues.** Both handle-resolution
  sites rescanned the whole issue list per task. Measured on a 30-task board
  with 30 issues: 525 issue matches before, 90 after — and the old cost grew
  with tasks × issues, on the path the session-start protocol runs every
  session.

## [4.10.0] - 2026-09-21

### Fixed — three settings that did nothing now work; two that did nothing are gone

Six `arsenal/config.toml` keys scaffolded, validated and round-tripped through
`--explain` while nothing read them.

- **`import-label`, `task-label` and `claim-prefix` now change what runs.**
  `issue_import.py`, `queue_hooks.py` and `bin/claim_task.sh` each carried the
  hardcoded string the key was supposed to control. `import-label` is the one
  to check: `AGENTS.md` — resident in every session — documents it as what
  changes the import label, so a consumer who set it imported no issues and was
  told nothing. `claim-prefix` keeps its precedence: `ARSENAL_CLAIM_PREFIX`,
  then the config file, then the default.
- **`home` in the file is now refused**, naming `ARSENAL_HOME` instead. It
  names the directory that *holds* `config.toml`, so the file could never set
  it — but `--explain` echoed it back, which looked like it worked.
- **`test-discipline` and `session-end` are removed.** Both duplicated a
  `CLAUDE.md` marker that the `execution` and `session-end` skills already
  read, with different vocabulary in the `session-end` case. Setting either in
  `config.toml` never did anything; set the marker in your `CLAUDE.md` as those
  skills document. Unknown keys are ignored, so a config that still lists them
  keeps working.

Every key now names the file that reads it, and a test fails the build if a new
key arrives without one.

## [4.9.3] - 2026-09-21

### Fixed — a gate no longer picks up whatever else is installed next to `node`

`gate_run.sh` strips `$HOME`-writable directories from `PATH` so a gate running
repo-controlled code cannot pick up a trojaned tool, then re-admits the ones
holding your package manager and language runtime — those live under `$HOME`
(nvm, volta, asdf, uv, rustup), and stripping them wholesale leaves every
`pnpm test` gate at exit 127.

It re-admitted the whole **directory**, prepended ahead of `/usr/bin`. But
`~/.nvm/versions/node/vN/bin` is also where every `npm install -g` shim lands,
and anything a dependency's postinstall dropped: a file named `git`, `curl` or
`make` sitting there ran instead of the system binary, inside the gate. Only
the named tools are admitted now, as symlinks, at exactly the precedence they
had — `node` still resolves to your `node`, and nothing else in its directory
is reachable from the gate.

## [4.9.2] - 2026-09-21

### Fixed — a new section now shows up in your config, and a bad issue fetch says so

- **A section shipped after your `arsenal/config.toml` was written now appears
  in it.** `_resolve_sections` returned as soon as it found a `[skills]` table,
  skipping the write that records the full set — so a section added upstream
  after your config existed was resolved correctly on every run and never
  written down, in the one file you are told to edit. Opting in meant knowing
  the name of something never mentioned. The table is now topped up when
  something is missing from it, and left untouched (comments and all) when it
  is current.
- **A truncated issue fetch no longer prints a traceback.** `handle_sync.py`,
  `issue_import.py` and `issue_for_task.py` read the same
  `gh issue list --json …` file as `query_status.py`, which was hardened after
  a real incident — they were not. A failed fetch produces valid JSON that is
  not an issue list (`null`, `{"issues": null}`), and each of those raised a
  `TypeError` and exit 1 out of scripts that all document exit 2 for unreadable
  input. All five readers now share one function and give the same one-sentence
  refusal.

## [4.9.1] - 2026-09-21

### Fixed — `ARSENAL_HOME` now actually relocates the board

`AGENTS.md` says a host that sets `ARSENAL_HOME` relocates the whole host-owned
tree at once, and `/init` honours it. The board readers did not: `query_status.py`,
`task_select.py`, `handle_sync.py`, `issue_import.py` and `queue_hooks.py` each
carried their own `--tasks-dir` default of the literal `arsenal/tasks`, and every
canonical invocation in `AGENTS.md` and `references/worker-loop.md` omits the
flag — so the default is what runs. Set `ARSENAL_HOME=host` exactly as
documented and every board read came back `tasks: 0 — open 0, claimed 0, done 0`:
an existing queue reported as an empty one.

All five now resolve through one function, next to the `_session_dir()` that
already honoured `ARSENAL_HOME` in the same file. An explicit `--tasks-dir`
still overrides it.

## [4.9.0] - 2026-09-21

### Fixed — two destructive operations aimed at the wrong files

- **`/init` no longer deletes your own scripts out of `claude-arsenal/`.** Every
  bundle script lives in `claude-arsenal/bin/`, nothing marked the directory as
  upstream-owned, and the upgrade sweep unlinked anything it did not ship —
  on `--silent`, which runs at every session start. A `bin/my-helper.sh` you
  wrote and committed was deleted, with one line of output and no way back.
  The install now records what it wrote in `claude-arsenal/.arsenal-manifest`
  and retires only files that record covers; a file you put there is left
  alone. Upgrading from a release that wrote no manifest, there is nothing to
  consult, so an unshipped file is **moved to `claude-arsenal/.retired/`**
  rather than deleted — check that directory once after this upgrade and
  restore anything of yours from it. Commit `.arsenal-manifest`: the next
  upgrade reads it.
- **The sweep now recurses.** It skipped anything that was not a plain file at
  the top level, so a retired script under `scripts/lib/` stayed installed and
  runnable.
- **`worker_postcheck.sh` anchors to the repository root.** It ran `git reset
  --hard` and `git clean -fdq` from whatever directory the caller happened to
  be in: run from a subdirectory, `clean -fdq` left untracked files at the repo
  root, the restore then reported a failure it had caused itself, and the
  worktree-isolation sentinel — which the selector reads to size the next batch
  — was written where nothing reads it. Called from outside any repository it
  now refuses (exit 2) instead of reaching for whatever tree is nearest.

## [4.8.3] - 2026-09-21

### Fixed — a gate can no longer pass by being misread

Four ways the gate machinery reported the wrong answer about a number. The
repository's central claim is that "done" means a script checked a value, so a
gate that is misparsed is worse than no gate at all.

- **The audit and the gate disagreed about the same line.** `run_gate.py` (the
  advisory check `review` and `ship` run) and `gate_evidence.py` (the check that
  blocks PR creation) each carried their own copy of the threshold grammar, and
  the copies had drifted: one accepted scientific notation, the other did not.
  `throughput >= 1e6` was a threshold of `1,000,000` to one and `1` to the
  other, so a measured `5` passed the audit and was then refused by the gate.
  They now share one grammar, and a test holds them to it.
- **`1,000` was read as `1`.** Thousands separators are now read in full groups,
  and a malformed one like `1,5` refuses to parse rather than silently becoming
  `1`. A number matches whole or not at all.
- **A Measured cell that wasn't a measurement became a verdict.** The parser
  read the first number anywhere in the cell, so `2026-09-21: 0.85` scored as
  `2026` and **passed** a `line_coverage >= 0.90` gate. The cell must now begin
  with its number. A trailing unit still works as documented (`42ms` is 42), and
  backticks and `**bold**` are stripped; anything else reads as `UNKNOWN`, never
  as a pass.
- **A trailing note could replace the gate.** In a `gate` block, any later line
  containing an operator overwrote the real assertion — so a comment like
  "previous target was >= 2.0" became the threshold actually enforced. The first
  assertion wins.

`gate-grammar.md` documents the separator, exponent and Measured-cell rules.

## [4.8.2] - 2026-09-21

### Fixed — the duplicate-drift detector now sees the duplicates

Some scripts ship in two places, because plugin hooks don't travel with
vendored skills. `sync_duplicates.py` exists to catch the two copies going out
of sync. It was missing most of them.

- **The `.py` scan only looked inside one directory.** It scanned a single
  `--library` path while the `.sh` scan already walked the whole repository, so
  a Python pair spanning two plugins — or living outside a skill's `scripts/`
  folder, like the hook scripts — was invisible to it. Both extensions are now
  found in one repo-wide pass. In this repository that is the difference
  between seeing 4 groups and seeing 7, and the three it could not see include
  `gate_target.py`, the parser the skill-edit gate depends on.
- **`--apply` claimed every sibling was missing.** It resolved the declared
  paths against the wrong base, building a directory that cannot exist, so its
  cross-check found nothing and said so — while looking at a tree where every
  file was present. Alarming, and entirely false.
- **Paths now print consistently** in a drift report: one file used to appear
  absolute and its sibling relative, in the same three-line message.
- **A placeholder header is no longer read as a real declaration.** The script
  template's example header uses `<plugin>`-style placeholders; those are
  examples, not paths.

The check also now runs in CI. It existed but was wired into nothing, which is
why a security fix that reached only one copy of a hook went unnoticed for
months.

## [4.8.1] - 2026-09-21

### Fixed — the skill-edit gate, the quota guard, and a dependency that was silently dropped

Four fixes found by running `repo-audit` against this repository itself. Each
one is a check that was quietly not doing its job.

- **The skill-edit gate saw only one spelling of a path.** `plugins//core/…`,
  `plugins/core/./…` and `plugins/core/tmp/../…` all name the same file, but
  only the plain form was recognised — so a doubled slash walked straight
  through the gate. Destinations are now compared lexically normalised. The
  gate also modelled 13 write tools and treated everything else as harmless:
  `rsync`, `curl -o`, `curl --output=`, `wget -O` and `wget --output-document`
  now count as writes.
- **The copy of that gate `/init` installs failed open.** When its analyser
  crashed, the vendored hook swallowed the error and read the empty result as
  "nothing to gate", allowing the write — while the canonical copy had been
  fixed to refuse. Since vendoring is the only path a cloud session has, the
  shipped gate was the broken one. Both copies now fail closed, and the
  regression test runs against **both**, so the next divergence fails CI
  instead of shipping.
- **The quota guard passed a round at 97%.** `budget_check.sh` read
  `used_percentage` only from the `five_hour`/`seven_day` windows, though it
  already read `status` from the top level. A surface reporting both flat had
  its percentage ignored, and the guard said "no used_percentage on this
  surface" about a document containing exactly that. Its dispatch-round counter
  also kept a single slot, so two sessions sharing a checkout reset each other
  to 1 and `ARSENAL_MAX_ITERATIONS` never tripped; counts are now per session.
- **A task written `deps: t-abc12345` ran before its prerequisite.** Without
  brackets the value parses as a scalar, which was dropped to `[]` — read as
  "no dependencies", so the task was offered as unblocked. It is now normalised
  the same way `requires:` and `tags:` already were. Relatedly, a task blocked
  by a **cancelled** dependency now says so instead of silently disappearing
  from the board forever.

## [4.8.0] - 2026-09-21

### Added — repo-audit asks which model runs its worker agents

`repo-audit`'s Orient pass now asks once, per run (`AskUserQuestion`) which
model — Sonnet, Opus, Haiku, or Fable — the Understand/Hunt/Verify fan-out
workers should use, instead of silently assuming one. A wide fan-out is a
real cost/thoroughness tradeoff; it's now the user's call every time, not a
default baked into the skill. Falls back to Sonnet for an unattended run
with no one to ask. The orchestrating model itself is unchanged — still
whichever model the session is already running, set before invoking the
skill, not something this flag touches.

## [4.7.0] - 2026-09-21

### Added — `explain-repo`, and `repo-audit` gets a real bug hunt

`repo-audit` grows a fifth pass: `references/issue-taxonomy.md` — correctness,
concurrency, security (OWASP-informed), error handling, API design, dead
code/performance, tests, conventions — dispatched one worker per group
alongside the existing architecture-understanding pass, every candidate
independently verified before it's trusted. A confirmed finding no longer
just becomes a ledger row: `create_task.py` (duplicated from `queue-add`,
kept in sync via `sync_duplicates.py`) queues it as a properly-gated arsenal
task when the target repo has one, falling back to a GitHub issue or the
ledger. Never an unrequested fix — queuing is the actionable-but-reviewable
middle ground.

New skill `explain-repo`, same plugin: turns a `repo-audit` analysis into
whichever human document is actually needed — a pitch, a deep-dive,
interview-prep Q&A, an onboarding guide, or a status brief — always for the
person who asked, never committed to the target repo, and says so plainly.
`create_artifact.py` moves from repo-audit-specific to shared infrastructure
between the two skills (duplicated, kept in sync the same way).

`/plugin install repo-audit@claude-arsenal` — unchanged install, two skills
now.

## [4.6.1] - 2026-09-20

### Fixed — `make lint` now actually checks formatting

`ruff format --check` was in the pre-commit hook's own description as
"matches what CI's `make lint` runs" — but `make lint` never called it,
only `ruff check` and `mypy`. Formatting drift was invisible to CI and to
anyone who hadn't opted into pre-commit locally; ~37 files had quietly
drifted from `ruff format`'s canonical layout as a result. `make lint`
now runs `ruff format --check` first, and every vendored script is
reformatted to match. No behavior change — this is layout only.

## [4.6.0] - 2026-09-20

### Added — a third plugin, `repo-audit`: analyze and improve any repository (#394)

Separate from `core`'s engineering-workflow pitch on purpose: point the
`repo-audit` skill at any repository and it runs a four-pass audit —
orient, fan out parallel research across the repo's major subsystems, an
adversarial pass that tries to falsify what the first pass found, then
independent re-verification of every numeric claim before it repeats one —
and produces a findings-backed write-up plus a ledger of fixes applied
directly versus items flagged for a maintainer's call. Ships three scripts:
`create_artifact.py` renders the write-up as a themed, responsive HTML
artifact from structured JSON, so a run isn't re-deriving the same several
hundred lines of CSS every time; `validate_findings.py` and
`validate_markdown.py` sanity-check the ledger and any proposed doc changes
before they go out. `/plugin install repo-audit@claude-arsenal` adds it
independently of `core`.

## [4.5.0] - 2026-09-20

### Added — `budget_check.sh` reports sibling sessions sharing the window (#383)

`models.workers` and the per-session dispatch cap fixed the two ways the wrong
model or an unbounded loop burned quota; neither touches a third: nine
concurrent orchestrators each saw a *compliant per-session* budget and shared
one five-hour window between them, because nothing compared notes across
sessions. There is no API for "how many sessions are live", so this reads the
next-best signal already on disk — `~/.claude/projects/<project>/<session
id>.jsonl`, one transcript file per top-level session — and reports, on every
call, how many were modified in the last `ARSENAL_CONCURRENCY_WINDOW_MIN`
minutes (default 15; `0` disables) under a session id other than its own.

Report, not gate: the exit code is untouched, because recent activity is not
proof a session is still running and turning it into a stop would invent a
threshold nobody asked for. CLI-only in practice — a cloud session's container
has no sibling transcripts to find, so it stays silent there, same as a
healthy single-session run.

### Added — parallel test execution documented as host-gate's default shape (#387)

`host-gate` stays entirely host-defined, but a slow serial suite is now paid
for on every worker (`ARSENAL_MAX_WORKERS`, default 2) and every verification
round, not once. `references/evidence-gates.md` now documents the shape a
`test` target should default to: `-n auto` in the Makefile recipe (never in
`addopts`, which also fires on the single-file gate calls most tasks use) and
`--dist loadfile` the other way around (safe in `addopts`, inert without
`-n`). Measured 3x-5x on one host repo; expect real cross-worker races to
surface, and fix them rather than back out the parallelism.

## [4.4.0] - 2026-09-15

### Added — a stalled fleet now has somewhere to look (#382)

Eight sessions each opened a PR, the machine went down mid-cycle, and three days later
seven were still open: CI green, claims still held, issues still assigned, every ledger
reading "in progress". Nothing was. Three new pieces, all vendored by `/init`:

- **`bin/merge_ready.sh <pr>`** — the three merge conditions, asked once. It reads your
  `merge-policy`, fetches the PR, its check runs **for the head SHA**, and its reviews,
  and exits `0` ready, `1` not (the table says what is missing), `3` when the policy is
  `never`. `--body` prints the merge commit body. Use it instead of writing the query
  again: the two mistakes a hand-written `gh ... --jq` makes are reading *no checks at
  all* as green — which merges the queue during a runner outage — and reading a review's
  summary state when the finding list is the open threads.
- **`scripts/pr_audit.py`** — the fleet view. One row per open PR (head SHA, age, CI,
  review, and the one next action), plus the claim refs with no open PR behind them. It
  makes no network calls: hand it the payload GitHub already returned, so the report
  still works on a surface without `gh`, which is exactly when a fleet is in trouble.
- **`bin/claim_review.sh <pr> <head-sha>`** — a compare-and-swap for review work, the
  same primitive as `claim_task.sh` over `arsenal/reviews/<pr>-<sha>`. Two sessions used
  to be able to dispatch a second reader at the same head. **The head SHA is part of the
  key**: a task is claimed once, a review is about one tree, so the next push is a new
  unit of work rather than something the first reader's claim blocks forever.

Conditions are evaluated against the head SHA throughout. A check run that reported on
the previous push is evidence about the previous push, and a review of an earlier tree is
not a review of this one.

### Added — `pin-check`, the skill that asks whether a gate can move (#384)

A new skill in the `python` section, beside `mutmut-report` and `coverage-gaps`. Three
questions, three budgets, and consumers keep collapsing them: `coverage-gaps` asks
whether a line ran, `mutmut-report` scores thousands of automatic mutants over CPU-hours,
and `pin-check` asks *this claim says a case pins it — does it?* in seconds.

```bash
python3 .claude/skills/pin-check/scripts/pin_check.py \
    --source config/schedule.yaml --replace "asynchronous" --with "async" \
    --test tests/test_cue_audit.py
# → NOT PINNED — target present (1×), mutated, scoped test still green.
```

Doing this by hand is what it replaces, because three of its four failure modes are
invisible to a person and each produces a confident wrong answer: stale `.pyc` bytecode
(validated on mtime at one-second resolution, so an equal-length revert inside the same
second runs the mutated bytecode), a module already imported and therefore never re-read,
a replacement that matched nothing and whose green test reads exactly like "not pinned",
and a killed session leaving a mutated tree the next session reads as the code. Exit
codes distinguish `PINNED` (0), `NOT PINNED` (1), `NOT MUTATED` (3) and `INCONCLUSIVE`
(4) — the last for a scoped test that was already red, which goes red under any mutation
and proves nothing.

`AGENTS.md` now points at `merge_ready.sh` for the merge step;
`references/github-automation.md`, `references/claiming-internals.md` and
`references/evidence-gates.md` carry the detail.

## [4.3.0] - 2026-09-15

### Added — `context-window`, the lever that decides what a fleet costs (#383)

A turn is charged for the context it carries, not for what it writes. Nine
sessions in one day read 438M tokens to write 1.3M, and a host that raises its
auto-compact window to "avoid filling up" raises the floor every turn pays.
Those same turns replayed at lower caps: 500k → 453M, 300k → 387M, 200k → 287M,
120k → 186M.

`context-window` in `arsenal/config.toml` is now written by `/init` into your
`.claude/settings.json` as `autoCompactWindow`:

```toml
context-window = 200000
```

**It is off by default (`0`) and an upgrade changes nothing for you.** The right
value is a judgement about your repo — set too low, sessions compact mid-task
and re-read what they dropped, paying in turns instead of context. Accepted
range is 100000–1000000 (Claude Code's own bounds); anything else is refused at
read time rather than written into a settings file that would silently ignore
it. With the key unset, an `autoCompactWindow` you set by hand is left alone.

### Added — `scripts/usage_report.py`, so the number is measured (#383)

None of the above was visible until transcripts were parsed by hand.

```
python3 claude-arsenal/scripts/usage_report.py --since 2026-09-14
```

Reports turns, average and peak context, output and cache-read per session and
**per model**, plus the busiest hour. Dispatched subagent turns are included and
called out separately — they live a directory deeper than the session transcript
and are the direct evidence of what model your workers actually ran as, which is
the question `models.workers` alone cannot answer.

`budget_check.sh` still answers "may I dispatch?" from remaining quota; this
answers "where did the window go?" after the fact.

## [4.2.0] - 2026-09-09

### Fixed — `models.workers` reached nothing on cloud surfaces (#379)

The orchestrator carried the configured worker model to the fleet by exporting
`CLAUDE_CODE_SUBAGENT_MODEL` in a Bash call. **On Claude Code on the web every
Bash tool call gets a fresh shell**, so that export died with the call that made
it and the setting governed nothing there. It worked on a laptop, which is how
it survived this long.

Two things made the failure silent instead of loud, and both pushed toward the
*expensive* model: an explicit `model:` on a dispatch outranks the env var, and
omitting `model:` does **not** fall back to `models.workers` — a subagent with
no model named inherits the **parent's**. So an Opus orchestrator dispatched
Opus workers by default while `models.workers` said `sonnet`. In one overnight
run downstream that was ~20 agents on the wrong model, 3–4M tokens, and a
5-hour limit exhausted twice.

**The protocol now passes the resolved model as the dispatch's own `model`
argument**, keeping the export only as belt-and-braces where shells persist.
`agents/worker.md`'s launch block moves `model:` out of `env:` accordingly, and
`references/worker-loop.md` records that cloud Bash calls share no shell state
— the same assumption was load-bearing for the `CLAUDE_CODE_DISABLE_1M_CONTEXT`
and `CLAUDE_CODE_DISABLE_FAST_MODE` credit guards beside it.

Nothing in a session can observe which model a subagent actually ran on, and the
token report arrives after the spend, so there is no gate for this — making the
correct path the only path is the guard.

### Added — `models.reviewers` (#380)

The bundle shipped two agent roles and let you configure one of them.
`agents/reviewer.md` named no model at all, so a consumer who wanted cheap
implementers and a strong reviewer — the natural split, since the reviewer does
the spec-derivation and mutation work — had no way to say so. Writing
`reviewers = "opus"` anyway was worse than the gap: unknown keys are tolerated
on read, so it parsed fine, sat in `config.toml` looking configured, and reached
nothing.

```toml
[models]
workers   = "sonnet"
reviewers = "opus"    # empty (the default) = no separate opinion, use workers
```

`agents/reviewer.md` gains a **Launch parameters** block resolving it, and
`references/pre-pr-review.md` says to dispatch with it. Scoped to the pre-PR
adversarial reviewer that `bin/adversarial_review.sh` spawns from a case file —
the only reviewer role with an agent definition upstream. Empty means fall back
to `models.workers`, so a repo that never sets it is unaffected by this release.


## [4.1.0] - 2026-09-06

Three ways the queue could hand out one piece of work twice, or accumulate
state nobody could clear — all three found by a consumer running the board from
Claude Code on the web.

### Fixed

- **An issue is now paired to its task by an `arsenal-id:<id>` label**, not by
  its title. The `arsenal-task:` marker is in the issue *body*, and the
  session-start fetch deliberately does not ask for bodies (~1.2k tokens
  instead of ~9k on a 40-issue board) — so the only pairing left was the title,
  and renaming a task unpaired it. `handle_sync.py` then reported not "I cannot
  find this task's issue" but "this task has no issue", which is the sentence a
  caller acts on by opening a second one.

  Nothing is required of you: the scheduled `sync-handles` job stamps the label
  onto every existing handle from its body marker, and new handles are created
  with it. If you create handles by hand, add the label the row now lists
  alongside `arsenal:task`. `handle_sync.py` also says how many issues it could
  only match by title, so you can see the backlog shrink.

- **`issue_import.py` is idempotent, as it always claimed to be.** The task id
  was four random bytes, so the dry run announced an id `--apply` would not use,
  and running `--apply` twice — the ordinary reaction to a first run whose
  remote half never got applied — wrote a *second* task file for the same issue.
  Two task files are one piece of work dispatched twice, holding two claims that
  cannot collide because the ids differ. The id is now derived from the issue's
  URL, so the dry run tells the truth and a re-run writes nothing.

  Ids minted before this update are unaffected; nothing is renamed.

### Added

- **`queue_hooks.py prune-claims`**, wired into the scheduled `sweep-claims`
  job, deletes the claim refs of tasks archived as `done` or `merged`. Claim
  refs accumulate roughly one per task ever claimed, and the only remedy on
  offer was "prune them from a CLI session" — which a session on the web cannot
  do at all, because its proxy refuses every ref write by git and by API alike.
  Live tasks' refs are never touched: the ref is the lock.

  **Re-vendor `.github/workflows/arsenal-queue.yml`** (re-running `/init` does
  it) — that job now needs `contents: write` to delete a ref.

## [4.0.0] - 2026-09-06

### Changed — action required

- **The `continue` skill is now `queue-next`, invoked as `/queue-next`.**
  `/continue` is a built-in Claude Code slash command, so typing it got you the
  built-in and never the queue loop — the collision made the command
  unusable by its documented name. The new name also puts it in the
  `queue-*` family alongside `queue-add` and `queue-status`.

  Everything else about it is unchanged: same scoping tokens, same worker
  loop, same `argument-hint`. `/init` prunes skills it no longer ships, so
  updating removes `continue/` and installs `queue-next/` for you — but
  **anything of yours that names the skill needs the new one**: routines or
  cron jobs whose prompt is `/continue`, CI steps that pass `/continue …`,
  and your own `CLAUDE.md` or docs that tell people to type it.

  Natural-language triggers are untouched — "continue", "resume", "run the
  workers" and `WORKSPACE: Continue` still load the skill.

## [3.9.1] - 2026-09-04

Three things a consumer's review caught in 3.9.0, all confirmed against the
source before being fixed here.

- **A pristine shadow handover was never retired.** `_handover_is_untouched()`
  strips comments, headings and empty bullets, then treats any surviving prose as
  something a session wrote. `HANDOVER_TEMPLATE`'s own "How to continue" steps are
  ordinary numbered prose, so the one file guaranteed to be untouched was the one
  it called touched: `_retire_shadow_handover()` kept the legacy shadow and
  reported it to the user as content to merge by hand. The stock template is now
  matched exactly, before the heuristic runs.
- **`github-automation.md` overstated the crash guarantee.** "A session that ends
  abruptly leaves the queue correct anyway" is true for a merged or abandoned PR
  and false for the window between claiming and opening one — that claim is
  released by the daily `sweep-claims --max-age-hours 24`, so the queue is
  self-correcting rather than immediately correct, and by nothing at all when
  `arsenal-queue.yml` is not installed. The window is now named where the
  guarantee is made.
- **`worker-loop.md` steps 5 and 6 contradicted 3.9.0's own separate-session
  branch.** Step 3 says a separate-session worker never returns through
  `worker_postcheck.sh`; step 5 then said to spawn Task-tool subagents and step 6
  to postcheck each returned worker. Both steps now branch by dispatch mode, so
  the mode 3.9.0 introduced can actually be followed to the end.

## [3.9.0] - 2026-09-04

### A spawned worker is no longer told to do what it cannot

A session spawned by another carries **no `mcp__*` tools** — true both for a
routine firing a fresh session and for a directly created child, and neither
warns you. Where REST is also refused, such a worker's only channel to GitHub is
plain `git`: enough to fetch, read claim refs and push a branch; not enough to
read issues, claim, open a PR or merge.

The protocol block `/init` injects into your `CLAUDE.md` told **every** session
to fetch the board, claim, and open PRs — and a spawned child reads that file
like any other session. Three workers blocked on exactly this. It now opens by
naming the spawned case and sending it straight to its task, and its dispatch
step says to pass the repository and `ARSENAL_TASK_ISSUE` explicitly.

`agents/worker.md` says how far a worker gets on each surface. As a Task-tool
subagent it opens the PR itself; as a separate session its last step is the push,
and `open_task_pr.sh` printing `branch:<name>` is **a completed handoff, not a
failure**.

`references/orchestrator-tick.md` gains a dispatch section with the three things
every dispatch must carry, each a measured failure rather than a precaution:

1. **The repository, explicitly.** Of four workers dispatched without it, two got
   containers with no sources — and the create call returned **201** for all
   four, so nothing in the response told them apart.
2. **`ARSENAL_TASK_ISSUE`.** The helper resolves the issue over the API the
   worker does not have, and refuses before touching git. Do not work around it
   with `ARSENAL_ALLOW_UNLINKED_PR=1` — that opens a PR that completes no task.
3. **Evidence the assignment is real** — the issue number, the claim ref
   (`arsenal/claims/<id>`, readable over `git ls-remote`), the dispatching
   session id. A worker's first turn is now routinely an unfamiliar sender
   telling it to edit files; refusing that is correct behaviour, which is
   precisely why it cannot be the signal you rely on.

### `record_isolation.sh` — breaking the batch-of-one deadlock

**New:** `claude-arsenal/bin/record_isolation.sh <mechanism>`.

`available` had exactly one writer: `worker_postcheck.sh`, observing a returned
worker's toplevel. A worker dispatched as a separate session never returns
through it, so the sentinel stayed `unknown` forever and `task_select.py` clamped
every batch to **one task, permanently** — on the surface where separate sessions
are the only shape that works. The only way out was `--no-isolation-clamp`, which
disables the check rather than satisfying it.

Run `record_isolation.sh separate-session` after dispatching that way. It records
that isolation follows from **how you dispatched** — a container per worker
cannot share a tree — rather than from a path comparison.

That distinction matters: the obvious fix, feeding a cross-container path to
`worker_postcheck.sh`, **inverts**. Its check is `worker_root != own_root`, and
two containers routinely both check out at `/home/user/<repo>` — identical paths
would read as "the worker ran in my tree" at the moment isolation is most
complete.

The vocabulary is closed (`separate-session`, `separate-clone`); an unknown
mechanism is refused, not recorded, because this file gates a safety clamp.
Provenance is written to `worktree_isolation.why` (machine-local, gitignored by
`/init`). Do **not** use it for Task-tool subagents — `worker_postcheck.sh`
measures that case correctly, and a measurement beats an attestation.

> **Judgement call worth reviewing.** That a separate container structurally
> guarantees isolation is an assumption this script cannot verify from inside;
> it is an attestation by the orchestrator about how it dispatched. The closed
> vocabulary is what bounds it.

## [3.8.2] - 2026-09-04

### `AGENTS.md` is 201 tokens lighter, with nothing removed

`AGENTS.md` sits in context on **every turn of every session**, so what it costs
is paid forever by every consumer. Three changes landed in it in one day and the
resident budget fell to 33 tokens of headroom against the 5000 cap — enough that
the next addition, whatever it was, would have failed CI.

Four passages moved or compressed. Every **instruction** stays resident; only the
reasoning behind them moved:

- The bundle-refresh guard keeps "if (a) reported `VENDORED SKILL BEHIND BUNDLE`,
  skip (b)" and drops the paragraph explaining the guard's history.
- The issue-fetch step keeps the field list and the ~9k-vs-~1.2k numbers, and
  drops the explanation of why no script reads a body.
- **Why the `arsenal-task:` marker must be visible text and never an HTML
  comment** is now in `references/queue-seeding.md`, under its own heading. Same
  rule, more room to say what a stripped id actually costs you.
- **Why ending a session is reporting and not repair** is now in
  `references/github-automation.md`, next to the transitions that make it true.
  It carries the rule worth keeping: if you find yourself writing "remember to X
  before the session ends", X belongs in a workflow or a script, not a protocol.

Nothing a session is told to do has changed. If you have forked `AGENTS.md`,
this is a text-only merge.

Headroom is back to 234 tokens.

## [3.8.1] - 2026-09-04

- **The evidence-gate reference now documents the placeholder exception.** 3.7.0
  stated the rule flatly — *"a task's own PR can never amend its own acceptance
  gate"* — but `gate_run.sh` has always had a bootstrap case: when the default
  branch still carries the `# arsenal:gate-placeholder` command, it runs the
  working copy's instead, and says so on stderr. A worker reading only the
  reference had two ways to get it wrong: preserve the placeholder to look
  compliant, or treat the "running the working copy's instead" line as a bug.
  The rule now says *already real* where it meant it, names the exception, and
  says why it is not a relaxation — a placeholder asserts nothing, so there is no
  criterion for a branch to weaken, and the gate block's threshold is still read
  from the default branch either way.

## [3.8.0] - 2026-09-04

### New reference: `orchestrator-tick.md`

`worker-loop.md` documents how one task gets implemented. The other half — what
the session that dispatches, reviews and merges actually does — had no written
counterpart, so in practice it lived in the prompt text of whatever routine was
driving the fleet.

That is a bad place for a contract: not in any repository, so not reviewed, not
versioned, not diffable, retyped by hand into each successive trigger until the
copies drift, and gone when the routine is deleted.

The new reference covers one tick's ordered steps, where a tick defers to the
owner instead of deciding, and three things worth knowing before building a fleet:

- **The merge preconditions, restated at the moment they are applied** — not held,
  every thread resolved, and *the orchestrator ran the host gate itself and saw
  exit 0*. A worker reporting its own gate passed is a claim, not evidence. This
  is the precondition most likely to be quietly dropped when nobody is watching.
- **Report at most six lines, or "no change".** An hourly loop that narrates itself
  spends its context on its own transcript and eventually runs out mid-tick.
- **A tick is not portable.** A trigger that spawns a fresh session per firing
  stores no MCP connectors, so that session has no channel to the GitHub API and
  blocks on the tick's first step. Binding to an already-open session is the only
  shape that works — and the design that looks better fails an hour later rather
  than immediately.

It also states the boundary that keeps people from trying to move the loop into
CI: `arsenal-queue.yml` can run board hygiene on a schedule, but an Actions job
has no Claude session in it and can never do the reviewing or merging half.

Arsenal still ships no scheduler. The reference owns what a tick does; your
surface owns when it happens.

## [3.7.1] - 2026-09-04

- **Four helpers that aborted or lied instead of degrading.** All four share a
  shape: the guard already exists a line away, and the path that skipped it is
  the one nobody exercises.
  - `open_task_pr.sh` took an option as a value. `--title --body-file x.md`
    satisfies the `$# -ge 2` count check, so `TITLE` became `--body-file` and
    `x.md` fell through to positional — the #352 subject bug, reachable again
    through the option form added to fix it, and the comment above the parser
    already claimed it could not happen. The subject survives a squash, so a
    wrong one is only fixable by rewriting shared history. Empty and `-`-leading
    values are now rejected in both the spaced and `=` forms.
  - `gate_run.sh` caught only `OSError` around a `read_text`. `UnicodeDecodeError`
    derives from `ValueError`, so a non-UTF-8 task file escaped as a traceback —
    out of a branch that only prints a diagnostic, after the gate decision was
    already made.
  - `arsenal_migrate.py` raised its merge-policy `MigrateError` from the config
    block, which runs after the task files, the history files and
    `_migrated-history.md` are on disk. `main()` then printed `nothing was
    written` over a half-migrated tree. The check moves to pre-flight, beside
    the payload resolution that is there for exactly this reason.
  - `init.py` left one `shadow.unlink()` unguarded while the read either side of
    it and the following `rmdir` were both non-fatal. A read-only checkout or a
    permission ended `init_base` before `_vendor_skills`, `_register_gate_hook`
    and `_inject_claude_md` ran — a half-installed repo, to tidy up a file
    nothing reads.

  `vendored_robustness_test.sh` pins all four; every one of its gates fails
  against 3.6.3.
## [3.7.0] - 2026-09-04

### The quota guard now stops on a refusal, not only on a percentage

`budget_check.sh` accepts a second shape in `rate_limits.json`: a `status` field,
nested under a window or flat, exactly as `get_session` returns it. Any value
other than `"allowed"` stops the loop (exit 3); `"allowed"` passes and is
reported as a pass rather than as missing data.

This is what makes the guard reachable on a cloud session at all. That surface
runs no statusLine, so it has no `used_percentage` to give — a document carrying
only what it *can* supply used to hit the "fields absent" fail-open and guard
nothing, on the one surface that runs unattended fleets.

`ARSENAL_QUOTA_STOP_PCT` does **not** apply to the refusal check and cannot
disable it. A percentage is a forecast about the next call; a refusal is a fact
already established about one that was made. Do not translate a refusal into a
synthesised `"used_percentage": 100` — `ARSENAL_QUOTA_STOP_PCT=101` would then
silently switch off a guard reporting a wall already hit.

### A task's gate is fixed for the life of the task — now stated, not discovered

The gate is read from the default branch, so a task's own PR can never amend its
own acceptance criteria. That property is deliberate (a worker whose branch
supplies the gate it is held to is certifying itself) but it was written down
only in the source, and several task texts invited exactly the amendment it
refuses — costing a worker a whole session chasing a missing test that was really
a gate it had edited and could not use.

Now in `AGENTS.md` § Task format, with the full rule, the wording to avoid, and
the recovery in `references/evidence-gates.md`. **Do not write a task that tells
its implementer to update the gate block in the same diff.** A gate that needs to
change is a board-side edit merged first, or a new task.

The gate-only soft-fail some hosts have asked for is deliberately *not* shipped:
letting a branch weaken its own acceptance criteria mid-flight reopens the
self-certification hole the default-branch read exists to close.

### A merged task PR with no issue handle now archives its task file

`queue_hooks.py pr-closed` reconciles a merged task PR even when the task has no
issue handle yet. The keyword guard passes such a PR on the stated grounds that
pr-closed "still reconciles on merge" — and it did not: the work merged, the task
file stayed live, and the next `handle_sync.py` proposed a fresh handle for work
that had already landed.

With no handle there is no issue to close, and none is invented — the archive is
the whole of the reconciliation, and it is reported as such.

### Why `/init` does not seed `permissions.allow`

`references/github-automation.md` now explains why an unattended run stops on a
permission prompt, and why a seeded permissions block is not the fix — it would
look like one while changing nothing.

Short version: the `mcp__github__*` calls the protocol makes already pass
silently (the account's GitHub connector grants them, outside `settings.json`).
The session tools that *do* prompt cannot be pre-approved from a committed file
at all, for either of two reasons the doc tells you how to distinguish. The one
thing that measurably helps is dispatching **one `create_session` per message** —
a batch of them reads as a single refusable action and is refused as one.

## [3.6.3] - 2026-09-04

- **A non-subtree install no longer reads as a broken one.** With no `arsenal`
  remote and no subtree merge, `check_update.sh` said the bundle "cannot be
  updated by merge even once the remote is added" and told you to add a remote.
  Both facts are true and the advice is wrong for that reader: nothing about a
  plugin install was ever going to update by merge, and the remote buys drift
  reporting only. Since session-start step 0(a) runs this every session and says
  to surface what it reports, a consumer got the same false alarm forever — one
  spent a session concluding the bundle was unmaintainable and looking for a way
  to graft a subtree on. The message now names the install mode, says INERT is
  correct here, and gives both update routes that land in this git state: the
  plugin's `/plugin update` + `/init`, and the clone-based `init.py` that
  `docs/INSTALL.md` documents for cloud, CI and fresh containers, which has no
  plugin to update at all. `AGENTS.md` step 0(a) and `UPDATE.md`'s new "Which
  install do you have?" table say the same, so the alarm is not re-raised each
  session and nobody is sent after a plugin they do not have.
- **`UPDATE.md` no longer credits the wrong mechanism for keeping a fork.**
  "Claude Code resolves skills with project-level precedence, so your fork takes
  over" describes which skill *loads*; what decides which files survive an
  upgrade is the `.arsenal-vendored` marker — `/init` `rmtree`s a skill folder
  that carries one and prints `left alone` for one that does not. Copying a
  skill from the cache is safe because the marketplace does not ship the marker,
  but copying one from another project's `.claude/skills/` carries it, and the
  next `/init` deleted that fork in silence. The customisation steps now begin
  by removing the marker and name the receipt line to look for.
- `UPDATE.md` gains **"Which install do you have?"** — the one-line probe
  (`_is_subtree`'s own `--basic-regexp` test, so a consumer with
  `grep.patternType=fixed` is not told a subtree is a plugin) and a table of how
  each mode updates and what `check_update.sh` is expected to say for it.

## [3.6.2] - 2026-09-04

- **The quota guard's override is documented.** `ARSENAL_RATE_LIMITS_FILE`
  shipped working and named in no markdown file in the repo. It matters most on
  a cloud session — Claude Code on the web, the apps, a routine — which never
  runs a statusLine, so `rate_limits.json` is never written and the
  percentage guard fails open on every round. That is the surface most likely
  to be running an unattended fleet, and the one where `ARSENAL_MAX_ITERATIONS`
  is not a backstop but the entire ceiling. `references/quota-governance.md`
  now says so, gives the exact JSON shape `budget_check.sh` accepts, and warns
  that a document describing exhaustion in any other vocabulary (a
  `get_session` `{"status": "..."}` response, say) fails open **silently** —
  the guard stays inert while looking configured. Also listed in the
  tuning-knobs table. (#329, first half)

## [3.6.1] - 2026-09-04

- **The skill-edit gate no longer opens when its own analyser breaks.** Any
  crash inside `gate_target.py` produced an empty target, which the hook read as
  "nothing to gate" and allowed — silently, with nothing in the transcript to
  say the check had stopped running. A crash now refuses the call and prints
  why. An unparseable payload is still allowed: that is a handled case, not a
  crash. (#347, in part)
- **An unusable evidence gate is no longer scored as a failed one.** A JSON
  number too large for a float raised `OverflowError` out of `gate_evidence.py`,
  and the traceback's exit 1 is `gate_run.sh`'s *assertion failed* — so a gate
  that could not be scored was reported as a gate the work had failed. It now
  exits 2 ("declared but unusable"), which existed for exactly this. (#346)
- **A migration will not write a task with no gate.** `arsenal_migrate.py`
  turned a payload that was missing, or that pointed outside the queue
  directory, into an empty task body carrying the `<!-- No gate was recorded -->`
  fallback — then summarised the run as a success and exited 0, so the operator
  deleted the legacy queue and the gate was gone. Every payload is now resolved
  before the first file is written, and an unreadable one exits 2 having
  written nothing. (#346)
- `arsenal_migrate.py` also refuses to write a `config.toml` whose reported
  merge policy is not the one in the file — the substitution was never checked,
  so a template whose spacing had drifted was reported as set and written
  unchanged. (#346)
- **`gate_run.sh` says when your branch's gate edit was ignored.** A task's gate
  comes from the default branch by design; a branch that edits it had that edit
  discarded in silence, so the gate failed naming a symbol the implementation
  had renamed and the worker debugged its own code. It now says which command
  ran and why. Its other diagnostic said the task file was "not on disk" when it
  usually is — corrected to "preferred over the working copy". (#349, in part)
- `pr-review-loop.md` pointed at an upstream path that does not exist in a
  consumer's tree; it now names the vendored
  `claude-arsenal/references/github-automation.md`. (#346)

## [3.6.0] - 2026-09-04

- **Security: a migration no longer executes your skills.** `arsenal_migrate.py`
  read `init.py`'s config template by *importing* every `init.py` it could glob
  under `.claude/skills/*/scripts/`, running that file's top level — so any
  skill in the tree could run arbitrary code during a migration, and it happened
  on the **dry run** too, because `--apply` only guards the write. The template
  is now read by parsing, never importing, and only from the one path `/init`
  actually vendors to. (#343)
- **The migration carries your handover across.** `arsenal_migrate.py` used to
  decline the whole of `arsenal/session/` whenever it already existed — and
  since `UPDATE.md` documents trees-first-then-migrate, `init.py` had always
  created it first, so the real handover was *never* carried over on a migration
  that followed the documented order. It now merges file by file, and names
  anything it genuinely declines instead of reporting `left alone`. (#353)
- **`/init` no longer shadows your handover.** The bundle shipped
  `session/handover.md`, so every run recreated an empty
  `claude-arsenal/session/handover.md` beside the real
  `arsenal/session/handover.md`. Nothing read it, and an empty handover looks
  exactly like a fresh install — so a session that opened it concluded there was
  no prior context. The bundle no longer ships it; an existing copy is removed
  when untouched, and **preserved with a warning** when it has content. (#353)
- **A section you enable is now honoured or explained, never dropped.** A
  vendored `init.py` derived the requestable sections from the skills already
  installed, so a section whose skills were all un-vendored could not be named:
  `--sections extract` failed as "unknown section", and `extract = true` in
  `arsenal/config.toml` was dropped in silence behind the usual success line.
  Sections now come from the shipped `sections.json`, and a section that is on
  with no skill to satisfy it says so and tells you to re-run the plugin's
  `init.py`. (#354)
- **A GitHub outage is no longer reported as a permission problem.**
  `github_channel.sh` matched a bare `403`/`404` anywhere in `gh`'s output, so an
  HTTP 500 whose body carried a `#404` documentation link — or a connection
  reset with `403` inside a trace id — came back as "this channel may read but
  not write here", which `claim_task.sh` maps to `manual`. The match is now
  anchored to `gh`'s own `HTTP <code>:` framing. (#342)

## [3.5.0] - 2026-09-04

- `open_task_pr.sh` now **rejects an unknown option** instead of taking it as
  the PR title. `open_task_pr.sh <id> --body-file x.md` used to open a PR
  subjected `x.md: --body-file` and merge it; the subject is the one part of a
  PR that survives a squash, so the only fix was rewriting shared history.
  (#352)
- `open_task_pr.sh` gains `--title`, `--type`, `--body-file` and `--help`.
  `--body-file` supplies the PR body's Summary prose; the `Closes #<issue>`
  line, the gate note and the review receipt are still written by the script,
  because a body without them does not complete the task.
- **Branch slugs are now ASCII on every locale.** A non-English title could
  produce a branch name `git push` refuses — glibc collates accented letters
  inside `a-z` under a UTF-8 locale, and `cut -c1-40` splits multibyte
  characters. Invisible on CI (the runners are C.UTF-8), reproducible on any
  workstation with a real UTF-8 locale. If you carry a local patch for this,
  you can drop it. (#350)
- **The board reports a stale working tree.** `query_status.py` makes one
  read-only `git ls-remote` and warns when your checkout is behind the remote
  default branch. A stale task file and a genuinely open task read identically
  from the board, so a behind-by-N tree hands out work that is already merged.
  Skip it with `--no-remote-check`; it is silent when the remote is
  unreachable. Session-start step 3 now begins with `git fetch --quiet origin`.
  (#351)
- `task_select.py --issues` now **exits 2 on a file it cannot read**, matching
  `query_status.py`. A missing path raised `FileNotFoundError` and a truncated
  `{"issues": null}` raised `TypeError`; either could leave an empty state map,
  which is indistinguishable from a healthy new board — so the selector would
  hand out a task that was already finished. (#345)

## [3.4.5] - 2026-09-02

- `keyword-guard` no longer passes a task PR when a truncated `arsenal:task`
  listing is the reason its issue handle could not be resolved. The guard's
  fail-open means "no handle exists yet", which only holds for a complete
  listing — past the pagination cap the handle may exist, and the PR's
  `Closes #N` then names an unrelated issue that merging closes for good.
  A handle that resolved within the cap is still checked exactly as before, so
  this does not block task PRs on a board merely large enough to truncate, and
  only the issue listing's own completeness is consulted — a PR with a long
  enough commit list no longer trips the guard through the shared pagination
  flag.

## [3.4.4] - 2026-09-02

- The queue workflow's merge guard no longer fails on the pull request that
  installs the bundle. It reads the queue's task files from the **base** ref,
  and on a bootstrap PR those arrive with the pull request itself, so the step
  died with "can't open file" — a red check that reads as a broken PR rather
  than as a queue that does not exist yet. It now skips when arsenal is not on
  the base ref, where there are no task files and so no task issue a `Closes`
  line could name wrongly. 3.4.3 widened that guard to also match a task id in
  the PR body, which is what began routing bootstrap PRs into it.
- `issue_import.py --apply` creates each task file exclusively instead of
  overwriting whatever is at the path. Ids are minted against a directory
  snapshot read before the loop, so a task file that lands in the gap — a
  concurrent import, a worker committing its own task — was invisible to the
  mint and silently destroyed. It is now a clean refusal with the batch rolled
  back.
- `pr-closed` no longer reads a truncated issue listing as "this task has no
  handle". The handle may simply have sat past the pagination cap, and treating
  it as absent left a merged task closing nothing and its issue open and claimed
  forever. Its webhook fires once, so unlike `sync-handles` and `sweep-claims`
  it cannot refuse and retry: it now names the task and exits non-zero so the
  run goes red where somebody will see it.
- A listing of **exactly** 1,000 records is no longer reported as truncated. Ten
  full pages was taken as proof of an eleventh, so a board of exactly 1,000
  issues made `sync-handles` and `sweep-claims` refuse to run on a board that
  was in fact complete. An eleventh request now settles it.
- **The default surface profile grants no capabilities.** It previously claimed
  `surface:cli`, `surface:web` and `surface:cloud` at once, which no session can
  be — so every task gated on `requires: [surface:cli]` was selectable on the
  web, where it cannot run. Tasks with no `requires:` are unaffected. If you use
  `requires:` and have not run `bin/detect_surface.sh` on a surface, run it
  there; the selector now warns, naming the tasks it held back and the fix.

## [3.4.3] - 2026-09-02

### Fixed

- **`create_har.py` no longer leaks URLs through `log.pages`.** Every entry was
  redacted while the page list was copied verbatim, and browsers set a page's
  `title` to the page URL — so a capture spanning an OAuth redirect carried the
  token into an artifact the script calls safe to commit.
- **`recipes.md` no longer invites captured credentials into tracked source.**
  The `--secrets` reproduction holds live cookies and tokens; the recipe now says
  to keep it ephemeral and to read secrets at runtime from the environment.
- **`arsenal-queue.yml` runs `keyword-guard` for body-marker task PRs.** The job
  was gated on an `arsenal/` branch prefix alone, so a task PR that names its task
  in the body — the form `pr-closed` already resolves — could merge without anyone
  checking that its `Closes #…` named the task's own issue.
- **`open_task_pr.sh` keeps the rescue backup when the rollback failed.** The
  commit-failure path deleted it unconditionally, including on the one branch
  whose own error message tells the operator to restore from that exact file.
- **`issue_import.py --apply` rolls back a partial batch.** A failed write left
  earlier task files behind with no `arsenal-task:` markers on their issues, so the
  next handle sync proposed a duplicate issue for each of them.
- **`statusline_capture.sh` honours `ARSENAL_HOME`.** It wrote the quota snapshot
  to `arsenal/session/` while `budget_check.sh` read `${ARSENAL_HOME}/session/`, so
  the quota guard ran blind on every relocated host tree.
- **`arsenal_config.py` treats an empty `ARSENAL_HOME` as unset**, and reports an
  array or table in an enum key as a `ConfigError` rather than a `TypeError`
  traceback.
- **`task_select.py` normalises scalar `requires`/`tags`.** A bare
  `requires: surface:cli` was iterated character by character, so it could never
  match `--capability surface:cli`.
- **`queue_hooks.py` survives a null `base.repo`** (sent once a repository is
  deleted or made private) and warns instead of silently truncating a listing at
  the 1000-record pagination cap.
- **`query_status.py` returns 2 on an unreadable `--issues` file** rather than
  raising through its documented exit contract.
- **`arsenal_migrate.py` quotes `issue`, `status` and `pr`** in migrated front
  matter, as it already did for `title` and `workspace`.
- **`compare_har.py` honours a positive `--limit`** (every value behaved as 4096)
  and keys parameter changes by scheme and port, matching `identity()`.
- **`create_repro.py` refuses a non-text request body** instead of dying inside the
  shell quoter, and **`validate_har.py` passes `content-encoding` to `decode_body`**
  so a brotli body stops counting as undecodable.
- **`query_session_history.py` counts only real user turns** toward its
  five-message floor; tool results and injected skill bodies carry the user role.
- **`create_reader.py` renders the selected document label** in the main heading
  instead of a hardcoded "specification".

### Changed

- Documentation corrected where it described behaviour the code does not have:
  the claim lifecycle (what makes a claim stale, and that pruning a live claim ref
  breaks the lock), `init`'s directory layout and its retired marketplace
  declaration, the adversarial-review verdict contract, the `capability-map`
  section listing, the `pr-review-loop` exit-2 abort, the `AGENTS.md` step 4b
  fetch needing `body`, and the fact that abbreviated execution still owes the
  independent review.

## [3.4.2] - 2026-09-02

### Fixed

- **`har`'s `create_repro.py` could turn a capture into executable Python.** The
  captured HTTP verb was spliced into an attribute name, so a HAR whose
  `request.method` was not a plain verb produced a snippet that ran whatever the
  capture chose, the moment an operator pasted it. The verb is now bound as a
  quoted literal and passed to `requests.request()`, which also fixes the
  `AttributeError` on any verb `requests` has no shorthand for (`PROPFIND`,
  `MKCOL`). Update if you run `create_repro.py` against captures you did not
  produce yourself.
- **A hand-opened task PR could close someone else's issue.** The closing-keyword
  guard applied only to `arsenal/<task-id>-…` branches, while the merge backstop
  already resolved the same task from the `arsenal-task:` marker in the PR body.
  A task PR opened by hand therefore passed the guard carrying
  `Closes #<unrelated issue>`, and merging it closed that issue while the task's
  own one stayed open and claimed — the exact drift the guard exists to prevent,
  with a green check beside it. The guard now uses the same marker fallback.
- **`compare_har` reported two different requests as unchanged.** A request body
  the index could not identify was keyed on the row's own position, which counts
  from zero *within each capture*, so the fifth unidentified row on each side
  shared an identity and paired. Such rows are now always reported as unpaired.
- **`--since`/`--until` without a timezone crashed `query_har` and `create_har`.**
  A bare `--since 2026-08-30` was compared against the timezone-aware timestamps
  in the HAR, raising a `TypeError` nothing catches. A value with no offset is
  now read as UTC.
- **`capture_har` reported success after a failed navigation.** Every navigation
  error was treated as the interesting partial capture, so a DNS failure or a
  refused connection exited 0 and looked identical to a good run. Only a
  navigation *timeout* is a success now; the HAR is still written either way.
- **`claim_task.sh` with no task id looked like a lost race.** The missing-argument
  path exited 1, which this script documents as `lost`, so a caller's own usage
  error made the task read as already claimed and silently skipped. Usage errors
  exit 2.
- **A conflicting `check_update.sh` left the tree mid-merge.** When
  `git subtree merge` conflicted, the script warned and exited 0 with
  `MERGE_HEAD`, a populated index and conflict markers in place — handing the
  worker loop a dirty tree moments after confirming it was clean. The merge is
  aborted first.
- **`host_setup.sh` silently under-reverted install churn.** Its `comm` ran in the
  caller's locale against byte-sorted input, and under any other collation it
  stops at the first perceived inversion — `package-lock.json` beside
  `package.json` is enough. A lockfile the install rewrote was then left in the
  task PR.
- **`open_task_pr.sh` refused a malformed task file without saying why.** A task
  file with no front matter made the stamper exit 0 while the caller's own
  re-check failed and rolled the archive back, reporting only "not a complete
  archive". The refusal is correct — such a file has no `id:` for the selector to
  read — but it now names the cause.

### Changed

- **`queue-add` refuses a duplicate task title.** Titles are how an issue resolves
  back to its task when the board is fetched without bodies (deliberately: ~1.2k
  context tokens against ~9k on a 40-issue board), and an ambiguous title
  resolves to nothing — so duplicates showed up later as missing handles and as
  `handle_sync.py` proposing a second issue for a task that already had one. The
  collision is now caught at creation, where one rename fixes it.

## [3.4.1] - 2026-09-01

### Fixed

- **`bin/host_setup.sh` lost your work when the install failed.** The revert
  and the restore both sat after an early exit, so a `host-setup` that rewrote
  a tracked file and *then* failed — a lockfile written before a resolution
  error, a post-install script exiting non-zero, an interrupted network install
  — skipped both. The churn stayed in the tree, and an edit you already had
  there was left overwritten, with your version surviving only as an
  unreferenced blob in the object database. Cleanup now runs whether the
  install succeeded or not, which is the case it was written for. A failed
  install still exits 1.
- **`agents/worker.md` and `docs/queue.md` described the wrong gate order.**
  Both said `open_task_pr.sh` runs the gates "before it touches git". Since
  3.3.0 only `gate_run.sh` does: the repo's `host-gate` runs *after* the task
  file is archived into `tasks/_history/`, because the archived tree is the one
  the PR ships. A worker whose host gate failed was told nothing had moved. The
  archive is undone on refusal and no commit is made, so the real cost is a
  slower failure, not a tree left moved.

## [3.4.0] - 2026-09-01

### Added

- `capture_har.py --ua-suffix` — the token appended to the browser's real user
  agent when recording a HAR is now the caller's to choose, defaulting to
  today's `claude-arsenal-har/1.0`. If your repo already declares a robots
  identity, capture under **that** one: a `robots.txt` group naming a token is
  answering a question about that token, so a capture taken as
  `claude-arsenal-har/1.0` cannot settle whether a fetch you would actually
  make is permitted. `--ua-suffix ""` appends nothing and is honoured as
  given, for a page whose rendering branches on a token it does not recognise.

### Fixed

- **The skill-write gate (`bin/gate_target.py`) was fail-open on most ways to
  write a file from an interpreter.** It matched a list of write *method names*,
  and that list cannot be finished: `os.remove`, `os.truncate`, `writelines`,
  `json.dump`, `print(file=…)`, `fileinput(inplace=True)`, `os.system("rm …")`,
  `subprocess.run`, `exec` of a string built at runtime and `Path(p).open("w")`
  all reached a SKILL.md without matching any name in it — as did anything run
  through `uv run python3 -c`, which the gate read as the utility `uv`. The
  `Path.open` miss got worse over time: ruff's PTH123 pushes code from the form
  the gate caught toward the form it did not.

  Interpreter source is now judged the other way round: a skill path in it is a
  write **unless** every mention sits inside a construct that can only read.
  Reads still go through — `python3 -c "print(open(SKILL).read())"`, a
  `read_text()`, a script file given to an interpreter — because a gate that
  blocks reads gets routed around instead of through.

## [3.3.0] - 2026-09-01

### Added

- **`host-setup` in `arsenal/config.toml`, and `bin/host_setup.sh` that runs
  it.** Name your repo's install command once — `host-setup = "npm ci && uv
  sync"` — and every worker runs it in its fresh worktree before the first
  gate. A worktree is a checkout: it carries tracked files and none of what an
  install produces, so until now the first gate in each one failed on a missing
  tool, and every worker in a fan-out diagnosed that separately (five of nine,
  in the session this came from, at 10-12 minutes a gate run). Empty by
  default; a repo that declares nothing is unaffected and the script exits 0
  saying so.
- **The install's lockfile churn no longer lands in task PRs.**
  `host_setup.sh` reverts what the install rewrites in *tracked* files
  (`package-lock.json`, a re-pinned lockfile) so the task PR carries the task's
  diff and nothing else. What it undoes is the install's writes, not a list of
  paths: edits already in the tree survive, including when the install rewrites
  the very file the task was editing. Untracked install output —
  `node_modules/`, `.venv/` — is kept, since that is what the install is for.

### Changed

- **`agents/worker.md` makes the install a step, not a recovery note.** Setting
  the worktree up is now step 2, before the tests; the old text lived in the
  read-the-task step, spoke of *stale* dependencies rather than absent ones, and
  only applied once a gate had already been spent failing. Where no `host-setup`
  is declared, the worker is told to say so in its outcome report, so the gap
  gets closed once instead of rediscovered per worker.

## [3.2.0] - 2026-09-01

### Added

- **`worker_postcheck.sh` refuses a `done` that carries no evidence.** Pass
  `ARSENAL_WORKER_OUTCOME=done` and `ARSENAL_WORKER_RESULT="<the worker's
  result>"` alongside the `ARSENAL_WORKER_TOPLEVEL` you already pass, and a
  worker reporting completion with no PR URL, no `branch:` line and no
  `toplevel:` exits **4** instead of being recorded as finished.

  This catches the worker that runs a long host gate in the background, arms a
  watcher, and ends its turn — "I'll pick back up when the monitor notifies me."
  Ending the turn is terminal, so the orchestrator sees a completed worker with
  no PR while the task's processes are still running. Three of nine workers did
  this in a single fan-out, each after a broader prohibition in the dispatch
  prompt.

  **The refusal runs before anything destructive.** An abandoned worker's gate is
  often still alive, and the restore is `reset --hard` + `clean -fd` — so the
  check comes first and the tree is left untouched. Resume that worker rather
  than re-dispatching it: the work is intact and only needs the turn it was cut
  off from.

  Opt-in. An orchestrator that passes no `ARSENAL_WORKER_OUTCOME` behaves exactly
  as before.

### Changed

- `agents/worker.md` now states, before the step where a worker chooses how to
  run a slow gate, that **ending your turn ends the task** — so the host gate,
  `gate_run.sh` and `open_task_pr.sh` run in the foreground, in one call, with a
  timeout sized for the host's real suite. A gate that genuinely exceeds one turn
  is a `host-gate` sizing problem to report, not to route around.
- `references/worker-loop.md` step 5 asks the orchestrator to set that
  expectation in the dispatch prompt too, since a worker under time pressure
  reads that prompt last.

## [3.1.16] - 2026-09-01

### Fixed

- **The vendored-skill skew check answered confidently about a skill it could
  not identify.** When a repo has no `.claude/skills/init/assets/.bundle-version`
  and two or more vendored skills carry a nested `init/assets/.bundle-version`,
  the fallback picked the lexicographically first — which has nothing to do with
  which skill owns the bundle — and compared the installed version against it.
  Sorting made that deterministic without making it right. Getting it wrong is
  silent: the probe stays quiet and session-start step 0(b) then runs a skill
  that rewrites your bundle backwards, the exact fail-open the check exists to
  prevent.

  It now declines: an ambiguous layout prints `AMBIGUOUS VENDORED SKILL`, names
  the candidates, and says the guard is inert so you can check step 0(b)
  yourself. A single candidate is still resolved and reported as before, so an
  unusual-but-unambiguous layout keeps its guard.

## [3.1.15] - 2026-09-01

### Fixed

- **A dirty orchestrator tree silently serialised the whole fleet.**
  `worker_postcheck.sh` recorded worktree isolation as `unavailable` whenever it
  had to restore the tree — so untracked session scratch, which has nothing to
  do with where the worker ran, outranked the worker's own reported root and
  clamped every later batch to one task for the rest of the session. Measured
  with the worker in `.claude/worktrees/agent-…`, the orchestrator at the repo
  root, and HEAD never off its branch: isolation held, and the verdict said
  otherwise.

  The verdict is now the measurement it was made into. A restore caused only by
  a dirty tree defers to `ARSENAL_WORKER_TOPLEVEL`, and says on stderr that the
  batch is not clamped. **A moved HEAD still records `unavailable`** — that is
  real evidence something ran in the orchestrator's tree — and a restore with no
  worker root reported stays conservative, exactly as before.

## [3.1.14] - 2026-09-01

### Fixed

- **`open_task_pr.sh` could not open a PR at all in a repo whose host gate
  measures its own files.** The gate ran on both sides of the task-file archive,
  so any measurement counting files under `arsenal/tasks/` demanded two
  different committed values and no single value satisfied both: stage the
  pre-archive number and the second run fails, stage the post-archive number and
  the first run fails and the archive is never reached. The gate now runs once,
  over the archived tree — the tree the PR actually ships, and so the only one
  whose measurement means anything. The old failure message advised making the
  measurement account for `_history/`; that advice is gone, because an
  append-only ledger is a legitimate thing to exclude.

### Changed

- **A host-gate failure is now reported after the branch is cut, not before.**
  That is the cost of running the gate over the final tree: a red repo is
  discovered one step later. Nothing is committed or pushed, the task-file
  archive is undone, and the run now also **switches you back to the branch you
  started on** — so a refusal still leaves the tree as it was found. If the
  switch back fails, the message says so and names the branch you are on.
- Repos with no `host-gate` declared are unaffected.

## [3.1.13] - 2026-09-01

### Fixed

- **A pull request from a deleted or private fork could still release another
  session's task claim.** The fork check only refused a PR when GitHub told it
  which repository the branch came from — but GitHub sends `head.repo: null`
  once the fork is deleted or made private, which an attacker can arrange after
  opening the PR. The check now keys on the base repository: anything that does
  not match it is outside. A `pull_request_target` workflow with `issues: write`
  no longer takes a fork's word for it.
- **A `<=` gate written against `1e999` passed every measurement.** The gate
  grammar accepts an exponent, so an overflowing threshold became infinity and
  nothing could ever violate it. `gate_evidence.py` now refuses a non-finite
  threshold (exit 2), the same way it already refused a non-finite measurement.
  Finite exponents such as `<= 1e6` keep working.
- **Migrating a task whose id began with `.` or `_` produced an invisible
  task.** Both `create_task.py` and `task_select.py` skip those filenames when
  they collect the task set, so the migration reported success while writing a
  task that could never be selected and never satisfied a dependency. Such an id
  is now refused (exit 2) instead of migrated.

## [3.1.12] - 2026-09-01

### Fixed — state that went to two different places

- **`ARSENAL_HOME` is honoured consistently.** `task_select.py` hardcoded
  `arsenal/session/worktree_isolation` while `worktree_probe.sh` resolved it
  through `ARSENAL_SESSION_DIR`/`ARSENAL_HOME`, so a relocated host tree had the
  probe writing `unavailable` to one file and the selector reading a stale
  `available` from another — and `available` is what permits ramping to N
  workers, so the disagreement dispatched parallel workers into one checkout.
  `budget_check.sh` hardcoded the same directory for its rate-limit and
  round-counter state. Both follow the environment now.
- **An exported-but-empty `ARSENAL_HOME` no longer resolves to the repo root.**
  `os.environ.get("ARSENAL_HOME", "arsenal")` returns `""` for a variable that is
  exported and unset, and `repo_path / ""` is the repo root — so `/init` would
  have scaffolded every host-owned file into the top of the tree.
- **The dispatch-round counter is keyed on a session id that exists.**
  `budget_check.sh` read `CLAUDE_SESSION_ID`, which no current surface sets, so
  every run keyed on the literal `default`: one shared counter across every
  session on the machine. It now uses `CLAUDE_CODE_REMOTE_SESSION_ID` falling
  back to `CLAUDE_CODE_SESSION_ID`, the pair the claiming protocol already
  documents, and `references/quota-governance.md` says so too.
- **`issue_import.py` cannot overwrite an existing task file.** The fallback id
  generator was unchecked, so a collision replaced a task on `--apply`.
- **`adversarial_review.sh` validates its diff cap.** A non-numeric or zero
  `ARSENAL_REVIEW_MAX_DIFF_LINES` emptied the diff while the notice above it
  still claimed one followed — and a reviewer handed an empty packet has nothing
  to object to, so it returns CLEAR.

## [3.1.11] - 2026-09-01

### Fixed — checks that had quietly stopped checking

- **`rebase_stack.sh` no longer treats an unreadable config as "no gate".** It
  read `host-gate` with `2>/dev/null || true`, so a malformed `config.toml` — or
  a missing `python3` — produced an empty gate, and an empty host gate is a
  no-op: the pre-push check silently stopped running. It now refuses, which is
  the policy `open_task_pr.sh` already states for the identical call. It also
  refuses outside a git repository instead of running against the caller's
  current directory.
- **`listing-budget = true` is refused.** `bool` subclasses `int` in Python, so
  the type check passed and the value became `True` — which behaves as the
  number 1, capping the skills listing at one character.
- **A denied write on the `gh` channel falls back to `manual`, not `error`.**
  The `rest` channel already did this; the `gh` one returned the code
  `claim_task.sh` maps to `error`, which stops the whole session, so the
  documented manual fallback was unreachable there.
- **`budget_check.sh` says when its round cap is not in effect.** A failed state
  write was swallowed, so the count recomputed as 1 on every call and the
  per-session dispatch cap silently never fired.

## [3.1.10] - 2026-09-01

### Fixed — data integrity

- **A failed commit no longer strands your task file in `_history/`.**
  `open_task_pr.sh` deleted its rescue backup *before* `git commit`, so a commit
  refused by a hook or a git-config problem exited 1 with the task file already
  archived and stamped `status: merged` — which the selector reads as finished
  work — and nothing left to restore it from. The backup now survives until the
  commit succeeds, and a refused commit rolls the archive back. The message no
  longer blames an "empty diff", which cannot be the cause there: `git add -A`
  has just staged the archive move.
- **`arsenal_migrate.py` contains the paths it is handed.** A legacy queue row's
  `payload` and `id` were joined straight onto a path, so with `--apply` one row
  could read a file outside the queue directory and write it inside
  `arsenal/tasks/`. Both are resolved and checked now, and a task id that is not
  a usable filename is refused.
- **A queue row that cannot be read stops the migration.** Malformed JSON lines
  and rows with no `id` were skipped silently and the run still reported
  success — so a user who trusted that report and deleted the old queue lost the
  only record of those tasks. It now exits 2 naming the file and line, having
  written nothing.
- **Migrated `tags`, `requires` and `workspace` survive being read back.** The
  values were concatenated rather than serialised, so the single tag
  `needs, review` became two items and `type: bug` became a YAML mapping nested
  inside the list.

## [3.1.9] - 2026-09-01

### Fixed — a gate that could not be failed

- **`gate_evidence.py` accepted `NaN` and `Infinity` as measurements.**
  `json.loads` parses the JavaScript spellings and both are `float`, so they
  cleared the numeric type check and reached the comparison — where `NaN` passes
  every `!=` gate (it compares unequal to everything, itself included) and
  `Infinity` passes every directional one. A measurement that is not a finite
  number is now refused with exit 2, matching the threshold side of the grammar,
  which already admitted only finite decimals.
- **`gate-check`'s audit exited 0 for a gate nobody verified.** A non-numeric
  gate reports `MANUAL` and never `PASS` — the documented rule — but the process
  exit code was 0, which to CI or a calling script is the same thing as a clean
  audit. A prose gate now requires its Evidence-log row like any other: no
  recorded measurement, command, SHA or env means **incomplete** and exit 1. A
  manual gate whose evidence *is* recorded still passes, and is still never
  counted as PASS. If a plan of yours has prose gates with empty evidence rows,
  `run_gate.py` will start failing on them — that is the point; fill the row in
  with what you actually checked.

## [3.1.8] - 2026-09-01

### Fixed — action required for existing installs

- **A pull request from a fork could release another session's task claim.**
  The `pr-closed` job runs on `pull_request_target` with `issues: write`, and it
  read task identity from the PR's head ref and body — both of which a fork
  author writes. A fork PR closed without merging reached `release-claim` and
  stripped a live claim. Both the workflow condition and `queue_hooks.py` now
  require `head.repo` to be this repository. **Re-run `/init`** to pick up the
  new `.github/workflows/arsenal-queue.yml`; the script-side check protects you
  in the meantime, but the workflow condition is what stops the job running at
  all.
- **The `Closes` guard now requires the task's OWN issue.** It accepted any
  `Closes #N`, so a task PR could pass while pointing at an unrelated issue —
  that issue closed on merge and the task's own one stayed open and claimed,
  which is the drift the guard exists to prevent, with a green check beside it.
  It is now `queue_hooks.py keyword-guard`, which resolves the task's issue and
  checks the body and the commit messages against that number. A stacked PR
  carrying its keyword in a commit still passes; a task with no handle yet still
  passes, because that is not something the PR author can fix.

## [3.1.7] - 2026-09-01

### Fixed

- **Two more ways past the skill-edit gate are closed.** `gate_target.py` had no
  `git` handling at all, so `git restore SKILL.md` and `git checkout -- SKILL.md`
  — the two commands a session reaches for to undo an edit — overwrote a skill
  file with no target detected. And the interpreter-write pattern keyed on the
  write *call*, so `open(path, "w").close()`, which truncates a file to nothing
  without ever writing a byte, was invisible. Write detection now reads the
  `open()` mode (`w`/`a`/`x`/`+`), and `git restore`, `checkout`, `rm`, `clean`,
  `mv` and `stash` name their paths. `git diff`/`log`/`show`/`status`/`add` and
  read-mode `open()` stay allowed.

## [3.1.6] - 2026-09-01

### Fixed

- Two edge cases in v3.1.2's issue-import changes, found in review.
  `issue_import.py` decoded an imported body *after* stripping it, so `&nbsp;`
  and `&#32;` became a body that is blank on screen and truthy in code — the
  `_(no issue body)_` fallback never fired. And `--label arsenal:task` made the
  row's `add_label` and `remove_label` identical, so a caller applying it
  faithfully stripped the label session-start step 2 uses to find the board;
  that argument is now refused before anything is written.

## [3.1.5] - 2026-09-01

### Fixed

- **The skill-edit gate is satisfiable on a bundle that predates the rename.**
  These hooks ship in the core bundle, so they reach a repo whose vendored
  skills still expose only `skill-creator` — and they demanded `skill-workshop`,
  a name that is not in such a session's listing at all. From the main session
  nothing could satisfy it, so every edit under `.claude/skills/**` was blocked
  unconditionally for the life of that bundle. Loading `skill-creator` — the
  same skill under its former name — now satisfies the gate, and the block
  message says so.

## [3.1.4] - 2026-09-01

### Fixed

- **A rescue snapshot that fails no longer looks like a clean tree.**
  `rescue_snapshot.sh` reported both the same way — no ref, exit 0 — so
  `worker_postcheck.sh` could not tell them apart and went on to
  `git reset --hard` + `git clean -fdq` in the host's working tree. A disk-full
  or permissions error during the snapshot therefore destroyed uncommitted work
  with no ref to recover it from, silently, on the one occasion the safety net
  mattered. The snapshot now exits 1 when it had work it could not save, and
  `worker_postcheck.sh` refuses the restore and exits **3** rather than
  discarding anything. A clean tree still restores exactly as before.
- **A migrated repo gets the complete `config.toml`.** `arsenal_migrate.py`
  carried its own copy of the template, which had drifted from `init.py`'s: any
  repo migrated before running `/init` was left permanently without `host-gate`
  and `[models]`, because `init.py` will not rewrite a config that exists — and
  no ordering of the two scripts produced a complete file. `arsenal_migrate.py`
  now reads `init.py`'s template instead of keeping a copy, and writes nothing
  at all if it cannot find one, rather than seeding a partial config that blocks
  the real one. If you migrated earlier, compare your `arsenal/config.toml`
  against a fresh `/init` and add what is missing.

## [3.1.3] - 2026-09-01

### Fixed

- **Two ways past the skill-edit gate are closed.** `gate_target.py` dropped
  newlines when tokenising a Bash command, so in
  `echo hi` / `rm -rf .claude/skills/specify` it only ever examined `echo` and
  allowed the `rm`. And it treated every `(` as a command separator, which split
  a call's method name away from the paren the write-detector needs beside it —
  so any `pathlib.Path(...).write_text(...)` inside a heredoc went through
  undetected, which is the exact route the gate exists to catch. Both are
  complete bypasses, not partial ones. Reads, subshells and line continuations
  are unaffected.
- **A failing evidence gate is reported instead of vanishing.** Under `set -e`
  the non-zero exit from `gate_evidence.py` ended `gate_run.sh` before the
  branch written to handle it ran, so the `gate: unmeasured` verdict, both
  warnings, and the exit-code mapping were unreachable for exactly the runs they
  describe. A failing evidence gate now exits 1 and says so; an unmeasured one
  prints `gate: unmeasured` and exits 3.
- **`check_update.sh` keeps its "never aborts a session" promise.** An
  unreachable or credential-less `arsenal` remote exited 128 under `set -e`
  rather than warning, and a refusal from `init.py` skipped the check that tells
  a real update from a half-finished one. Session-start runs this as a report,
  so an abort removed the report.

## [3.1.2] - 2026-09-01

### Changed

- **`issue_import.py` now tells you to move the label, not just the marker.**
  Each imported row carries `add_label` (`arsenal:task`) and `remove_label` (the
  import label) alongside `add_to_issue_body`. Apply all three. Session-start
  step 2 fetches the board by `arsenal:task`, so an imported issue left on
  `arsenal:queue` was invisible to it — and `handle_sync.py` then proposed a
  *second* issue for a task whose first issue already carried the handle marker.
  If you have imported issues before, check for duplicate pairs.

### Fixed

- **An imported issue body is stored as written.** `html.unescape` was applied
  to the title and not the body, so every apostrophe in the prose a human reads
  to write the task's real gate was stored as `&#39;`.
- **The `Imported from` line is a Markdown autolink.** It was a bare URL, which
  is an MD034 hit in every imported task file of every consumer who lints their
  Markdown — permanently, since the template never changes. The `issue #N`
  fallback is left unwrapped.

## [3.1.1] - 2026-09-01

### Fixed

- **Upgrading from a bundle older than skill sections no longer deletes your
  skills.** `/init` inferred which sections a repo had from the `section:` line
  in each installed `SKILL.md`. A bundle predating that line carries it nowhere,
  so every skill classified as `core`, the inferred set came out empty, and the
  prune step removed the workflow and Python skills — on the routine
  `init.py --silent` the session-start protocol runs unattended. Sections are
  now inferred from skill *names*, which every version that ever shipped has in
  common. If this bit you, re-run `/init` with `--profile` or `--sections` to
  put the sections back.
- **`--sections` and `--profile` now take effect under `--workspace`.** Both
  were accepted, exited 0, and installed the defaults, so a workspace
  registered with `--sections extract` silently had no `extract` skills.
- **`/init`'s "sections off" line names opt-in sections.** A section that ships
  without a default — `extract`, today — could never appear there, so the one
  place that tells you what you are missing omitted exactly the sections you
  were most likely to be missing.
- `create_task.py` reports its errors under its own name; it still said
  `new_task:`, a script that no longer exists on disk.

## [3.1.0] - 2026-09-01

### Added

- **`har` can now take a capture, not only read one.**
  `scripts/capture_har.py` records a HAR from a URL through playwright, for a
  session with nobody sitting at a browser — which was the skill's first step
  and the one step it could not take. Run it as
  `uv run --with playwright python3 …/capture_har.py --url URL --output capture.har`;
  playwright stays out of the install, and every other script here is still
  stdlib-only. It uses the browser already on the machine, records into a fresh
  context so no login of yours reaches a file you are about to attach to a bug
  report, and writes the HAR even when navigation times out. New
  `references/capturing.md` explains the four rules that make that work.

### Fixed

- **One unreadable body no longer ends a whole query.** A response labelled
  `content-encoding: br` that did not decode raised `brotli.error` out of the
  filter and killed the command with a traceback, reporting nothing about the
  other 400 entries. Bodies an exporter stored *already decoded* while keeping
  the original encoding header — what playwright's `record_har_content="embed"`
  produces, so essentially every scripted capture — now read correctly, with or
  without the optional `brotli` module. `--xpath` against a body that is not
  well-formed XML likewise reports the row instead of taking the command down.
- **`create_har.py` no longer ignores `--body-match`, `--response-match` and
  `--has-header`.** They were accepted, documented in `--help`, and never
  evaluated, so a "minimal" fixture carved out with `--response-match` came out
  as the entire source capture — every other host the page talked to included.
- **`compare_har.py` can see a changed POST body.** Request identity hashed the
  *mime type*, so every `application/json` POST to one URL compared equal and
  two captures of different searches against a body-carrying endpoint reported
  "no differences". Request bodies are now hashed properly; existing index
  sidecars rebuild themselves on first use.
- **`--output` can no longer overwrite the capture being read.** Every script
  with an `--output` refuses a destination that resolves to one of its inputs.
  A HAR records one moment on a live site; re-recording will not reproduce it.
- **`validate_har.py` survives the captures it exists to diagnose.** A HAR
  carrying `"response": null` — what a proxy writes for a request whose response
  never arrived — raised `AttributeError` instead of reporting the finding.

## [3.0.0] - 2026-08-31

### Changed — action required

- **`queue-add`'s `new_task.py` is now `create_task.py`.** `create` is the
  canonical script verb; `new` was the last script outside that vocabulary.
  `/init` prunes files it no longer ships, so updating renames it for you and
  the skill's own docs move with it — but **anything of yours that calls
  `new_task.py` by path needs the new name**. That break is the whole reason
  this is a major.

### Changed

- **`init.py --quiet` and `analyze_mutmut.py --limit`** are the canonical
  spellings of what shipped as `--silent` and `--max`. **Both old spellings
  keep working**, so no existing invocation breaks; the canonical name is
  simply the one the help text leads with now.
- `init.py --repo-path` stays as it is, and the argument canon now says so.
  The flag looked like a duplicate of the canonical `--root`, but `init.py`
  already uses `--root` for the *workspace* root it creates, while
  `--repo-path` is the *host repository* it installs into. Collapsing them
  would have merged two concepts under one flag rather than removed a synonym.

### Fixed

- **A comment could hide a flag from the argument-canon check.** The check read
  argparse with a pattern that allowed only whitespace between `add_argument(`
  and the option string, so a comment line above a flag made the whole call
  invisible — the flag was not approved, it was unseen, and an unseen flag and a
  clean report look identical. Found while adding a comment above a flag being
  migrated, which silently removed it from the check in the same change that
  claimed to fix it.

### Internal

- The skill library reports **zero** validator warnings, and `make validate` /
  `make audit` now block on warnings rather than only on failures, so the count
  cannot drift back up unnoticed. `SKILL_SEVERITY=fail` restores the old
  behaviour while iterating locally.

## [2.16.3] - 2026-08-31

### Fixed
- The skill validator read a line like ```` ```inline `code` mention ```` as
  opening a fenced block. CommonMark says a backtick fence's info string may
  not contain a backtick, so that line is prose — usually an inline code span
  that happens to start a line. Treating it as a fence failed `body.fences` on
  valid markdown and made the voice and secret checks stop reading everything
  after it. Tilde fences have no such rule and are unaffected.

## [2.16.2] - 2026-08-31

### Fixed
- Sixteen fenced code blocks across the library opened without a language tag,
  so they rendered without syntax highlighting and tripped `markdownlint`
  MD040. All are tagged, and the validator now reports untagged fences itself
  (`body.fence-language`, `references.fence-language`) so they cannot drift
  back one review at a time.
- `review` had no runnable example anywhere in its body — the `gate-check`
  invocation it depends on was buried in prose. It is a `bash` block now, which
  is what the rest of the library does with a command.
- `github` asserted a reply rule in capitals instead of saying why it exists.
  The reason was already one clause away: a fix without a reply leaves the
  thread unresolved, so the next pass re-reads a comment already handled.

## [2.16.1] - 2026-08-31

### Fixed
- The skill validator no longer warns on the `har` and `init` skills' own
  argument vocabulary. Twenty-eight domain flags — `--endpoints`, `--css`,
  `--secrets`, `--sections` and the rest — join the argument canon, which is
  what that canon is for: it exists to stop two skills spelling the same
  concept differently, not to object to a skill having nouns of its own.
- `session-end`'s example PR table used `#42`/`#43`/`#44`, which read as real
  references. They are now `#NNN`, so nobody follows an example into a PR that
  does not exist.

Running the validator with `--severity warn` across the library now reports 4
warnings rather than 38. The four left are real and known: `--silent`,
`--repo-path` and `--max` duplicate canonical flags, and `new_task.py` uses a
non-canonical verb. Fixing those changes a vendored interface, so they get a
deliberate pass with aliases rather than a rename in passing.

## [2.16.0] - 2026-08-31

- **`compare_har.py` completes the toolkit: what changed between two captures.**
  The scraper's early-warning test — capture once, commit a derived fixture,
  and later ask whether the site moved. Non-zero exit means it did.
- Matching is one-to-one and deterministic, because a capture routinely repeats
  the same method and URL. The identity key is `(method, scheme, host, port,
  path, query pairs in captured order, request body)`; entries sharing a key
  pair in capture order, and anything left over is reported as an addition or a
  removal rather than paired with something that merely resembles it. A match
  made on order alone says so, so a reader can tell it from a real one.
- Two new references: `filters.md` (every selection flag, and the three that
  are not what they look like) and `recipes.md` (the whole path — capture, to
  the endpoint, to a request that runs in a loop).
- A test now asserts the sibling commands expose the same selection flags.
  Consistency across six scripts was a convention; it is now a contract.

## [2.15.0] - 2026-08-31

- **`create_repro.py` turns a found endpoint into a working request.**
  `--id N --format curl|python` emits a runnable reproduction with the method,
  URL, headers and body the capture recorded. Credentials are redacted by
  default; `--secrets` emits the real ones, which is what reproducing a login
  needs. Every value is escaped for where it is going — shell arguments quoted
  uniformly, Python values through `repr()`, bodies through `--data-raw` so one
  beginning with `@` stays data instead of becoming a local-file read.
- **`create_har.py` writes a derived capture.** Filtered by the same selection
  grammar, redacted, and **bodies dropped by default** — redaction covers named
  fields, and a response body is unbounded text that may carry a credential
  anywhere in it, so keeping them by default would hand back a file that looks
  sanitised and is not. `--keep-bodies` opts back in and says so. An `--output`
  that resolves to the input is refused before anything is opened, and every
  write is a same-directory temp plus an atomic rename.
- The derived file stays analysable: because redaction is the same salted
  fingerprint everywhere, `analyze_har.py --headers` still splits constant from
  varying on a redacted capture.

## [2.14.1] - 2026-08-31

- **The annotatable reader no longer loses notes quietly.** Two failure paths
  cleared the unsaved-work warning while the work was, in fact, unsaved: a
  `localStorage` write that threw (a private window, blocked site data) marked
  storage unusable but left the page thinking there was nothing to lose, and a
  blocked download was reported as `Backup saved`. In the no-storage mode that
  download is the *only* copy. Both now keep the warning armed and say what
  happened. Re-generate any reader you handed out before this version.

## [2.14.0] - 2026-08-30

- **`analyze_har.py` now reduces a capture to insight.** Nine modes, and the
  one worth running second is `--endpoints`: it collapses URL paths into
  templates and reports which parameters vary and over what range. Turning
  `?page=1&loc=NY`, `?page=2&loc=NY`, `?page=3&loc=NY` into one row saying
  `page` varies 1–3 while `loc` is constant is the difference between reading
  forty URLs and reading how to iterate the site.
- `--headers` finds the auth header: request headers grouped by host and split
  into constant across every request (candidate credential) versus varying.
- Also `--errors` (non-2xx with the body snippet that says how to fix the
  request), `--cookies`, `--stats FIELD`, `--redirects`, `--slowest`,
  `--largest` and `--websockets` — for sites that stream their data over a
  socket, where an HTTP body search finds nothing because there is no body.
- **Cookie redaction now keeps names and flags.** `Set-Cookie: sid=abc;
  HttpOnly` is stored as `sid=<redacted:ab12cd34>; HttpOnly` rather than being
  replaced wholesale. The name and the flags are what say which cookie
  authenticates and whether it is `HttpOnly`; losing them made cookie analysis
  a count of anonymous strings.

## [2.13.0] - 2026-08-30

- **`har` can now find things.** `query_har.py` selects entries, shows one in
  full, and gets data out. The two-command answer a scraping session actually
  wants: `--response-match "a string from the page"` names the request that
  returned it, then `--show N --schema` prints that body's shape — keys, types
  and array lengths, usually 100x smaller than the body and usually the real
  question.
- One selection grammar, shared: `--url`, `--host`, `--method`, `--status`
  (`200`, `4xx`, `400-499`), `--mime`, `--type`, `--min-size`/`--max-size`,
  `--slower-than`, `--param NAME[=REGEX]`, `--has-header NAME[=REGEX]`,
  `--body-match`, `--response-match`, `--page`, `--since`/`--until`,
  `--invert`. Every sibling command will spell them identically.
- **Three cache flags, not two.** `--no-cache` selects `_fromCache: false`
  only; `--unknown-cache` selects entries whose exporter never recorded it.
  Folding those together would make the same command mean different things on
  a Chrome capture and a Playwright one.
- Extraction: `--extract-body --output-dir`, `--json-path`, `--css`, `--xpath`.
  Filenames derived from a URL are flattened and the destination is verified
  inside the output directory before any write — a capture's URLs are as
  untrusted as its bodies. A selector the small CSS/XPath subset does not
  support is refused **by name**, never silently unmatched.
- Output is capped at 20 rows and 4096 bytes and says which cap dropped what.
  `--limit 0` removes both; `--output PATH` writes the complete result.
  `--json` stays parseable under the cap by dropping whole entries.

## [2.12.0] - 2026-08-30

- **New section `extract`, and its first skill `har`.** Off by default, so a
  repo that never scrapes pays nothing for it; `init.py --sections extract`
  turns it on, and `--list-sections` names it whether it is on or not.
- **`har` reads browser captures.** A HAR holds the complete network truth of a
  session and is also 5-500 MB of JSON, so the one thing nobody can do with it
  is read it. This release ships the foundation: `validate_har.py` (is this
  capture usable, and what did its exporter leave out) and `analyze_har.py`
  (what is in here, and `--index` to build the sidecar every later command
  reads). Searching, extraction and reproduction follow in the next releases.
- The index sidecar is redacted: auth headers, cookies and token-shaped
  parameters become `<redacted:ab12cd34>` — a salted fingerprint, so equal
  values stay equal and header analysis still works, while nothing about the
  original is recoverable. URL userinfo and fragments are dropped outright.
- Bodies are decoded before they are searched — base64, gzip, deflate, and
  charsets declared, undeclared or declared wrongly. A body that cannot be
  decoded is reported as undecodable, never returned as a mangled string.

## [2.11.0] - 2026-08-30

- **Every session now reads the capability map at start-up, and volunteers a
  skill you did not install when a task calls for it.** The session-start
  protocol gained step 0c: run `init.py --list-sections`. A discovery mechanism
  that waits to be invoked only serves people who already know the answer, and
  the failure here was never "the tool could not be found" — it was that nobody
  goes looking, because nothing said there was anything to look for.
- **What that changes in practice:** asked to do something a section this repo
  skipped would do properly, the session says so once — "this repo does not have
  `python` installed, which ships `coverage-gaps` for exactly this; enable it
  with `--sections python`, or say the word and I will carry on by hand" — and
  then does what was asked. The trigger is a task *squarely* covered by a skill,
  not one loosely related to it, and the answer is not re-litigated afterwards.
- New `claude-arsenal/references/capability-map.md` covers the map, when to
  volunteer a section and when not to, and how to enable one.

## [2.10.0] - 2026-08-30

- **A live issue now outranks a closed duplicate when reading the board.** A
  task can carry two handles — a duplicate created against a stale fetch, or a
  re-seeded board — and the state map took whichever GitHub returned last. With
  the open one listed first, an old closed duplicate made the task read `done`,
  so completion-drift checks went silent on a task that was still open.
  `issue_number_for` already preferred the open handle; the two now agree.
- **`query_status.py --pending-merge`, for auditing a branch rather than the
  default branch.** The completion protocol archives a task file in the same
  diff that closes its issue, so between opening a PR and merging it every task
  that PR finishes reads *archived, issue still open*. Reported as drift, that
  made the documented workflow unable to produce a green build on any PR. With
  the flag it is a note; without it, on the default branch, it is still the
  drift it was — a merge that did half its job.

- **New: `init.py --list-sections` prints the capability map.** Sections made
  the install set a choice, and a choice creates a thing nobody knows about — a
  repo without the `python` section has no way to learn `coverage-gaps` exists,
  because the only place a skill announces itself is the listing of the skills
  that *were* installed. The map is one short line per section: its name, what
  it is for, whether it is installed here, and — for the ones that are not — the
  skills it would bring. `--section NAME` prints those skills with their full
  descriptions, which is how to check whether one actually fits before enabling
  it. Both are read-only; neither installs anything.
- **Sections are enabled with `--sections a,b` or by editing `[skills]` in
  `arsenal/config.toml`**, unchanged — the map just makes it possible to know
  what to ask for.
- The map ships as data (`sections.json`) rather than being scanned from disk,
  because a vendored `init.py` can only see the skills its repo already
  installed. A bundle predating it falls back to what is on disk and says so.

## [2.9.1] - 2026-08-30

- **`query_status.py` no longer reports a missing issue handle it never looked
  for.** Run without `--issues`, it flagged every task as `no issue handle` —
  not an answer, since nothing was consulted. Any local audit of a board (no
  GitHub channel, no fetch) therefore failed on every task and could not be made
  to pass. The check is now skipped, and *reported* as skipped, when there is no
  issue data to check against; detail rows read `handle?` instead of
  `no-handle`. With `--issues` supplied, behaviour is unchanged — a genuinely
  missing handle is still a finding.

## [2.9.0] - 2026-08-30

- **The annotatable reader is now a gate, not a closing step.** `specify` and
  `design` already generated a reader; both now say that the work consuming the
  document waits for the annotations. No PR to merge a spec or plan, and no
  `design` off a spec or `execution` off a plan, until the reviewer's export has
  come back and been read. A document reviewed after it merged was ratified, not
  reviewed. A reviewer who says to proceed without annotating is making that
  call — it is not an assumption to act on while waiting.
- **The rule now covers any document that specifies or plans work**, not only
  `status/specification.md` and workspace specs, which are all that
  `create_reader.py` auto-discovers. Design documents, RFCs and proposals written into a docs tree
  get a reader too, named explicitly with `--output-dir` beside them. Publishing
  some other way — a chat summary, a hand-built page, a link to the raw file —
  does not satisfy it: the reader exists so notes attach to the section they are
  about, and a substitute that drops that property is not one.
- Guidance to rename the generated `spec-reader.html` / `spec-annotated.md` per
  document where several can share a directory — the names are fixed, so two
  design docs would otherwise overwrite each other's readers.
- **Every session will learn what the whole marketplace can do, not just what
  this repo installed.** Sections default off, so the failure worth designing
  against is not that a consumer cannot find a tool — it is that they never go
  looking. The session-start protocol will run `init.py --list-sections` every
  session: one short line per section, its skills, and whether it is on here.
  The commitment that follows is behavioural and general — whenever a task is
  squarely covered by a skill this repo did not install, the session says so
  before doing the work the long way. A repo handed an unexpected scraping task
  will say the `extract` section ships a HAR analyser for exactly this instead
  of reaching for a browser; a repo without the `python` section asked about
  coverage gaps will mention `coverage-gaps`. Specified in design 0002 § 5.5;
  shipping as delivery stage 0.
- The rules live in one place — `claude-arsenal/references/annotatable-reader.md`
  — rather than duplicated in both skill bodies, so they cannot drift apart and
  neither skill pays for them until it needs them.

## [2.8.0] - 2026-08-30

- **`/init` now asks what kind of project this is, and installs only those
  skills.** Vendoring used to be all-or-nothing: every repo carried all 17 shipped
  skills, and each one costs a row in the resident skills listing of every
  session forever, whether or not it ever triggers. Skills are now grouped into
  sections, chosen at install:
  - `core` — init, continue, queue-add, queue-status, github, session-end.
    Always installed; the vendored session protocol names these directly.
  - `workflow` — specify, design, execution, review, ship, gate-check.
  - `python` — python-bootstrap, pypi-release, coverage-gaps, dep-upgrade,
    mutmut-report.
- **New flags: `init.py --profile {minimal,general,python,all}` and
  `--sections a,b`.** The profile is a starting point, written out as an
  editable `[skills]` table in `arsenal/config.toml`. A misspelled section name
  is a hard error rather than a quietly smaller install.
- **Switching a section off is durable.** Set `python = false` under `[skills]`
  and the next `/init` prunes those skills and keeps them pruned — previously,
  deleting a vendored skill by hand was undone by the next session's
  `init.py --silent`.
- **Upgrading changes nothing on its own.** A repo whose `config.toml` predates
  `[skills]` keeps exactly the skills it already has: the sections in use are
  detected and recorded, and the shipped defaults (which have `python` off) are
  applied only to a genuinely fresh install. No skill disappears from an
  existing repo without someone editing the config.
- A repo that opts out of `python` drops 5 of 17 skills from its listing.

## [2.7.0] - 2026-08-30

- **New: a pre-PR adversarial review gate.** Before a PR is opened, the change
  is now read by a reviewer that has never seen it — spawned with only a case
  file, no conversation history. Until now every pre-PR check was run by the
  session that wrote the code, which catches what is broken but not what was
  built instead of what was asked for.
  - `claude-arsenal/bin/adversarial_review.sh emit` builds the case file
    (intent + the full diff, including uncommitted and untracked work + the
    rubric) into `tmp/arsenal-review/packet.md`; `verdict` records the answer;
    `check` asks whether *this* tree is cleared. The receipt is bound to a
    digest of the reviewed diff, so a CLEAR does not carry over to code written
    after it.
  - `claude-arsenal/agents/reviewer.md` is the reviewer's role and rubric.
  - A missing verdict never passes: `verdict` exits 2 when the reviewer returned no
    `VERDICT:` line, and `check` exits 2 with nothing on record.
- **Task PRs now state whether anyone independent looked.** `open_task_pr.sh`
  runs the check and writes the outcome — CLEAR, BLOCK, stale, or never run —
  into the PR body, where whoever merges it will see it.
- **New setting `pre-pr-review`** in `arsenal/config.toml`: `warn` (default —
  the PR opens either way and the outcome is stated in its body), `required`
  (no CLEAR for this tree, no PR), or `off`. Existing repos are unaffected on
  upgrade beyond the new body line; set `required` to make it binding.
- **Where it is enforced.** On task PRs the check is mechanical: `open_task_pr.sh`
  runs it, `required` refuses, and the outcome reaches the PR body whether or not
  anyone remembered the step. On the `execution`, `github` and `ship` paths it is
  an instruction in the workflow — nothing wraps `gh pr create` — so a session
  that skips it opens a PR with no review and no record of the omission. Making
  those paths mechanical requires a `PreToolUse` hook over `gh pr create`, which changes
  every consumer session's ability to open a PR and belongs in its own change.
- The `execution` skill (Step 4b), the `github` skill (pre-PR gate) and the worker agent now run the
  gate before opening a PR. `ship`'s adversarial gate (Step 7) now uses the same
  mechanism instead of its own inline prompt, so there is one rubric to improve.

## [2.6.0] - 2026-08-29

- Added this file. Every version-bump PR must now add a `## [X.Y.Z]` entry
  here describing what changed for a downstream consumer — enforced by CI's
  `version-bump` job (a missing heading fails the build).
- `/init`'s upgrade banner now prints the entries between your installed
  version and the new one. Re-running `/init` — or the automatic
  session-start refresh that already ran `init.py --silent` every session —
  now tells you what you just picked up, not only the version number.
- `check_update.sh` does the same for a subtree-remote install, printing the
  entries alongside its existing "UPDATE AVAILABLE" / "pulling update…"
  messages.
