#!/usr/bin/env bash
# open_task_pr.sh <task_id> <title> [<type>]
# open_task_pr.sh <task_id> --title <title> [--type <type>] [--body-file <path>]
# open_task_pr.sh --help
# Commit a worker's task changes on a feature branch cut from the host DEFAULT
# branch (origin/main), push it, and open a PR that closes the task's issue.
#
# Prints ONE line on stdout, consumed by the caller and recorded on the queue
# task's issue via the PR body's `Closes #<issue>` line:
#   <pr-url>            — a PR was created (a `gh` backend was available).
#   branch:<name>       — the branch was pushed but no PR backend exists here;
#                         the orchestrator/operator opens the PR (github skill /
#                         MCP). The branch ref is enough to do so.
#
# Conventional Commits message: `<type>: <title>` (type defaults to feat). The
# Co-Authored-By trailer is NEVER hardcoded — it is taken verbatim from
# ARSENAL_COAUTHOR ("Name <email>") when the caller exports the active model
# identity supplied by the harness. Absent it, no trailer is written.
#
# The PR body AND the commit message both carry `Closes #<issue>`, because that
# is the whole completion mechanism: GitHub closes the task's issue when the PR
# merges, so no session has to remember to update the queue afterwards. The
# number is resolved here rather than left to the caller — this used to be an
# instruction in the worker's prose ("make sure the body carries Closes #N")
# with no data path behind it, so every PR this script opened closed nothing and
# every merged task stayed `claimed` until a human noticed. Both places on
# purpose: the body fires on a merge into the default branch, the commit message
# survives a squash and fires for a stacked PR whose base is another branch.
#
# It also moves the task file into `tasks/_history/` with `status: merged` as
# part of the PR's own diff, so the archive lands exactly when the merge does
# and no follow-up commit is owed to anyone.
#
# Three things are checked before any of that happens, in this order: whether a
# reviewer with no history of the work cleared this exact tree
# (`adversarial_review.sh check`), the host's own gate, and the task's
# acceptance gate. The last two are mechanical and say nothing about whether the
# change is the change that was asked for; the first is the only one that can.
# It runs first because the other two execute arbitrary consumer commands, and
# any untracked artifact they leave behind would move the tree out from under
# the review's digest and report a genuine CLEAR as stale.
#
# The outcome is written into the PR body under every mode but `off`, so a PR
# opened with no review on record says so where the person merging it will read
# it. The body states only what the receipt proves — that a verdict was recorded
# for this tree — not that any particular reviewer ran: nothing here can tell a
# subagent's verdict from one a session wrote itself.
#
# Env: ARSENAL_QUEUE_REMOTE (default origin); ARSENAL_COAUTHOR (optional);
#      ARSENAL_TASK_ISSUE (issue number, when the caller already knows it);
#      ARSENAL_ISSUES_JSON (saved issue list, default /tmp/arsenal-issues.json);
#      ARSENAL_HOME (task tree, default arsenal);
#      ARSENAL_ALLOW_UNLINKED_PR=1 (open a PR that closes nothing — see below);
#      ARSENAL_ALLOW_SHARED_ADD (operator escape hatch, see the guard below).
# Exit: 0 branch pushed (PR opened or branch emitted), 1 on push failure /
#       usage / an unresolvable issue handle.

set -uo pipefail

REMOTE="${ARSENAL_QUEUE_REMOTE:-origin}"

_usage() {
    cat <<'USAGE'
usage: open_task_pr.sh <task_id> <title> [<type>]
       open_task_pr.sh <task_id> --title <title> [--type <type>] [--body-file <path>]

  <task_id>            the queue task this PR completes (e.g. lo-cf3d)
  <title>              the PR/commit subject, WITHOUT the Conventional Commits type
  <type>               Conventional Commits type; default: feat

Options:
  --title <text>       same as the second positional argument
  --type <text>        same as the third positional argument
  --body-file <path>   file whose contents become the PR body's Summary prose.
                       The `Closes #<issue>` line, the acceptance-gate note and
                       the review receipt are still written by this script — a
                       body that dropped them would break task completion.
  -h, --help           print this and exit

Env: ARSENAL_QUEUE_REMOTE, ARSENAL_COAUTHOR, ARSENAL_TASK_ISSUE,
     ARSENAL_ISSUES_JSON, ARSENAL_HOME, ARSENAL_ALLOW_UNLINKED_PR,
     ARSENAL_ALLOW_SHARED_ADD
USAGE
}

# Positional-only parsing let `open_task_pr.sh lo-cf3d --body-file tmp/pr.md` run
# to completion with TITLE=--body-file and TYPE=tmp/pr.md, and merged the subject
# `tmp/pr.md: --body-file` into main (#352). The subject is the one part of a PR
# that survives a squash, so a typo here is only fixable by rewriting shared
# history. An argument that looks like an option is now never taken as a value:
# it is either a known option or a usage error, before anything touches git.
TASK_ID=""
TITLE=""
TYPE=""
BODY_FILE=""
_positional=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help) _usage; exit 0 ;;
        --title)      [[ $# -ge 2 ]] || { echo "open_task_pr: --title needs a value" >&2; _usage >&2; exit 1; }; TITLE="$2"; shift 2 ;;
        --title=*)    TITLE="${1#--title=}"; shift ;;
        --type)       [[ $# -ge 2 ]] || { echo "open_task_pr: --type needs a value" >&2; _usage >&2; exit 1; }; TYPE="$2"; shift 2 ;;
        --type=*)     TYPE="${1#--type=}"; shift ;;
        --body-file)  [[ $# -ge 2 ]] || { echo "open_task_pr: --body-file needs a value" >&2; _usage >&2; exit 1; }; BODY_FILE="$2"; shift 2 ;;
        --body-file=*) BODY_FILE="${1#--body-file=}"; shift ;;
        --) shift; while [[ $# -gt 0 ]]; do _positional+=("$1"); shift; done ;;
        -*) echo "open_task_pr: unknown option: $1" >&2; _usage >&2; exit 1 ;;
        *) _positional+=("$1"); shift ;;
    esac
done

[[ -n "${_positional[0]:-}" ]] && TASK_ID="${_positional[0]}"
[[ -z "${TITLE}" && -n "${_positional[1]:-}" ]] && TITLE="${_positional[1]}"
[[ -z "${TYPE}"  && -n "${_positional[2]:-}" ]] && TYPE="${_positional[2]}"
TYPE="${TYPE:-feat}"

