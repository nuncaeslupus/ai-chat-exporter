#!/usr/bin/env python3
"""arsenal_config.py — read the host-owned `arsenal/config.toml`.

The point of this file is that a consumer configures behaviour **without
editing a skill**. Skills are vendored build output: an upgrade overwrites
them, so a preference stored in one is a preference that silently disappears.
`arsenal/config.toml` is host-owned and upstream never rewrites it.

Every key has a default, so a repo with no config file behaves sensibly and a
repo with a partial file only overrides what it names.

Keys are flat, except that a TOML table reads as dotted keys — `[models]`
with `workers = "sonnet"` is the key `models.workers`. Grouping the model
choices under one header is what lets a consumer state them the way they think
of them — one decision per role — rather than as unrelated top-level strings.

Usage:
    arsenal_config.py                      # print the effective config as JSON
    arsenal_config.py --get merge-policy   # print one value, bare
    arsenal_config.py --get models.workers # dotted key: a value inside a table
    arsenal_config.py --explain            # show each value and where it came from
    arsenal_config.py --new-settings       # keys added since config-acknowledged, unset here

Exit: 0 on success, 2 on an invalid value (a typo in a policy name is a
configuration bug worth failing loudly for, not silently defaulting past).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tomllib
from pathlib import Path
from typing import Any, NamedTuple


class Setting(NamedTuple):
    """One registered key: its default, the release that added it, and what it does.

    This table is the ONE registry of config keys (#496). The loader validates
    against it, `--explain` reports from it, and `--new-settings` derives the
    session-start notice from it — so a key cannot exist in one of those places
    and be missing from another. `config_keys_test.sh` fails the build on a key
    with no `since` or no description, because a key nobody is told about sits at
    its default in every downstream repo until someone happens to read the
    changelog.
    """

    default: Any
    since: str
    description: str


# The version recorded for every key that predates the registry. The releases
# before it did not record when each key arrived, and reconstructing that from
# the changelog would be prose-parsing by another name. It is also the floor a
# host is assumed to have acknowledged when its file says nothing: those keys
# reached it through the template, the docs and the changelog of their own
# release, so announcing all of them again on the first session after an
# upgrade would bury the one line that is actually new.
BASELINE = "5.6.0"

# Defaults live here rather than being scattered through the scripts that read
# them, so `--explain` can always say what the fallback is.
SETTINGS: dict[str, Setting] = {
    # How far a task PR must get before it may be merged. Read at the merge
    # step itself — `AGENTS.md` § Completion, expanded in
    # `references/github-automation.md`, which maps each value to a check.
    # It pointed at the `github` skill for six versions while nothing there,
    # or anywhere else in the bundle, ever read the key (#192): a policy
    # nothing consults decides nothing, and the cost is quiet — every merge
    # stops to ask a question the host already answered.
    "merge-policy": Setting(
        "after-ci", BASELINE, "How far a task PR must get before an agent may merge it."
    ),
    # Shell command run by open_task_pr.sh before a task PR is opened, refusing
    # on non-zero. Empty by default: a repo with no gate is unaffected. This is
    # what gives worker.md's "run the host lint gate" a data path — the prose
    # named `make lint` as its example, so a repo whose real gate is five
    # commands had four of them enforced by nobody.
    "host-gate": Setting(
        "", BASELINE, "Shell command run before a task PR opens; non-zero means no PR."
    ),
    # The cheap counterpart, run by `open_task_pr.sh <task> --preflight` over
    # the archived tree and nowhere else. Empty by default: the honest default
    # is that this bundle cannot see inside `make test`, so preflight without
    # it checks only that the gates RESOLVE.
    #
    # It exists for the one failure resolution cannot reach. The host gate runs
    # after the task file is archived into `tasks/_history/`, so a gate that
    # measures the repo's own files reads a different tree than the one the
    # worker tested — and the worker learns that from a refusal at the end of
    # the run (#220 is that failure, with the archive as the difference).
    # Declare the slice of the gate that touches those files here and preflight
    # finds it in seconds.
    #   preflight-gate = "make verify-gates"
    #
    # It is also the fast gate level (#463): bin/fast_gate.sh runs it on every
    # review round after the first, over ARSENAL_CHANGED_FILES, so the full
    # host-gate is paid once before the PR opens and once before merge rather
    # than once per push. Change-scoped lint/typecheck plus the tests the change
    # selects is the usual shape.
    "preflight-gate": Setting(
        "",
        BASELINE,
        "Cheap change-scoped slice of host-gate, run by --preflight and later review rounds.",
    ),
    # Shell command run by bin/host_setup.sh in a fresh worktree, before the
    # first gate. Empty by default. A worktree carries tracked files and nothing
    # an install produces, so the first gate in one fails on a missing tool
    # rather than on the change under test — and every worker rediscovers that
    # separately. Naming the command here is what turns it from a diagnosis
    # into a step.
    "host-setup": Setting(
        "",
        BASELINE,
        "Shell command that installs dependencies in a fresh worktree before the first gate.",
    ),
    # How hard the pre-PR adversarial review binds ON THE TASK-PR PATH. Read by
    # open_task_pr.sh and nowhere else, via bin/adversarial_review.sh, whose
    # `check` asks whether a reviewer that never saw this work cleared THIS
    # tree. It is not a global switch: `execution`, `github` and `ship` run the
    # same gate as a step of their own workflow, and a session following those
    # skills does not consult this key.
    #   warn      (default) open the PR either way, and record the outcome —
    #             cleared, blocked, stale, or never run — in the PR body, where
    #             the human merging it looks. Chosen as the default because a
    #             gate that breaks every existing worker loop on upgrade gets
    #             turned off, and one that says nothing gets forgotten.
    #   required  refuse to open the PR without a CLEAR receipt for this tree.
    #   off       skip the check and write no line.
    "pre-pr-review": Setting(
        "warn", BASELINE, "How hard the pre-PR adversarial review binds when a task PR is opened."
    ),
    # How many adversarial-review rounds one change gets before the loop is
    # declared non-convergent. Read by bin/adversarial_review.sh, which refuses
    # to emit a packet past it. Round two is a follow-up on the previous
    # findings plus the delta, and only BLOCKERs earn it.
    #
    # The counter belongs to the branch, not the base commit: when it was bound
    # to the base, every rebase or base merge restarted it, and one PR ran eight
    # rounds of ~40 minutes under a cap of three. `adversarial_review.sh --reset`
    # starts over deliberately.
    "review-max-rounds": Setting(
        2,
        BASELINE,
        "Adversarial-review rounds one change gets before the loop is declared non-convergent.",
    ),
    # How often a session stops to ask the user. Read by AGENTS.md, which every
    # session loads; /init sets it from the setup interview.
    #   ask-often         confirm each step before taking it
    #   ask-when-blocked  ask only when blocked or before a risky action
    #   autonomous        never wait on the user for reversible work
    "autonomy": Setting("ask-when-blocked", BASELINE, "How often a session stops to ask the user."),
    # How deep local verification goes, given what CI and the review bots
    # already did on the PR. Read by scripts/review_sources.py (the decision
    # line every caller follows), bin/fast_gate.sh and bin/adversarial_review.sh.
    #   fast      local review only for high-risk diffs or when nothing external ran
    #   balanced  no local review when CI and a bot both passed a low-risk diff;
    #             one diff review, targeted tests only, when the bots are out
    #   strict    always one local review; reviewer may run the full suite and
    #             mutations; no CI-green shortcut at merge
    "verification": Setting(
        "balanced",
        BASELINE,
        "How deep local verification goes, given what CI and the review bots already did.",
    ),
    # Minutes one review round is told it has, as an elapsed/budget line in the
    # packet. Advisory to the reviewer; the dispatcher stops waiting at twice it.
    "review-budget-min": Setting(
        10, BASELINE, "Minutes one adversarial-review round is told it has."
    ),
    # Minutes a configured review bot may stay silent on a PR head before
    # review_sources.py sends its trigger (see bot-triggers) and, after a
    # second wait, records it as absent so the loop moves on.
    "bot-wait-min": Setting(
        20,
        BASELINE,
        "Minutes a review bot may stay silent on a PR head before it counts as absent.",
    ),
    # Manual review commands, one "login=comment" per bot. A bot that skipped
    # the PR (some skip small or unstarred repos) or stayed silent gets this
    # comment once per head. Empty means never post one. A starting value: /init
    # suggests entries for the bots in review-bots.
    "bot-triggers": Setting(
        [],
        BASELINE,
        "Manual review commands, one login=comment per bot, posted once per head.",
    ),
    # Globs whose change always gets a local review round, whatever CI and the
    # bots said (auth, migrations, release scripts — your call).
    "risk-paths": Setting([], BASELINE, "Globs whose change always gets a local review round."),
    # A diff larger than this many changed lines always gets a local round.
    "risk-lines": Setting(
        400, BASELINE, "Changed-line count above which a diff always gets a local review round."
    ),
    # Extra phrases, as case-insensitive regexes, that mean a review bot will
    # not review this head. review_sources.py ships a starting table (rate
    # limits, free-tier and plan caps, "fewer than N stars" skips, pauses);
    # these are appended to it, for a reviewer that words its notice another
    # way. A match reads as `unavailable` (skipped): one trigger, then the
    # decision falls through to the local review rather than waiting (#507).
    "bot-unavailable-notices": Setting(
        [], "5.7.0", "Extra regexes that mark a review bot unavailable (beyond the shipped table)."
    ),
    # Which review bots the PR review loop waits on, by GitHub username. Read
    # by the github skill's query_pr_state.py, which watches for their :eyes:,
    # their line comments and their approval before a PR is callable.
    #
    # Empty by default since 5.19.0: a shipped list of vendor bots made every
    # repo running none of them wait on a signal that was never coming. Empty
    # means CI-only — `ready_to_merge` rests on green CI alone — so a host with
    # a bot lists it here (the setup interview asks); `since` is 5.19.0 so an
    # existing host is told once that the default changed.
    "review-bots": Setting(
        [],
        "5.19.0",
        "Review bots the PR loop waits on; empty (default since 5.19.0) means CI-only.",
    ),
    # The skills-listing character budget the auditor enforces. It is a real
    # constraint, but its value differs by surface and has changed over time,
    # so a consumer whose budget differs can set it here instead of being
    # unable to pass the audit at all (#143).
    "listing-budget": Setting(
        8000, BASELINE, "Skills-listing character budget the auditor enforces."
    ),
    # Whether `/init` keeps .github/workflows/arsenal-queue.yml installed. Set
    # to `true` on first install and to `false` when the file is found deleted,
    # so removing it is a real opt-out rather than something the next session's
    # `init --silent` quietly undoes.
    "queue-automation": Setting(
        True, BASELINE, "Whether /init keeps the queue workflow installed."
    ),
    # What `/init` did about GitHub branch protection on the default branch,
    # recorded so the API is asked once rather than on every run: applied,
    # existing (a rule was already there and was left alone), unavailable
    # (GitHub refused — a plan or permission limit), or off (--no-branch-protection).
    # Empty = not yet attempted. Clear it to have the next `/init` try again.
    "branch-protection": Setting(
        "",
        BASELINE,
        "What /init did about branch protection on the default branch (recorded, not chosen).",
    ),
    # The label an issue must carry before `issue_import.py` turns it into a
    # task. Opt-in on purpose: every open issue becoming claimable work means a
    # worker opens a PR against a question someone asked.
    "import-label": Setting(
        "arsenal:queue",
        BASELINE,
        "Label an issue must carry before issue_import.py turns it into a task.",
    ),
    # Where host-owned project content lives, relative to the repo root.
    "home": Setting(
        "arsenal",
        BASELINE,
        "Where host-owned project content lives (set via ARSENAL_HOME, not this file).",
    ),
    # The label that marks an issue as a machine-managed task handle. Anything
    # without it is never treated as claimable work, which is what keeps
    # ordinary issues people file out of the queue.
    "task-label": Setting(
        "arsenal:task", BASELINE, "Label that marks an issue as a machine-managed task handle."
    ),
    # Ref namespace for atomic claim refs.
    "claim-prefix": Setting("arsenal/claims", BASELINE, "Ref namespace for atomic claim refs."),
    # Which skill sections /init vendors into .claude/skills/, on top of the
    # always-installed core. Registered here so `--explain` can report them and
    # so the loader keeps them; the values are written by init.py from the
    # profile chosen at install, not hand-seeded into the config template —
    # one writer, so the shipped defaults and the recorded answer cannot drift.
    # The defaults here are what a FRESH install gets; an upgrade preserves
    # whatever the repo already had (init.py:_resolve_sections).
    "skills.workflow": Setting(True, BASELINE, "Whether /init vendors the workflow skill section."),
    "skills.python": Setting(False, BASELINE, "Whether /init vendors the python skill section."),
    # The auto-compact threshold, in tokens, written into the host's
    # `.claude/settings.json` as `autoCompactWindow` by `/init`. 0 means "no
    # opinion" — leave whatever the harness defaults to, and never touch a value
    # already in settings.json.
    #
    # This is the largest single lever on what a fleet costs, and it is the one
    # that reads backwards. Cost is `turns x context`, not output: a day of nine
    # sessions read 438M tokens to write 1.3M. A host that raises its window to
    # "avoid filling up" raises the per-turn floor instead of lowering it —
    # replaying those same turns at lower caps gives 500k -> 453M, 300k -> 387M,
    # 200k -> 287M, 120k -> 186M. Compaction is the cheap event; carrying the
    # context that postpones it is the expensive one.
    #
    # Off by default because the right value is a judgement about this repo's
    # work, not one upstream can make: too low and sessions compact mid-task and
    # re-read what they dropped, which costs turns instead of context. Set it,
    # measure with scripts/usage_report.py, move it.
    "context-window": Setting(
        0,
        BASELINE,
        "Auto-compact threshold in tokens written into .claude/settings.json; 0 = no opinion.",
    ),
    # Which model runs the session that dispatches work. Advisory, and the one
    # key here nothing can enforce from inside a session: a session cannot
    # change the model it is already running as, so this is read and reported
    # at session start for the person launching it (`claude --model <value>`).
    # Empty means "whatever the session was launched with" — no opinion.
    "models.orchestrator": Setting(
        "", BASELINE, "Model the dispatching session should run as (advisory)."
    ),
    # Which model runs worker subagents. This one has a data path: the
    # orchestrator resolves it and passes it as the dispatch's own model
    # argument, so it governs every worker in the session. It used to be a
    # model id hardcoded in the protocol prose, which meant a consumer who
    # wanted a different one had to edit a vendored file an upgrade overwrites.
    #
    # The transport is the dispatch argument and not an exported
    # CLAUDE_CODE_SUBAGENT_MODEL because on cloud surfaces every Bash call gets
    # a fresh shell: the export died with the call that made it, and the fleet
    # ran on the orchestrator's model — the expensive default — while this key
    # resolved to something cheaper and governed nothing (#379).
    "models.workers": Setting("sonnet", BASELINE, "Model worker subagents are dispatched with."),
    # Which model runs adversarial reviewer subagents (`agents/reviewer.md`,
    # dispatched from a case file by bin/adversarial_review.sh). Empty means
    # "no separate opinion — use models.workers", which is why it is not
    # defaulted to a model name: copying the workers value here would make the
    # two drift the moment a consumer edits one of them.
    #
    # It exists because the roles are not symmetric. An implementer is usually
    # applying a named remedy; the reviewer derives the spec and mutates
    # against a change it has never seen, and it is the half that earns the
    # stronger model. Before this key the only lever was `models.workers`,
    # which governs the other half — and a `reviewers = ...` written anyway
    # parsed fine, sat in the file looking configured, and reached nothing,
    # because unknown keys are tolerated on read (below). A key that records a
    # decision and changes nothing is worse than no key (#380).
    "models.reviewers": Setting(
        "",
        BASELINE,
        "Model adversarial reviewer subagents are dispatched with; empty = models.workers.",
    ),
    # Whose reviewer marker may clear a PR head for the review half of
    # merge-policy. Read by scripts/pr_audit.py (via bin/merge_ready.sh), which
    # documents the marker and the rule; `[review]` table in the file.
    #   distinct-session  (default) the author's own login also counts, when
    #                     the marker names a reviewer session that is none of
    #                     the sessions in the PR's `Claude-Session:` commit
    #                     trailers. For an agent fleet where every session
    #                     posts with one credential, which makes distinct-login
    #                     unsatisfiable. A subagent shares its parent's session
    #                     id, so the reviewer must run as its own session (#495).
    #   distinct-login    the marker must be written by a login other than the
    #                     PR author's. Right for a repo whose second reader is a
    #                     human or a bot account on another login.
    "review.reviewer-identity": Setting(
        "distinct-session",
        "5.7.0",
        "Whose review marker clears a PR: distinct-session, or distinct-login for other logins",
    ),
    # Who approves a PR, by risk tier — read by scripts/review_policy.py, which
    # classifies the PR (low / medium / high) and turns the tier into what
    # pr_audit.py waits for. Empty keeps merge-policy alone in charge, exactly as
    # before the key existed. The presets, one line each:
    #   solo-trust  agent merges every tier; high-tier merges flagged to ratify
    #   solo-gated  a human approves medium and high
    #   team        agent review on low, 1 human on medium, 2 on high
    #   manual      no agent merges (merge-policy never)
    "review.preset": Setting(
        "",
        "5.11.0",
        "Who approves by risk tier (solo-trust, solo-gated, team, manual); empty = merge-policy.",
    ),
    # Globs that always need a human, whatever the preset says: any match makes
    # the PR high-risk and requires at least one human approval.
    "review.always-human-paths": Setting(
        [],
        "5.11.0",
        "Globs whose change always needs a human approval, whatever review.preset says.",
    ),
    # Globs a PR must ONLY touch to be low-risk. Empty = the built-in docs/config
    # set review_sources.py already uses. High is risk-paths / risk-lines.
    "review.low-paths": Setting(
        [],
        "5.11.0",
        "Globs a PR may only touch to be low-risk; empty = the built-in docs/config set.",
    ),
    # Per-tier override of the preset row: auto | agent | human:<N> | human-after.
    "review.approval-low": Setting(
        "",
        "5.11.0",
        "Approval for low-risk PRs (auto, agent, human:N, human-after); empty = preset row.",
    ),
    "review.approval-medium": Setting(
        "",
        "5.11.0",
        "Approval for medium-risk PRs (auto, agent, human:N, human-after); empty = preset row.",
    ),
    "review.approval-high": Setting(
        "",
        "5.11.0",
        "Approval for high-risk PRs (auto, agent, human:N, human-after); empty = preset row.",
    ),
    # When a digest approval counts as a human one (scripts/pr_audit.py): a
    # `<!-- arsenal-decision: approve head=<sha> via=digest -->` marker written by
    # apply_decisions.py from the human's exported decisions file. Off by default:
    # the agent writes the marker, so the trust is in that file, not in GitHub.
    # On lets solo-gated work when the agent opens PRs with the owner's account.
    "review.digest-decisions": Setting(
        False, "5.12.0", "Count a digest approval marker on the head as one human approval."
    ),
    # Where `digest.py render` puts the digest at its triggers (session end, the
    # quota stop, every digest-every merges): file (HTML path printed), chat
    # (Markdown printed), or both.
    "digest-delivery": Setting(
        "file", "5.12.0", "Where the review digest goes: file, chat or both."
    ),
    # Also render after this many merges in one session; 0 = only at session end.
    "digest-every": Setting(
        5, "5.12.0", "Render the review digest after this many merges; 0 = at session end only."
    ),
    # The "built with claude-arsenal" badge `/init` puts under the README's
    # title, read by init.py and nowhere else. Like a license notice it says
    # where the tooling came from and links to it, and like any notice the host
    # may drop it: set false, or delete the block — once init has recorded
    # `true` it never puts a deleted badge back.
    "attribution": Setting(
        True,
        "5.10.0",
        "Keep a 'built with claude-arsenal' badge in README.md; false (or deleting it) drops it.",
    ),
    # The newest bundle version whose new settings this host has looked at.
    # `--new-settings` (run by `init.py` at every session start) prints one
    # NEW SETTING line per key added after it that the file does not set, and
    # nothing at all once each is set or this is raised past it. Empty means
    # BASELINE. `/init` seeds it with the installing version, so a fresh host
    # is not told about keys its own template just showed it.
    "config-acknowledged": Setting(
        "", "5.7.0", "Newest bundle version whose new settings this host has acknowledged."
    ),
    # Whether the /init setup interview has been answered: the date it was
    # recorded, or "declined" when the user chose to skip it. Absent, init.py
    # prints `SETUP INTERVIEW PENDING` on every run, --silent included. It used
    # to be asked on a first install only, so a host installed before the
    # interview existed (or one whose first install skipped it) was never asked
    # at all, and its user repeated the same answers by hand every session.
    "setup-interview": Setting(
        "", "5.18.0", 'When the setup interview was answered (YYYY-MM-DD), or "declined".'
    ),
}

DEFAULTS: dict[str, Any] = {key: s.default for key, s in SETTINGS.items()}

# Keys the session-start notice never announces: acknowledging is the remedy the
# notice itself names, so a line telling the host about it would be noise.
# `setup-interview` has its own, louder line (SETUP INTERVIEW PENDING), so a
# NEW SETTING line for it would say the same thing twice.
NOTICE_EXEMPT = {"config-acknowledged", "home", "setup-interview"}

VERSION_REGEX = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
SETUP_INTERVIEW_REGEX = re.compile(r"^\d{4}-\d{2}-\d{2}$")

ENUMS: dict[str, set[str]] = {
    # `after-review` is not a weaker `after-ci-and-review` — it is the other
    # axis. `after-ci` is "the machines agree"; `after-review` is "a reader
    # agrees"; a repo should be able to require either, both, or neither.
    # Without it, a repo whose CI is structurally unavailable — out of runner
    # minutes, or no CI at all — can only choose between a policy that blocks
    # every merge indefinitely and one that everybody learns to wave through.
    "merge-policy": {"always", "after-review", "after-ci", "after-ci-and-review", "never"},
    # open_task_pr.sh compares this against the literal "required", so anything
    # else — "Required", "requried", "on" — takes the warn path: the PR opens,
    # its body says no review ran, and the consumer who wrote the value believes
    # a binding gate is in place. A misspelled opt-out fails the other way,
    # writing a line into the body of someone who switched the check off.
    "pre-pr-review": {"warn", "required", "off"},
    "verification": {"fast", "balanced", "strict"},
    "autonomy": {"ask-often", "ask-when-blocked", "autonomous"},
    "branch-protection": {"", "applied", "existing", "unavailable", "off"},
    "review.reviewer-identity": {"distinct-login", "distinct-session"},
    "review.preset": {"", "solo-trust", "solo-gated", "team", "manual"},
    "digest-delivery": {"file", "chat", "both"},
}

APPROVAL_REGEX = re.compile(r"^(|auto|agent|human-after|human:[1-9])$")

CONFIG_RELPATH = "config.toml"

# What reads each key, by path from the repository root. A key with no reader
# is a setting that scaffolds, validates, round-trips through `--explain`, and
# changes nothing — six shipped that way, and the worst of them was documented
# in AGENTS.md as configurable, so a consumer who set it silently imported no
# issues at all. `config_keys_test.sh` asserts this map covers DEFAULTS and
# that each named file mentions its key, which is what makes adding a key
# without wiring it a failing build rather than a discovery months later.
READERS = {
    "merge-policy": "plugins/core/skills/init/assets/bin/merge_ready.sh",
    "host-gate": "plugins/core/skills/init/assets/bin/open_task_pr.sh",
    "preflight-gate": "plugins/core/skills/init/assets/bin/open_task_pr.sh",
    "host-setup": "plugins/core/skills/init/assets/bin/host_setup.sh",
    "pre-pr-review": "plugins/core/skills/init/assets/bin/open_task_pr.sh",
    "review-max-rounds": "plugins/core/skills/init/assets/bin/adversarial_review.sh",
    "verification": "plugins/core/skills/init/assets/scripts/review_sources.py",
    "autonomy": "plugins/core/skills/init/assets/AGENTS.md",
    "review-budget-min": "plugins/core/skills/init/assets/bin/adversarial_review.sh",
    "bot-wait-min": "plugins/core/skills/init/assets/scripts/review_sources.py",
    "bot-triggers": "plugins/core/skills/init/assets/scripts/review_sources.py",
    "risk-paths": "plugins/core/skills/init/assets/scripts/review_sources.py",
    "risk-lines": "plugins/core/skills/init/assets/scripts/review_sources.py",
    "review-bots": "plugins/core/skills/github/scripts/query_pr_state.py",
    "bot-unavailable-notices": "plugins/core/skills/init/assets/scripts/review_sources.py",
    "listing-budget": "plugins/skill-workshop/skills/skill-workshop/scripts/audit_library.py",
    "queue-automation": "plugins/core/skills/init/scripts/init.py",
    "branch-protection": "plugins/core/skills/init/scripts/init.py",
    "attribution": "plugins/core/skills/init/scripts/init.py",
    "import-label": "plugins/core/skills/init/assets/scripts/issue_import.py",
    "task-label": "plugins/core/skills/init/assets/scripts/queue_hooks.py",
    "claim-prefix": "plugins/core/skills/init/assets/scripts/queue_hooks.py",
    # `[skills]` is read as a table, so init.py never names a section: the names
    # are data, and sections.json is where one is declared.
    "skills.workflow": "plugins/core/skills/init/assets/sections.json",
    "skills.python": "plugins/core/skills/init/assets/sections.json",
    "context-window": "plugins/core/skills/init/scripts/init.py",
    "models.orchestrator": "plugins/core/skills/init/assets/AGENTS.md",
    "models.workers": "plugins/core/skills/init/assets/agents/worker.md",
    "models.reviewers": "plugins/core/skills/init/assets/agents/reviewer.md",
    "review.reviewer-identity": "plugins/core/skills/init/assets/scripts/pr_audit.py",
    "review.preset": "plugins/core/skills/init/assets/scripts/review_policy.py",
    "review.always-human-paths": "plugins/core/skills/init/assets/scripts/review_policy.py",
    "review.low-paths": "plugins/core/skills/init/assets/scripts/review_policy.py",
    "review.approval-low": "plugins/core/skills/init/assets/scripts/review_policy.py",
    "review.digest-decisions": "plugins/core/skills/init/assets/scripts/pr_audit.py",
    "digest-delivery": "plugins/core/skills/init/assets/scripts/digest.py",
    "digest-every": "plugins/core/skills/init/assets/references/orchestrator-tick.md",
    "review.approval-medium": "plugins/core/skills/init/assets/scripts/review_policy.py",
    "review.approval-high": "plugins/core/skills/init/assets/scripts/review_policy.py",
    # Read here, by new_settings() below; init.py prints what it returns.
    "config-acknowledged": "plugins/core/skills/init/assets/scripts/arsenal_config.py",
    "setup-interview": "plugins/core/skills/init/scripts/init.py",
    # `home` is the exception, and the only one: it names the directory holding
    # config.toml, so it cannot be read from config.toml. ARSENAL_HOME is the
    # channel, and FILE_ONLY_REJECTS below refuses the key in the file rather
    # than accepting it and relocating nothing.
    "home": None,
}

# Keys that must not be set in the file. Accepting one there looks like it
# works — `--explain` echoes it back — and does nothing at all.
FILE_ONLY_REJECTS = {
    "home": "ARSENAL_HOME (the file lives inside the directory this names)",
}


class ConfigError(Exception):
    """An invalid configuration value — loud on purpose."""


def _config_path(repo_root: Path, home: str) -> Path:
    return repo_root / home / CONFIG_RELPATH


# A model may be an alias Claude Code resolves (`opus`, `sonnet`, `haiku`) or a
# full model id. Deliberately not an enum: model names change every few months,
# and a closed set here would reject the model a consumer is actually running
# — the vendored file would have to ship a new version to allow a name that
# already works everywhere else. So the check is on shape, not membership: a
# bare token, because the value is interpolated into a dispatch argument (and,
# on surfaces where it survives, an exported environment variable), and
# anything with quotes, spaces or shell metacharacters in it is a typo at best.
MODEL_VALUE_REGEX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")

MODEL_KEYS = ("models.orchestrator", "models.workers", "models.reviewers")

# Claude Code's own accepted bounds for `autoCompactWindow`; it additionally caps
# the value at the running model's context window, which is not knowable here.
CONTEXT_WINDOW_RANGE = (100_000, 1_000_000)


def _flatten(raw: dict[str, Any]) -> dict[str, Any]:
    """One level of TOML table → dotted keys: `[models] workers=` → `models.workers`.

    Only one level, because the config is a flat list of settings that happens
    to group two of them. Recursing would invite a nesting depth nobody reading
    `--explain` output could hold in their head.
    """
    flat: dict[str, Any] = {}
    for key, value in raw.items():
        if isinstance(value, dict):
            for sub, subvalue in value.items():
                flat[f"{key}.{sub}"] = subvalue
        else:
            flat[key] = value
    return flat


def load(repo_root: Path | None = None) -> tuple[dict[str, Any], dict[str, str]]:
    """Return (effective config, source-of-each-value).

    Sources are reported so `--explain` can print "8000 (default)" versus
    "12000 (arsenal/config.toml)". A threshold whose value is invisible in the
    output is one nobody can tell has been quietly raised.
    """
    root = repo_root or Path.cwd()
    values: dict[str, Any] = dict(DEFAULTS)
    sources: dict[str, str] = dict.fromkeys(DEFAULTS, "default")

    # ARSENAL_HOME may relocate the whole host-owned tree; it also decides
    # where we look for the config itself, so it is resolved first.
    # `or`, not a get() default: an exported but empty ARSENAL_HOME would
    # otherwise make the host root the empty string, putting every
    # host-owned path at the repo root.
    home = os.environ.get("ARSENAL_HOME") or DEFAULTS["home"]
    if home != DEFAULTS["home"]:
        values["home"] = home
        sources["home"] = "ARSENAL_HOME"

    path = _config_path(root, home)
    if path.is_file():
        try:
            raw = tomllib.loads(path.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as exc:
            raise ConfigError(f"{path}: not valid TOML — {exc}") from exc
        for key, value in _flatten(raw).items():
            if key in FILE_ONLY_REJECTS:
                raise ConfigError(
                    f"{path}: {key} cannot be set here — use {FILE_ONLY_REJECTS[key]}"
                )
            if key not in DEFAULTS:
                # Unknown keys are tolerated rather than fatal: a consumer on
                # an older bundle should not break when a newer one adds a key,
                # and vice versa.
                continue
            values[key] = value
            sources[key] = str(path)

    # `host-gate = "none"` is the recorded answer "this repo has no gate", as
    # distinct from an empty value nobody chose — init nags about the second
    # and not the first. Every reader runs a non-empty value as a command, so
    # it is normalised here, once, rather than taught to each of them.
    if isinstance(values["host-gate"], str) and values["host-gate"].strip().lower() == "none":
        values["host-gate"] = ""

    for key, allowed in ENUMS.items():
        # The isinstance() guard comes first because TOML permits an array or a
        # table for any key, and both are unhashable: `value not in allowed`
        # would raise TypeError and print a traceback instead of the readable
        # ConfigError this function documents.
        if not isinstance(values[key], str) or values[key] not in allowed:
            raise ConfigError(
                f"{key}: {values[key]!r} is not one of {sorted(allowed)} (from {sources[key]})"
            )
    # Same strictness init.py applies when it reads this table: a non-boolean
    # here decides whether skills are installed or pruned, so a typo must stop
    # rather than be coerced.
    for key in (k for k in DEFAULTS if k.startswith("skills.")):
        if not isinstance(values[key], bool):
            raise ConfigError(
                f"{key} must be true or false, got {values[key]!r} (from {sources[key]})"
            )
    # `type(...) is int`, not `isinstance`: `bool` subclasses `int` in Python, so
    # `listing-budget = true` passed validation and produced `True` — which then
    # behaves as the number 1 everywhere downstream, capping the skills listing
    # at one character rather than being refused as the wrong type.
    if type(values["listing-budget"]) is not int or values["listing-budget"] <= 0:
        raise ConfigError(
            f"listing-budget must be a positive integer, got {values['listing-budget']!r}"
        )
    # Same `type(...) is int` guard and the same reason as listing-budget above:
    # `review-max-rounds = true` would otherwise validate and cap the review at
    # one round, which reads as the gate having become stricter on its own.
    if type(values["review-max-rounds"]) is not int or values["review-max-rounds"] < 1:
        raise ConfigError(
            f"review-max-rounds must be an integer >= 1, got "
            f"{values['review-max-rounds']!r} (from {sources['review-max-rounds']})"
        )
    for key in ("review-budget-min", "bot-wait-min", "risk-lines"):
        if type(values[key]) is not int or values[key] < 1:
            raise ConfigError(
                f"{key} must be an integer >= 1, got {values[key]!r} (from {sources[key]})"
            )
    if not isinstance(values["review.digest-decisions"], bool):
        raise ConfigError(
            f"review.digest-decisions must be true or false, got "
            f"{values['review.digest-decisions']!r} (from {sources['review.digest-decisions']})"
        )
    if type(values["digest-every"]) is not int or values["digest-every"] < 0:
        raise ConfigError(
            f"digest-every must be an integer >= 0, got {values['digest-every']!r} "
            f"(from {sources['digest-every']})"
        )
    for key in ("review.approval-low", "review.approval-medium", "review.approval-high"):
        if not isinstance(values[key], str) or not APPROVAL_REGEX.match(values[key]):
            raise ConfigError(
                f"{key}: {values[key]!r} is not auto, agent, human:<1-9> or human-after "
                f"(from {sources[key]})"
            )
    for key in (
        "risk-paths",
        "bot-triggers",
        "bot-unavailable-notices",
        "review.always-human-paths",
        "review.low-paths",
    ):
        if not isinstance(values[key], list) or not all(isinstance(v, str) for v in values[key]):
            raise ConfigError(
                f"{key} must be a list of strings, got {values[key]!r} (from {sources[key]})"
            )
    for pattern in values["bot-unavailable-notices"]:
        try:
            re.compile(pattern)
        except re.error as exc:
            raise ConfigError(
                f"bot-unavailable-notices: {pattern!r} is not a valid regex ({exc}) "
                f"(from {sources['bot-unavailable-notices']})"
            ) from exc
    for entry in values["bot-triggers"]:
        login, sep, comment = entry.partition("=")
        if not sep or not login.strip() or not comment.strip():
            raise ConfigError(
                f'bot-triggers entries are "login=comment", got {entry!r} '
                f"(from {sources['bot-triggers']})"
            )
    # A list, because that is what it is — and a bare string here would be a
    # comma-separated list nobody told the consumer about. Empty is legal and
    # means "no review bot in this repo"; the reader below documents what that
    # costs.
    bots = values["review-bots"]
    if not isinstance(bots, list) or not all(isinstance(b, str) for b in bots):
        raise ConfigError(
            f"review-bots must be a list of usernames, got {bots!r} (from {sources['review-bots']})"
        )
    # Same `type(...) is int` guard and the same reason as listing-budget above.
    # The bounds are Claude Code's own for `autoCompactWindow`; a value outside
    # them is rejected here rather than written into settings.json, because a
    # settings key the harness discards is precisely the failure this key exists
    # to end — it would sit in two files looking configured and govern nothing.
    window = values["context-window"]
    low, high = CONTEXT_WINDOW_RANGE
    if type(window) is not int or (window != 0 and not low <= window <= high):
        raise ConfigError(
            f"context-window must be 0 (no opinion) or an integer between {low} "
            f"and {high}, got {window!r} (from {sources['context-window']})"
        )
    ack = values["config-acknowledged"]
    if not isinstance(ack, str) or (ack and not VERSION_REGEX.match(ack)):
        raise ConfigError(
            f'config-acknowledged must be a version like "5.7.0", got {ack!r} '
            f"(from {sources['config-acknowledged']})"
        )
    # Quoted in the file: a bare TOML date (setup-interview = 2026-01-31) parses
    # as a datetime.date, which every reader would then have to special-case.
    done = values["setup-interview"]
    if not isinstance(done, str) or (
        done and done != "declined" and not SETUP_INTERVIEW_REGEX.match(done)
    ):
        raise ConfigError(
            f'setup-interview must be a quoted date like "2026-01-31" or "declined", '
            f"got {done!r} (from {sources['setup-interview']})"
        )
    for key in MODEL_KEYS:
        value = values[key]
        if not isinstance(value, str):
            raise ConfigError(f"{key} must be a string, got {value!r} (from {sources[key]})")
        # Empty is meaningful for the orchestrator ("no opinion, use whatever
        # the session was launched with") and for reviewers ("no separate
        # opinion, use models.workers"). It is meaningless for workers, which
        # would hand the dispatch an empty model argument and silently get the
        # default — a setting that looks configured and is not.
        if value == "":
            if key == "models.workers":
                raise ConfigError(
                    "models.workers cannot be empty — name a model, or remove the key "
                    f"to get the default {DEFAULTS['models.workers']!r}"
                )
            continue
        if not MODEL_VALUE_REGEX.match(value):
            raise ConfigError(
                f"{key}: {value!r} is not a model name — expected a tier alias like "
                f"'opus' or a full model id (from {sources[key]})"
            )

    return values, sources


# A capability name lands in surface_profile.json and in `requires:` lists, so
# it is held to the shape those already use: `surface:cli`, `net:example.com`.
CAPABILITY_NAME_REGEX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")


def capability_probes(repo_root: Path | None = None) -> dict[str, str]:
    """The host's `[capabilities]` table: capability name → probe command.

    `detect_surface.sh` runs each probe and grants the capability only on exit
    0. What differs between a laptop and a cloud container in a real repo —
    network egress to one host, a gitignored data directory — is not on the
    script's hard-coded list, and a hand-passed `--capability` is a claim
    nothing checks (#481). Kept out of DEFAULTS because the keys are the host's
    own, not settings this bundle knows.
    """
    root = repo_root or Path.cwd()
    home = os.environ.get("ARSENAL_HOME") or DEFAULTS["home"]
    path = _config_path(root, home)
    if not path.is_file():
        return {}
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"{path}: not valid TOML — {exc}") from exc
    table = raw.get("capabilities", {})
    if not isinstance(table, dict):
        raise ConfigError(f'{path}: [capabilities] must be a table of name = "command"')
    probes: dict[str, str] = {}
    for name, command in table.items():
        if not CAPABILITY_NAME_REGEX.match(name):
            raise ConfigError(f"{path}: capability name {name!r} — use letters, digits and ._:/-")
        if not isinstance(command, str) or not command.strip():
            raise ConfigError(f"{path}: capability {name!r} needs a non-empty probe command")
        probes[name] = command
    return probes


def _version(text: str) -> tuple[int, ...]:
    match = VERSION_REGEX.match(text)
    if not match:
        raise ValueError(f"not a version: {text!r}")
    return tuple(int(part) for part in match.groups())


def _toml_value(value: Any) -> str:
    """A default as it would be written in config.toml, so it can be pasted."""
    return json.dumps(value) if not isinstance(value, bool) else str(value).lower()


def new_settings(repo_root: Path | None = None) -> list[str]:
    """One NEW SETTING line per key this host has not set and not acknowledged.

    A key is announced when its `since` is newer than the host's
    `config-acknowledged` (BASELINE when unset) and the file does not set it.
    Setting the key, or raising `config-acknowledged` to at least its `since`,
    silences it for good. Derived from SETTINGS, never from the changelog: the
    registry the loader validates against is the only list there is.

    An unreadable or invalid config returns nothing — every other reader of the
    file already says so loudly, and a notice is not the place to repeat it.
    """
    try:
        values, sources = load(repo_root)
    except (ConfigError, OSError):
        return []
    floor = max(_version(values["config-acknowledged"] or BASELINE), _version(BASELINE))
    pending = [
        (key, entry)
        for key, entry in SETTINGS.items()
        if key not in NOTICE_EXEMPT and sources[key] == "default" and _version(entry.since) > floor
    ]
    if not pending:
        return []
    lines = [
        f"NEW SETTING {key} (since v{entry.since}, default {_toml_value(entry.default)}): "
        f"{entry.description}"
        for key, entry in pending
    ]
    newest = max((entry.since for _, entry in pending), key=_version)
    lines.append(
        f"  set each in {values['home']}/{CONFIG_RELPATH}, or acknowledge all with "
        f'config-acknowledged = "{newest}"'
    )
    return lines


def setting(key: str, repo_root: Path | None = None) -> Any:
    """One configured value, for a module that needs a single key.

    Falls back to the shipped default when the config cannot be read, so a
    module-level constant resolved through this cannot make a script fail to
    import on a malformed file. An invalid config is still reported loudly
    where a human is looking — `--explain` and `init.py` both call `load()`
    directly and let ConfigError out.
    """
    try:
        return load(repo_root)[0][key]
    except (ConfigError, OSError, KeyError):
        return DEFAULTS[key]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--get", metavar="KEY", help="print a single value, bare")
    parser.add_argument("--explain", action="store_true", help="show each value and its source")
    parser.add_argument(
        "--probes",
        action="store_true",
        help="print the [capabilities] probes, one 'name<TAB>command' per line",
    )
    parser.add_argument(
        "--new-settings",
        action="store_true",
        help="print a NEW SETTING line per unacknowledged key added since config-acknowledged",
    )
    args = parser.parse_args(argv)

    if args.new_settings:
        for line in new_settings(args.repo_root):
            print(line)
        return 0

    if args.probes:
        try:
            probes = capability_probes(args.repo_root)
        except ConfigError as exc:
            print(f"arsenal_config: {exc}", file=sys.stderr)
            return 2
        for name, command in probes.items():
            print(f"{name}\t{' '.join(command.splitlines())}")
        return 0

    try:
        values, sources = load(args.repo_root)
    except ConfigError as exc:
        print(f"arsenal_config: {exc}", file=sys.stderr)
        return 2

    if args.get:
        if args.get not in values:
            print(f"arsenal_config: unknown key {args.get!r}", file=sys.stderr)
            return 2
        value = values[args.get]
        # Bare output is meant to be substituted into a command. A list's repr
        # is not: it is the comma-separated form the flags reading it take.
        print(",".join(value) if isinstance(value, list) else value)
        return 0

    if args.explain:
        width = max(len(k) for k in values)
        for key in sorted(values):
            src = "default" if sources[key] == "default" else sources[key]
            print(f"{key:<{width}}  {values[key]}   ({src})")
        return 0

    print(json.dumps(values, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    # Windows consoles default to a legacy codepage (cp1252 and friends);
    # a non-ASCII line must degrade to "?", never take the process down.
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, "reconfigure"):
            _stream.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
