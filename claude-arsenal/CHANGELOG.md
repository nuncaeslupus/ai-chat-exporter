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