if [[ ${#_positional[@]} -gt 3 ]]; then
    echo "open_task_pr: too many arguments (got ${#_positional[@]}, expected at most 3)" >&2
    _usage >&2; exit 1
fi
[[ -n "${TASK_ID}" ]] || { echo "open_task_pr.sh requires <task_id>" >&2; _usage >&2; exit 1; }
[[ -n "${TITLE}" ]]   || { echo "open_task_pr.sh requires <title>" >&2; _usage >&2; exit 1; }
if [[ -n "${BODY_FILE}" && ! -f "${BODY_FILE}" ]]; then
    echo "open_task_pr: --body-file ${BODY_FILE} does not exist" >&2; exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd 2>/dev/null || echo .)"
BUNDLE_SCRIPTS="$(cd "${SCRIPT_DIR}/../scripts" && pwd 2>/dev/null || echo "${SCRIPT_DIR}/../scripts")"
ARSENAL_HOME="${ARSENAL_HOME:-arsenal}"

# Every path this script handles is repo-root-relative by contract: ARSENAL_HOME,
# a task's gate block, the session sentinel. Anchoring the whole run at the root
# is what makes that contract true. Resolving only the gates there — the first
# fix for this — left `_archive_task_file` resolving `${ARSENAL_HOME}/tasks/…`
# against the CALLER's cwd, so invoked from a subdirectory the archive silently
# missed (or, in a monorepo, hit a different tree that exists) while the PR body
# promised it and the merge closed the issue (#239). SCRIPT_DIR and
# BUNDLE_SCRIPTS are resolved absolute above; this depends on that ordering.
# Not being in a repository is not a degraded mode this script has an answer
# for: every step below is a git operation or a gate resolved from the root.
# The old `|| pwd` fallback made that case indistinguishable from success — the
# `cd` into the caller's own cwd always works, so the host gate and the task
# gate ran against whatever tree the caller happened to be standing in and the
# operator got a gate result instead of "you are not in a repository" (#244).
# Refusing here is the only honest answer.
_repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[[ -n "${_repo_root}" ]] || {
    echo "open_task_pr: not inside a git repository (git rev-parse --show-toplevel failed) — run this from the repo that owns the task." >&2
    exit 1
}
cd "${_repo_root}" || {
    echo "open_task_pr: cannot enter the repository root ${_repo_root}" >&2
    exit 1
}

# ---------------------------------------------------------------------------
# Gates, before anything touches git.
#
# worker.md step 5 asks a worker to run the host lint gate and then gate_run.sh,
# and to open no PR if either fails. AGENTS.md goes further and states the
# payload gate "is a hard precondition" because this script re-runs it. Neither
# was true: nothing here ran either gate, so both were instructions with no data
# path behind them — which this project already names as the thing that makes a
# step not happen. A worker that forgot step 5, or ran only the `make lint` the
# prose gives as its example, opened a perfectly valid PR over a red repo.
#
# The refusal is the load-bearing half. A worker that *cannot* open a PR over a
# red repo needs no discipline; one that is asked to check first needs it every
# single time — and one handed a skip flag reaches for it precisely when the
# repo is red.
#
# SECURITY: host-gate runs verbatim, like a payload's gate block. It comes from
# arsenal/config.toml, which is host-owned and reviewed like any other file in
# the repo — but it is code, not data.
_gate_fail() {
    echo "open_task_pr: $1 — no PR opened" >&2
    echo "open_task_pr: fix it and re-run; this is the same refusal a failing payload gate gets" >&2
    exit 1
}

# There is deliberately no way to skip this. An escape hatch would be reached
# for exactly when a repo is red, which is the case the refusal exists for.
#
# 1. The pre-PR adversarial review — FIRST, before either gate runs.
#
#    The two gates below prove the change does not break the repo. Neither
#    can tell whether it does what the task asked, because both are
#    mechanical and the only reader who has judged that is the session that
#    wrote it. `adversarial_review.sh check` asks whether a reviewer with no
#    history of this work cleared THIS tree — digest-bound, so a CLEAR from
#    before the last edit does not count.
#
#    Order is load-bearing, and it was wrong the first time. Both gates below
#    run arbitrary consumer commands, and a gate that leaves any untracked
#    artifact — a timestamped log, a coverage report, __pycache__ — changes
#    the tree between the reviewer's verdict and this check. Running the
#    check afterwards therefore reported a genuine CLEAR as stale: under
#    `warn` the PR body then asserted something false on the one surface this
#    feature exists to make truthful, and under `required` the refusal could
#    never be cleared, because every retry re-ran the gate that invalidated
#    the receipt. Asking before the gates run removes the whole class.
#
#    What the receipt covers is the tree the AUTHOR produced, not the final PR
#    byte-for-byte: this script goes on to archive the task file into
#    `tasks/_history/` as part of the same diff, after this check. That mutation
#    is deliberately outside the review's scope — it is this helper's own
#    bookkeeping, identical on every task PR, and re-reviewing after it would
#    never converge, because the next run would mutate the tree again. No
#    author-written change can enter through it.
#
#    Default is `warn`, not a refusal, and that is deliberate: a hard gate
#    added to every existing worker loop overnight is a gate a consumer
#    disables on the first red morning. So the outcome is written into the PR
#    body instead, where the human who merges it reads it. Silence is what
#    this repo keeps getting bitten by, not friction. Set
#    `pre-pr-review = "required"` in arsenal/config.toml to make it refuse.
review_note=""
review_mode="warn"
if [[ -f "${BUNDLE_SCRIPTS}/arsenal_config.py" ]]; then
    # Errors are NOT swallowed into the default, for the same reason the
    # host-gate read above does not swallow its own. arsenal_config.py exits 2
    # on a value outside the enum — which is exactly what a consumer who typed
    # `requried` or `Required` gets — and `|| echo warn` would turn that
    # refusal back into the permissive mode they were trying to leave. The
    # validation would then be enforced by nobody, which is worse than absent:
    # it reads as protection while granting none.
    if ! review_mode="$(python3 "${BUNDLE_SCRIPTS}/arsenal_config.py" \
            --repo-root "${_repo_root}" --get pre-pr-review 2>&1)"; then
        _gate_fail "could not read pre-pr-review from ${_repo_root}/${ARSENAL_HOME}/config.toml: ${review_mode}"
    fi
    review_mode="$(printf '%s' "${review_mode}" | tr -d '[:space:]')"
    [[ -z "${review_mode}" ]] && review_mode="warn"
fi
# A `required` gate whose checker is not installed must not pass. Guarding the
# whole block on the file's presence made the strictest setting a silent no-op
# in exactly the bundle that cannot honour it — the failure this repo keeps
# naming, wearing the label of the safeguard.
if [[ "${review_mode}" != "off" && ! -f "${SCRIPT_DIR}/adversarial_review.sh" ]]; then
    if [[ "${review_mode}" == "required" ]]; then
        _gate_fail "pre-pr-review is 'required' but ${SCRIPT_DIR}/adversarial_review.sh is not installed, so the gate cannot run"
    fi
    review_note="Pre-PR adversarial review: **not run** — the review helper is not installed in this bundle."
fi
if [[ "${review_mode}" != "off" && -f "${SCRIPT_DIR}/adversarial_review.sh" ]]; then
    # Anchored to the git root like the two gates below. The review directory is
    # a repo-root-relative path, and `git ls-files --others` only sees from the
    # cwd down — run from a subdirectory this would read a different tree than
    # the one the review was written for, and report a clean "not run".
    # --task namespaces the review slot. Without it there is one slot per working
    # tree and `emit` clears it, so a second worker in a shared tree — which
    # worker.md expects, because some surfaces ignore `isolation: worktree` —
    # deletes the first worker's genuine CLEAR out from under this check.
    ( cd "${_repo_root:-.}" && bash "${SCRIPT_DIR}/adversarial_review.sh" check --task "${TASK_ID}" ) >&2
    case $? in
        0) review_note="Pre-PR adversarial review: **CLEAR** — a clearing verdict is on record for this exact tree." ;;
        1) review_note="Pre-PR adversarial review: **BLOCK** — a blocking verdict is on record for this tree and was not resolved before the PR opened. Read the findings before merging." ;;
        3) review_note="Pre-PR adversarial review: **STALE** — the change was reviewed, then edited again. What is in this PR has not been reviewed." ;;
        *) review_note="Pre-PR adversarial review: **not run** — no review verdict was recorded for this change before the PR opened." ;;
    esac
    if [[ "${review_mode}" == "required" && "${review_note}" != *CLEAR* ]]; then
        _gate_fail "pre-pr-review is 'required' and there is no CLEAR review for this tree (run adversarial_review.sh emit, review it, then verdict)"
    fi
fi

# 2. The host's own gate, when the repo declares one. Absent by default, so a
#    repo without one is unaffected.
# Anchored to the git root, not the cwd: this script is routinely invoked from a
# worktree or a subdirectory, and arsenal_config.py resolves arsenal/config.toml
# relative to --repo-root (default: cwd). And errors are NOT swallowed — a
# malformed config or a missing python3 must not read as "no gate declared".
# Silently skipping the enforcement is the exact failure this whole change
# exists to remove; it would just move it one layer out.
host_gate=""
# Both the read and the RUN are anchored to the git root. The read was, and the
# run was not: a gate declared as `make lint` — or any of the relative forms a
# gate block is conventionally written in — was read correctly from a
# subdirectory and then executed there, where there is no Makefile. The refusal
# a worker got was `host gate failed (make lint)` over a green repo, and the
# only ways out are editing config.toml or cd-ing, the first being the one
# somebody under pressure reaches for. A linked worktree was never affected:
# its cwd and its `--show-toplevel` are the same directory. Both are anchored by
# the process cwd now — the subshells that anchored only these two call sites
# left every other relative path in the file reading from the caller's cwd.
if [[ -f "${BUNDLE_SCRIPTS}/arsenal_config.py" ]]; then
    if ! host_gate="$(python3 "${BUNDLE_SCRIPTS}/arsenal_config.py" \
            --repo-root "${_repo_root}" --get host-gate 2>&1)"; then
        _gate_fail "could not read host-gate from ${_repo_root}/${ARSENAL_HOME}/config.toml: ${host_gate}"
    fi
fi
# The host gate is READ here and RUN after the archive, not here. It used to run
# on both sides of the archive, and a host measurement over the repo's own files
# under `${ARSENAL_HOME}/tasks/` cannot satisfy both: the archive moves a tracked
# file, so the two runs demand two different committed values. Staging the
# pre-archive number failed the second run; staging the post-archive number
# failed the first and never reached the archive. The script could not open the
# PR at all, and its own advice — make the measurement account for `_history/` —
# asked hosts to count rows in a ledger that is append-only by design.
#
# The archived tree is the one the PR ships, so it is the only tree whose
# measurement means anything. Running once, there, costs a slower failure: a red
# repo is now discovered after the branch is cut rather than before. The archive
# is undone on refusal (below) and the branch carries no commit, so the cost is
# time, not a tree left moved.

# 3. The task's own mechanical gate — the precondition AGENTS.md already claims
#    this script enforces.
if [[ -f "${SCRIPT_DIR}/gate_run.sh" ]]; then
    # Gate chatter goes to stderr: this script's stdout is a contract that
    # callers parse (`branch:…`, the PR URL), and a `gate: passed` line in it
    # breaks them.
    # Resolve the task file from the default branch where it exists there: the
    # gate is a precondition the board sets, and a worker that could edit its
    # own gate on its own branch would be certifying itself. gate_run.sh still
    # falls back to the working copy for a task that has not merged yet.
    # Same anchor as the host gate above: a task's gate block is written
    # relative to the repo root (`bash tests/foo.sh`), and `${ARSENAL_HOME}` is
    # a repo-root-relative path in every other script that reads it.
    ARSENAL_GATE_FROM_DEFAULT=1 bash "${SCRIPT_DIR}/gate_run.sh" "${TASK_ID}" >&2
    _rc=$?
    case ${_rc} in
        0) ;;
        3) _gate_fail "the task gate could not run or reports its metric unmeasured (exit 3); nothing was verified" ;;
        2) _gate_fail "the task gate could not read ${ARSENAL_HOME}/tasks/${TASK_ID}.md (gate_run.sh exit 2). A repo still on the pre-v0.25 claude-arsenal/queue/ layout must run arsenal_migrate.py first" ;;
        *) _gate_fail "the task gate failed (gate_run.sh exit ${_rc})" ;;
    esac
fi

# The gates ran after the review, and `git add -A` below commits whatever they
# left behind. This names that gap; it does NOT refuse over it, and the
# distinction was arrived at the hard way.
#
# Checking after the gates made a gate's own artifacts invalidate a genuine
# CLEAR, and under `required` that never converged: each retry re-ran the gate
# that invalidated the receipt. Checking before them fixed that and put a false
# CLEAR in its place — a build log riding inside a PR whose body called the tree
# reviewed. Refusing on the drift detected here brings the first failure
# straight back, because round N's review covers round N-1's artifact and the
# gate rewrites it every time.
#
# So the guarantee is drawn where it can actually be met: `required` means an
# independent reviewer cleared THE AUTHOR'S tree. What the gates then wrote is
# disclosed in the PR body and never silently absorbed, but it does not block —
# those artifacts are not the author's change, committing them is behaviour this
# helper already had, and a setting nobody can satisfy protects nobody.
if [[ "${review_note}" == *CLEAR* ]]; then
    if ! ( cd "${_repo_root:-.}" && bash "${SCRIPT_DIR}/adversarial_review.sh" check --task "${TASK_ID}" ) >/dev/null 2>&1; then
        review_note="Pre-PR adversarial review: **CLEAR for the tree as reviewed — but the gates then changed it.** They ran after the review and left files behind, so this PR carries content no reviewer saw. Ignore or clean whatever your gate writes into the tree."
    fi
fi

# Snapshot the working tree to a permanent refs/arsenal-rescue/… ref. Used
# before the stale-base replay below, which force-moves HEAD across the tree.
# Echoes the ref (empty when the tree is clean or the helper is unavailable).
_rescue_snapshot() {
    [[ -f "${SCRIPT_DIR}/rescue_snapshot.sh" ]] || return 0
    bash "${SCRIPT_DIR}/rescue_snapshot.sh" "$1" 2>/dev/null || true
}

# True when this process runs in a LINKED git worktree (`git worktree add`),
# i.e. real per-worker isolation: a linked worktree has its own git dir that
# differs from the repository's common dir. Derived from git, never from an
# env var the caller sets about itself.
_in_linked_worktree() {
    local git_dir common_dir
    git_dir="$(git rev-parse --absolute-git-dir 2>/dev/null || true)"
    common_dir="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
    if [[ -z "${common_dir}" ]]; then
        # git < 2.31 has no --path-format; resolve the (possibly relative) path.
        common_dir="$(git rev-parse --git-common-dir 2>/dev/null || true)"
        [[ -n "${common_dir}" ]] && common_dir="$(cd "${common_dir}" 2>/dev/null && pwd -P || true)"
    fi
    [[ -n "${git_dir}" && -n "${common_dir}" && "${git_dir}" != "${common_dir}" ]]
}

# Slug: lowercase, non-alphanumerics → single hyphens, trimmed, capped.
#
# The whole pipeline runs under LC_ALL=C, and a final C-locale pass strips
# anything that still is not [a-z0-9-] (#350). Both are load-bearing, and the
# bug they close is invisible to CI because the runners are C.UTF-8:
#   * Under a UTF-8 locale glibc collates accented letters INSIDE the `a-z`
#     range, so `[^a-z0-9]` does not match `é` and it survives into the branch
#     name raw. `tr '[:upper:]' '[:lower:]'` mangles multibyte there too.
#   * `cut -c1-40` counts bytes, so a multibyte character straddling byte 40 is
#     left as a lone continuation byte — not even valid UTF-8.
# `git push` then refuses the ref, on exactly the workstations where people
# write non-English titles and nowhere the tests run. This was patched three
# times in one consumer's tree; each bundle bump reverted it, which is why the
# normalisation belongs here.
slug="$(export LC_ALL=C; printf '%s' "${TITLE}" | tr -d '\n\r' \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40 \
    | sed -E 's/[^a-z0-9-]+//g; s/-+$//')"
[[ -z "${slug}" ]] && slug="task"
BRANCH="arsenal/${TASK_ID}-${slug}"

# Resolve the host default branch from the remote's published HEAD symref, then
# fetch it so we branch off its real tip. NEVER fall back to the current HEAD:
# the worker may run in the orchestrator's tree, and branching off it would drag the entire
# queue-coordination history into the PR. Fail fast instead.
default_branch="$(git ls-remote --symref "${REMOTE}" HEAD 2>/dev/null \
    | sed -n 's|^ref:[[:space:]]*refs/heads/\([^[:space:]]*\).*|\1|p')"
[[ -z "${default_branch}" ]] && default_branch="main"
if git fetch "${REMOTE}" "${default_branch}" >/dev/null 2>&1; then
    default_ref="FETCH_HEAD"
else
    default_ref="${REMOTE}/${default_branch}"
fi
default_base="${default_branch}"

# Cut (or switch to) the feature branch off the default branch. Uncommitted
# worktree changes from the worker carry across the checkout.
#
# A plain `git checkout -b` refuses when those changes touch a file whose
# content differs between the worker's base and the fetched tip — the worker's
# worktree was cut from a STALE base and the default branch has moved since
# (a merged PR from an earlier task in the same session is the common case).
# That is not a real conflict, so do not hard-fail on it: replay the worker's
# edits onto the fresh base instead (`_carry_onto`), which is what a rebase
# would have done. The pre-replay snapshot means even the unresolvable case
# leaves the work on a ref rather than losing it.
_carry_onto() {
    local branch="$1" base="$2" head_sha snapshot ref
    head_sha="$(git rev-parse --verify --quiet HEAD 2>/dev/null || true)"
    [[ -n "${head_sha}" ]] || return 1

    ref="$(_rescue_snapshot "open_task_pr: ${TASK_ID} edits before replay onto ${base}")"
    snapshot=""
    [[ -n "${ref}" ]] && snapshot="$(git rev-parse --verify --quiet "${ref}" 2>/dev/null || true)"
    if [[ -z "${snapshot}" ]]; then
        # No snapshot → no safety net, so do not touch the tree. Either the tree
        # is clean (the checkout failed for some other reason) or
        # rescue_snapshot.sh is unavailable.
        echo "open_task_pr: cannot branch off '${base}' and could not snapshot the working tree first — refusing to move it. Check that claude-arsenal/bin/rescue_snapshot.sh is present, then re-run." >&2
        return 1
    fi

    # Clear the tree to its stale HEAD before moving: the snapshot holds every
    # edit, and leaving the worker's untracked files in place would make the
    # replay below fail with "untracked working tree files would be
    # overwritten". `clean -fd` (no -x) keeps ignored files — node_modules and
    # friends stay put.
    git reset -q --hard >/dev/null 2>&1 || true
    git clean -fdq >/dev/null 2>&1 || true
    git checkout -f -B "${branch}" "${base}" >/dev/null 2>&1 || return 1
    # Applies the snapshot's diff against its parent (the stale base) onto the
    # fresh base, three-way. -n leaves it staged; unstage so the tree looks
    # exactly like the normal carry-across path before `git add -A` below.
    if ! git cherry-pick -n "${snapshot}" >/dev/null 2>&1; then
        git cherry-pick --quit >/dev/null 2>&1 || true
        git reset -q --hard "${base}" >/dev/null 2>&1 || true
        echo "open_task_pr: worker edits for ${TASK_ID} conflict with '${base}' and could not be replayed automatically. They are saved at ${ref} — resolve with 'git cherry-pick -n ${ref}' on the fresh base, then re-run." >&2
        return 1
    fi
    git reset -q >/dev/null 2>&1 || true
    echo "open_task_pr: worker's base was stale; replayed its edits onto '${base}' (snapshot kept at ${ref})" >&2
    return 0
}

# Refuse a shared checkout BEFORE anything mutates git.
#
# Safety guard: git add -A stages everything in the working tree, which risks
# sweeping a CONCURRENT worker's files or secrets into this commit when workers
# share one checkout. The guard used to require ARSENAL_SURFACE=worktree — but
# nothing set it, so every worker hit the refusal and exported it itself. A
# guard the guarded party certifies is not a guard. So derive the answer:
#
#   1. A linked worktree (`git worktree add`) IS the isolation → allow.
#   2. Serialized in-place mode → allow. Not the caller's word for it: the
#      sentinel is written by worktree_probe.sh / worker_postcheck.sh (the
#      orchestrator's own probes), and `unavailable` is exactly what clamps
#      task_select.py to one worker — so there is no concurrent worker to
#      clobber.
#   3. Otherwise refuse. ARSENAL_ALLOW_SHARED_ADD=1 is the operator escape
#      hatch for a bespoke setup, named so it reads as what it is.
_isolation_sentinel() {
    local dir="${ARSENAL_SESSION_DIR:-${ARSENAL_HOME:-arsenal}/session}"
    [[ -f "${dir}/worktree_isolation" ]] || return 1
    [[ "$(tr -d '[:space:]' < "${dir}/worktree_isolation" 2>/dev/null)" == "unavailable" ]]
}
if _in_linked_worktree; then
    :
elif [[ "${ARSENAL_WORKTREE_ISOLATION:-}" == "unavailable" ]] || _isolation_sentinel; then
    :
elif [[ "${ARSENAL_ALLOW_SHARED_ADD:-}" == "1" ]]; then
    :
else
    echo "open_task_pr: git add -A refused on shared checkout — not running in a linked git worktree and serialized in-place mode is not recorded (arsenal/session/worktree_isolation). Run from an isolated worktree, or set ARSENAL_ALLOW_SHARED_ADD=1 if you have verified no other worker shares this checkout." >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Resolve the task's issue number BEFORE touching git.
#
# Everything below this point mutates the tree, and a PR that cannot close its
# issue is worse than no PR at all: it merges, the work lands, and the board
# still shows the task claimed — the exact drift the next session pays to find.
# Failing here instead leaves the worker's edits untouched and the fix obvious.
#
# Three sources, cheapest first. The saved issue list is the common case: the
# session-start protocol already fetched every `arsenal:task` issue, so the
# answer is usually sitting on disk.
_resolve_issue() {
    local out

    if [[ -n "${ARSENAL_TASK_ISSUE:-}" ]]; then
        printf '%s' "${ARSENAL_TASK_ISSUE}"
        return 0
    fi

    local resolver="${BUNDLE_SCRIPTS}/issue_for_task.py"
    [[ -f "${resolver}" ]] || return 1

    local saved="${ARSENAL_ISSUES_JSON:-/tmp/arsenal-issues.json}"
    if [[ -s "${saved}" ]] \
        && out="$(python3 "${resolver}" --task "${TASK_ID}" --issues "${saved}" 2>/dev/null)"; then
        printf '%s' "${out}"
        return 0
    fi

    # Nothing saved (or the task is newer than the snapshot) — ask GitHub over
    # whatever channel this surface has. `none` exits 5 here and falls through
    # to the refusal below, which tells the caller to pass --issue: on a surface
    # with no scriptable channel the model holds the number, not the script.
    local slug
    slug="$(bash "${SCRIPT_DIR}/github_channel.sh" --slug 2>/dev/null)" || return 1
    if out="$(bash "${SCRIPT_DIR}/github_channel.sh" --api GET \
                "/repos/${slug}/issues?labels=arsenal:task&state=all&per_page=100" 2>/dev/null)"; then
        if out="$(printf '%s' "${out}" | python3 "${resolver}" --task "${TASK_ID}" --issues - 2>/dev/null)"; then
            printf '%s' "${out}"
            return 0
        fi
    fi
    return 1
}

ISSUE=""
if ! ISSUE="$(_resolve_issue)" || [[ -z "${ISSUE}" ]]; then
    if [[ "${ARSENAL_ALLOW_UNLINKED_PR:-}" == "1" ]]; then
        ISSUE=""
        echo "open_task_pr: no issue handle for ${TASK_ID}; opening an UNLINKED PR because ARSENAL_ALLOW_UNLINKED_PR=1 — merging it will NOT close the task, so close the issue by hand" >&2
    else
        cat >&2 <<EOF
open_task_pr: cannot resolve the issue handle for ${TASK_ID}, so a PR opened now
would merge without closing its task and leave the queue claiming work that is
already done. Nothing has been committed — your edits are untouched.

Fix one of these, then re-run:
  * pass the number you already have:  ARSENAL_TASK_ISSUE=<n> open_task_pr.sh ...
  * point at the session's issue list: ARSENAL_ISSUES_JSON=/tmp/arsenal-issues.json
  * create the missing handle:         python3 ${BUNDLE_SCRIPTS}/handle_sync.py --issues <file>
EOF
        exit 1
    fi
fi

# Where the caller started. The host gate now runs after this checkout (#256),
# so a refusal there has a branch switch to undo — and this script's own promise
# on a refusal is that nothing was committed and the tree is as it was. Leaving
# the caller on a branch they did not ask to be on is the same class of stray
# side effect the archive rollback exists to prevent.
_ENTRY_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
current="${_ENTRY_BRANCH}"
if [[ "${current}" != "${BRANCH}" ]]; then
    if git rev-parse --verify --quiet "${BRANCH}" >/dev/null 2>&1; then
        git checkout "${BRANCH}" >/dev/null 2>&1 || { echo "open_task_pr: cannot switch to ${BRANCH}" >&2; exit 1; }
    elif ! git checkout -b "${BRANCH}" "${default_ref}" >/dev/null 2>&1; then
        if ! git rev-parse --verify --quiet "${default_ref}" >/dev/null 2>&1; then
            echo "open_task_pr: cannot resolve default branch '${default_branch}' (ref '${default_ref}') to branch off" >&2
            exit 1
        fi
        _carry_onto "${BRANCH}" "${default_ref}" || exit 1
    fi
fi

# Archive the task file as part of THIS PR's diff.
#
# A finished task's file is not work any more — it is what makes a dep on
# completed work resolve instead of reading as unknown, and what keeps its gate
# on disk. `task_select.py` already reads `tasks/_history/` and already treats a
# `status: merged` front-matter key as terminal; nothing ever wrote either. So
# the archive was a step owed to some later session, and later sessions do not
# run it.
#
# Riding it in the PR fixes the timing exactly: the rename lands on the default
# branch at the moment the merge does, and if the PR never merges the task file
# never moves. No follow-up commit, no push to a protected branch, nothing to
# reconcile.
_ARCHIVED_LIVE=""
_ARCHIVED_DEST=""
_ARCHIVED_BACKUP=""
_ARCHIVED_INDEX=""

_unarchive_task_file() {
    [[ -n "${_ARCHIVED_BACKUP}" && -f "${_ARCHIVED_BACKUP}" ]] || return 0
    # Restore FIRST, delete second. Deleting the archive before the copy
    # succeeds is the one ordering where a failure leaves the task file at
    # neither path — the tree would come out of a refusal worse than it went in.
    if ! cp "${_ARCHIVED_BACKUP}" "${_ARCHIVED_LIVE}"; then
        echo "open_task_pr: could not restore ${_ARCHIVED_LIVE} from ${_ARCHIVED_BACKUP} — the archived copy at ${_ARCHIVED_DEST} is being left in place. Move it back by hand; the backup is at ${_ARCHIVED_BACKUP}." >&2
        return 1
    fi
    # The archive goes now; the BACKUP waits until the assertion below proves the
    # tree is actually back. Deleting it here made every later failure path — a
    # failed rm, a broken index restore — report "the backup has been kept" over
    # a backup that was already gone.
    rm -f "${_ARCHIVED_DEST}"
    # Put the INDEX back where it was, rather than staging the rollback: the
    # task file may have been untracked (a task added by this very PR) or
    # carrying unstaged edits, and `git add -A` would turn either into a staged
    # change the worker never made.
    local index_ok=1
    git rm -q --cached --ignore-unmatch -- "${_ARCHIVED_LIVE}" "${_ARCHIVED_DEST}" 2>/dev/null || index_ok=0
    if [[ -n "${_ARCHIVED_INDEX}" ]]; then
        printf '%s\n' "${_ARCHIVED_INDEX}" | git update-index --index-info 2>/dev/null || index_ok=0
    fi
    # Assert the outcome rather than the commands: `cp` succeeding is not the
    # same fact as the tree being back. An `rm` that fails leaves the archived
    # copy in place — the state `task_select.py` reads as finished work — and
    # every caller here treats this function's status as proof of restoration,
    # so a success returned over a half-undone tree is the claim that misleads.
    if [[ ! -f "${_ARCHIVED_LIVE}" || -e "${_ARCHIVED_DEST}" || "${index_ok}" != 1 ]]; then
        echo "open_task_pr: the rollback did not complete — ${_ARCHIVED_LIVE} should be present and ${_ARCHIVED_DEST} should be gone; check both, and the index, by hand." >&2
        return 1
    fi
    rm -f "${_ARCHIVED_BACKUP}"
    echo "open_task_pr: restored ${_ARCHIVED_LIVE} — the archive was undone" >&2
}

_archive_task_file() {
    local live="${ARSENAL_HOME}/tasks/${TASK_ID}.md"
    local hist_dir="${ARSENAL_HOME}/tasks/_history"
    local dest="${hist_dir}/${TASK_ID}.md"

    # An unlinked PR closes nothing, so archiving would record work as merged
    # while its issue stays open — a contradiction this script exists to prevent.
    # Leave the task file live: the PR is then just code, and the task is still
    # open, which is the truth.
    if [[ -z "${ISSUE}" ]]; then
        echo "open_task_pr: unlinked PR — leaving ${live} live, since merging it completes nothing" >&2
        return 0
    fi

    # No task file is legitimate (a task worked from a payload elsewhere); a
    # file that exists and cannot be archived is not. Every failure below is
    # fatal, because the PR body promises the archive and a half-done one leaves
    # exactly the drift this whole change removes.
    [[ -f "${live}" ]] || return 0

    # Keep a byte-exact copy OUTSIDE the tree. The archive is the last thing to
    # change the tree before the commit, so it is also the only thing that can
    # need undoing when the re-check below refuses — and a refusal that leaves
    # the task file moved contradicts this script's own "nothing has been
    # committed".
    _ARCHIVED_BACKUP="$(mktemp -t "arsenal-task-${TASK_ID}-XXXXXX.md")"
    cp "${live}" "${_ARCHIVED_BACKUP}" || { echo "open_task_pr: cannot back up ${live}" >&2; return 1; }
    _ARCHIVED_LIVE="${live}"
    _ARCHIVED_DEST="${dest}"
    # The index entry as it stands before the move — empty when the file is
    # untracked, which is itself the state to restore.
    _ARCHIVED_INDEX="$(git ls-files -s -- "${live}" 2>/dev/null || true)"

    mkdir -p "${hist_dir}" || { echo "open_task_pr: cannot create ${hist_dir}" >&2; return 1; }
    if ! git mv "${live}" "${dest}" 2>/dev/null; then
        mv "${live}" "${dest}" 2>/dev/null \
            || { echo "open_task_pr: cannot move ${live} to ${dest}" >&2; return 1; }
    fi

    # Stamp the terminal status inside the front matter, so the record survives
    # even if the issue is later deleted or the repo is read without GitHub.
    python3 - "${dest}" <<'PY' || { echo "open_task_pr: cannot stamp 'status: merged' into ${dest}" >&2; return 1; }
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
match = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n", text, re.DOTALL)
if not match:
    # Exiting 0 here read as "stamped", and the caller then failed its own
    # re-check of the same file and reported the vaguer "not a complete
    # archive" -- the two halves disagreeing about one case, with the specific
    # cause known here and thrown away. The refusal itself is right: a task
    # file with no front matter has no `id:` either, so `task_select.py` cannot
    # attribute it, and inventing a block to satisfy the check would archive a
    # record the queue still cannot read. Say what is actually wrong instead.
    print(
        f"open_task_pr: {path} has no front matter, so 'status: merged' has "
        "nowhere to go. A task file needs an `id:`/`title:` block; fix the "
        "file and re-run.",
        file=sys.stderr,
    )
    sys.exit(1)
front = match.group(1)
if re.search(r"^status:", front, re.MULTILINE):
    front = re.sub(r"^status:.*$", "status: merged", front, count=1, flags=re.MULTILINE)
else:
    front = front + "\nstatus: merged"
path.write_text(text[: match.start(1)] + front + text[match.end(1) :], encoding="utf-8")
PY
    # Assert the outcome rather than assume it: the PR body tells a reader the
    # gate lives at the archived path, and `task_select.py` only treats the file
    # as finished work when it parses a terminal `status`.
    if [[ ! -f "${dest}" ]] || ! grep -q '^status: merged$' "${dest}"; then
        echo "open_task_pr: ${dest} is not a complete archive (missing, or no 'status: merged')" >&2
        return 1
    fi
    echo "open_task_pr: archived ${live} -> ${dest} (status: merged)" >&2
}
if ! _archive_task_file; then
    # The undo belongs here, not at each `return 1` inside the function. Two of
    # those fire after `git mv` has already succeeded — the stamp, and the
    # re-check of it — and neither used to roll back, so the run refused while
    # leaving the task file in `_history/`. `task_select.py` reads it there as
    # finished work, so the task left the queue with nothing merged: the outcome
    # the backup was added to prevent, reached through a different door. One
    # call site covers every path out of the function, including later ones.
    restored=""
    if [[ -n "${_ARCHIVED_DEST}" && -e "${_ARCHIVED_DEST}" ]]; then
        if _unarchive_task_file; then
            restored=" The task file has been restored to ${ARSENAL_HOME}/tasks/."
        else
            restored=" THE ROLLBACK ALSO FAILED — see above; the tree needs a hand before re-running."
        fi
    fi
    echo "open_task_pr: refusing to open a PR whose task file could not be archived — the merge would close the issue and leave the task file live.${restored} Fix the error above and re-run; nothing has been committed." >&2
    exit 1
fi

# The host gate ran at the top, over a tree that did not yet contain the
# archive. Then the archive moved a tracked file — so the gate certified one
# tree and the commit carries another. Any host measurement over the repo's own
# files (a file count, a coverage denominator, a lint sweep) is then stale by
# exactly that file, and the host's next run fails on a branch whose gate had
# just passed (#220). Re-run it here, where the tree is final: a gate that
# regenerates its evidence writes the right numbers into this commit, and one
# that only checks confirms the tree being committed is the certified one.
# Not conditional on the archive: `_ARCHIVED_DEST` is empty for an unlinked PR
# and for a task worked from a payload elsewhere, and gating on it would leave
# those two cases running no host gate at all — a skip, in the one check the
# script says has deliberately no way to skip it.
if [[ -n "${host_gate}" ]]; then
    echo "open_task_pr: running host gate over the tree being committed: ${host_gate}" >&2
    if ! bash -c "${host_gate}" >&2; then
        # Say which of the two happened. Claiming the restoration unconditionally
        # told a reader the tree was back the way it started in exactly the case
        # where it is not, and that is the case where they have to act.
        if _unarchive_task_file; then
            restored="The task file has been restored to ${ARSENAL_HOME}/tasks/ — nothing was committed."
        else
            restored="THE ROLLBACK ALSO FAILED — see above; the tree needs a hand before re-running. Nothing was committed."
        fi
        # Uncommitted work follows a plain checkout, so this returns the caller
        # to the branch they ran from with their edits intact. Reported, not
        # silent: a switch that fails leaves them somewhere they did not choose,
        # and that is the case where they have to act.
        if [[ -n "${_ENTRY_BRANCH}" && "${_ENTRY_BRANCH}" != "HEAD" \
              && "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)" != "${_ENTRY_BRANCH}" ]]; then
            if git checkout "${_ENTRY_BRANCH}" >/dev/null 2>&1; then
                restored="${restored} You are back on ${_ENTRY_BRANCH}."
            else
                restored="${restored} NOTE: could not switch back to ${_ENTRY_BRANCH} — you are on ${BRANCH}."
            fi
        fi
        echo "open_task_pr: host gate failed (${host_gate}) — no PR opened. ${restored} The gate ran over the tree this PR would commit, with the task file already in ${ARSENAL_HOME}/tasks/_history/; if it passes over your working tree but fails here, it is measuring the repo's own files and the archive is the difference." >&2
        exit 1
    fi
fi
# Stage and commit — the shared-checkout guard above already cleared `git add
# -A`, and a dynamic Co-Authored-By is added only when supplied.
#
# The rescue backup is deliberately NOT deleted yet. It used to be dropped
# right here, before the commit, so a `git commit` that failed left the task
# file moved into `tasks/_history/` with `status: merged` — which the selector
# reads as finished work — and `_unarchive_task_file` had nothing to restore
# from. That is exactly what the rollback above exists to prevent.
git add -A

# `Closes #<issue>` goes in the commit message as well as the PR body. The body
# form only fires on a merge into the default branch; the commit form survives a
# squash merge and is what closes the issue for a stacked PR based on another
# branch. Writing both costs one line and removes a caveat nobody remembers.
commit_args=(-m "${TYPE}: ${TITLE}")
if [[ -n "${ISSUE}" ]]; then
    commit_args+=(-m "Closes #${ISSUE}")
fi
if [[ -n "${ARSENAL_COAUTHOR:-}" ]]; then
    commit_args+=(-m "Co-Authored-By: ${ARSENAL_COAUTHOR}")
fi
if ! commit_err="$(git commit "${commit_args[@]}" 2>&1 >/dev/null)"; then
    # Not "empty diff": `_archive_task_file` moved a tracked file and `git add
    # -A` staged it, so there IS something to commit whenever the archive ran.
    # Reaching here then means a hook, a git-config problem, or an identity that
    # cannot be resolved — and the message used to name the one cause that
    # cannot apply, sending the reader to look in the wrong place.
    # The backup is deleted per-branch, not once at the end: on the failed-rollback
    # branch the task file is still in tasks/_history/ and this byte-exact copy is
    # the only way back — and the failure message above names that exact path. The
    # host-gate failure path keeps it for the same reason.
    if [[ -n "${_ARCHIVED_DEST}" ]]; then
        if _unarchive_task_file; then
            restored="The task file has been restored to ${ARSENAL_HOME}/tasks/."
            [[ -n "${_ARCHIVED_BACKUP}" ]] && rm -f "${_ARCHIVED_BACKUP}"
        else
            restored="THE ROLLBACK ALSO FAILED — see above; the tree needs a hand before re-running. The backup at ${_ARCHIVED_BACKUP:-<none>} has been kept."
        fi
    else
        restored="Nothing had been archived, so the tree is unchanged."
        [[ -n "${_ARCHIVED_BACKUP}" ]] && rm -f "${_ARCHIVED_BACKUP}"
    fi
    echo "open_task_pr: could not commit ${TASK_ID} — no PR opened. ${restored} git said: ${commit_err:-<no output>}" >&2
    exit 1
fi
# The commit holds the archive now, so the backup has nothing left to protect.
[[ -n "${_ARCHIVED_BACKUP}" ]] && rm -f "${_ARCHIVED_BACKUP}"

# Push with exponential backoff (network-transient retry only).
delay=1
pushed=0
for _ in 1 2 3; do
    if git push -u "${REMOTE}" "${BRANCH}" >/dev/null 2>&1; then pushed=1; break; fi
    sleep "${delay}"
    delay=$((delay * 2))
done
if [[ "${pushed}" -ne 1 ]]; then
    echo "open_task_pr: push of ${BRANCH} to ${REMOTE} failed" >&2
    exit 1
fi

# The PR body. `Closes #<issue>` is the first line of the summary rather than a
# trailer, because a squash merge that truncates the body still keeps the top.
closes_line=""
[[ -n "${ISSUE}" ]] && closes_line="Closes #${ISSUE}"
if [[ -n "${ISSUE}" ]]; then
    gate_note="$(printf 'Acceptance gate in `%s/tasks/_history/%s.md` (archived by this PR); it passed before the PR was opened.' "${ARSENAL_HOME}" "${TASK_ID}")"
else
    gate_note="$(printf 'Acceptance gate in `%s/tasks/%s.md`; it passed before the PR was opened. This PR closes no issue, so merging it does NOT complete the task.' "${ARSENAL_HOME}" "${TASK_ID}")"
fi
# The review outcome rides in the body on purpose. stderr scrolls past and
# nobody re-reads a worker's log; the PR body is the one surface the person
# merging this actually looks at, so "nobody independent read this" has to be
# written where that decision is made.
# --body-file supplies the Summary prose in place of the bare title. It does
# NOT replace the whole body: `Closes #<issue>` is the completion mechanism and
# the review receipt is what the person merging reads, so neither is delegated
# to a caller-supplied file.
summary_prose="${TITLE}"
if [[ -n "${BODY_FILE}" ]]; then
    summary_prose="$(cat "${BODY_FILE}")"
fi
BODY="$(printf '## Summary\n\n%s\n\n%s\n\n## Test plan\n\n%s\n%s' \
    "${closes_line}" "${summary_prose}" "${gate_note}" \
    "$([[ -n "${review_note}" ]] && printf '\n%s\n' "${review_note}")")"
PR_TITLE="${TYPE}: ${TITLE}"

# Open the PR over whichever channel exists. `gh` first, then REST — the REST
# leg matters because the push-only outcome is not a completed task: it hands
# back a branch nobody has opened a PR for, and if the session ends there the
# task stays claimed with its work sitting on an orphan branch. Every surface
# that can reach the API should close that gap itself rather than delegate it.
if command -v gh >/dev/null 2>&1; then
    if url="$(gh pr create --base "${default_base}" --head "${BRANCH}" \
                --title "${PR_TITLE}" --body "${BODY}" 2>/dev/null)"; then
        echo "${url}"
        exit 0
    fi
fi

if slug="$(bash "${SCRIPT_DIR}/github_channel.sh" --slug 2>/dev/null)" && [[ -n "${slug}" ]]; then
    payload="$(python3 -c 'import json,sys; print(json.dumps({"title":sys.argv[1],"head":sys.argv[2],"base":sys.argv[3],"body":sys.argv[4]}))' \
        "${PR_TITLE}" "${BRANCH}" "${default_base}" "${BODY}" 2>/dev/null || true)"
    if [[ -n "${payload}" ]] \
        && response="$(bash "${SCRIPT_DIR}/github_channel.sh" --api POST "/repos/${slug}/pulls" "${payload}" 2>/dev/null)"; then
        url="$(printf '%s' "${response}" \
            | python3 -c 'import json,sys; print(json.load(sys.stdin).get("html_url",""))' 2>/dev/null || true)"
        if [[ -n "${url}" ]]; then
            echo "${url}"
            exit 0
        fi
    fi
fi

# No PR backend at all. Say what still has to happen, including the keyword —
# the caller opening this PR by hand is the one path where the body is written
# by someone other than this script.
echo "open_task_pr: no PR backend here — open the PR for ${BRANCH} with a body containing '${closes_line:-Closes #<issue>}', or the merge will not close the task" >&2
echo "branch:${BRANCH}"
exit 0
