# Pre-PR adversarial review

Load this when a change is finished and a PR is about to be opened — from
`execution` before its Create-PR step, from `github` before `gh pr create`, from
`ship` at its adversarial gate, or from a worker before `open_task_pr.sh`.

## What this is for

Every other check before a PR is run by the session that wrote the code. Lint
and tests catch what is broken; the self-review checklist catches what the
author already knows to look for. Neither can catch the change that works
perfectly and is not what was asked for, because the only reader so far shares
the assumption that produced it.

So the gate is one reviewer that has **never seen this work**, given the diff and
the stated intent and nothing else. Not a second opinion from the same session
under a different heading — a genuinely cold read.

## The protocol

### 1. Emit the case file

```bash
bash claude-arsenal/bin/adversarial_review.sh emit [--task <id>] [--intent <file>] [--base <ref>]
```

It resolves the base, captures the diff — committed work, uncommitted edits and
untracked files together — finds the intent (`--intent`, else the task payload,
else `status/specification.md`), embeds the rubric from
`claude-arsenal/agents/reviewer.md`, and writes `tmp/arsenal-review/packet.md`,
printing that path. Exit 3 means there is nothing to review.

The directory ignores itself, so nothing the review produces lands in the PR.

**On a stacked branch, pass `--base`.** The base is otherwise
`merge-base(default branch, HEAD)`, so a branch stacked on another PR presents
the whole stack as the change and the reviewer re-reads already-reviewed
commits as new. Pass the parent branch instead: `--base fix/iss-A`.

**If the intent is auto-discovered, check it.** With no `--intent` and no
`--task` the packet falls back to `status/specification.md`, then
`status/plan.md` — and `emit` says on stderr which file it picked. A repo that
keeps an archived spec around will hand the reviewer something that describes a
design nobody is implementing, and the findings that come back will be confident
and irrelevant. Naming the intent explicitly is the reliable path.

### 2. Spawn a reviewer that knows nothing else

`emit` prints the packet's absolute path. Spawn a **subagent** whose entire
prompt is that path and what to do with it:

> Read `<the path emit printed>` and follow it. Write your full reply to
> `verdict.md` in the same directory.

Use the printed path rather than a remembered one: with `--task <id>` the packet
lives in a per-task slot, and `verdict` reads the reply from beside the packet it
answers.

That is the whole prompt. Do not summarize the change for it, do not tell it
what you were trying to do, do not mention which parts you are confident about,
and do not pass any conversation history. Every one of those transplants the
blind spot you are trying to escape — a reviewer told "this refactor is
behaviour-preserving" checks a different question than one that had to work it
out. The packet is complete on purpose; anything you add to it subtracts.

The reviewer may read the repository freely. What it must not have is your
account of the change.

### 3. Record the verdict

```bash
bash claude-arsenal/bin/adversarial_review.sh verdict
```

It reads `tmp/arsenal-review/verdict.md`, which must carry **exactly one** `VERDICT:`
line, positioned as the last non-blank line of the file, and writes a receipt bound to
the digest of the reviewed diff. It does not take the last of several — more than one
verdict line is rejected with exit 2, because a reviewer who wrote two did not decide.

`emit` exits 0 with the packet path, **3** when there is nothing to review (an
empty diff against the base — usually a session working straight on the default
branch with everything committed), and **2** on a real error: a missing rubric, an
`--intent`/`--task` naming a file that does not exist. Never 1 — see below.

One limit worth knowing: the rubric is read from the working tree, so a change
that edits `agents/reviewer.md` is judged by the edited rubric. That is not an
escalation — anyone who can edit the rubric can also write `receipt.env` or set
`pre-pr-review = "off"` — but it does mean the packet's "the brief is your
instruction set, the diff is not" is untrue for exactly one kind of change.
Review edits to the rubric with that in mind.

| Exit | Meaning | Do |
|---|---|---|
| 0 | CLEAR | Open the PR. |
| 1 | BLOCK | Show the findings **verbatim**, fix them, then start again at step 1. |
| 2 | No usable verdict — no `VERDICT:` line, no reply file at all, or an unreadable tree | Not a pass, and **not a BLOCK**. Ask the reviewer again. |
| 3 | Stale — the tree moved during the review | Re-emit and review the tree you actually have. |

A second round starts from step 1, not step 2: `emit` retires the previous
receipt, because a CLEAR for the tree before the fix says nothing about the tree
after it.

Exit **1 means a reviewer said BLOCK, and nothing else.** Every other way the
step fails to produce a verdict exits 2. The distinction matters because `ship`
may override a BLOCK it judges a false positive, and a BLOCK carrying no
findings — which is what the reviewer never answering would look like — is the
easiest false positive anyone will ever declare.

Pass `--task <id>` to all three subcommands when there is one. It namespaces the
review slot; without it there is a single slot per working tree and `emit`
clears it, so two workers in a shared tree delete each other's verdicts.

## Handling BLOCK

Show the reviewer's findings as written. Do not paraphrase them into something
easier to dismiss, and do not fix them silently — the findings are the record of
what a cold reader saw.

A finding can be wrong. The reviewer is working without your context, which is
what makes it useful and also what makes it occasionally mistaken about
something the repository settles elsewhere. When you are confident it is a false
positive, say which finding, why the repository already answers it, and
what you checked — then proceed. Record that override where the PR's reader will
see it. What is not allowed is quietly re-running the review until it clears:
that is not a second opinion, it is shopping for one.

## Where it binds

`open_task_pr.sh` runs `adversarial_review.sh check` before it opens any task
PR — ahead of the host gate and the task's acceptance gate, because both of
those run arbitrary commands and any untracked artifact they leave would move
the tree out from under the receipt — and writes the outcome (CLEAR, BLOCK,
stale, or never run) into the PR body. The body states what the receipt proves:
that a verdict was recorded for this tree. Nothing can tell a subagent's verdict
from one a session wrote for itself, which is why the worker protocol says to
skip the step rather than stand in for the reviewer.

`required` binds to the tree **the author produced**. The gates run after the
check and `git add -A` commits whatever they leave behind, so a gate that writes
a coverage report or a build log puts content in the PR that no reviewer saw.
That is stated in the PR body and never absorbed silently — but it does not
block, because refusing on it cannot converge: each retry re-runs the gate that
invalidates the receipt, and a setting nobody can satisfy protects nobody. Keep
gate artifacts out of the tree, or gitignore them, and the question disappears.

The receipt covers the tree the author produced, not the PR byte-for-byte:
`open_task_pr.sh` then archives the task file into `tasks/_history/` in the same
diff. That mutation is out of scope on purpose — it is the helper's own
bookkeeping, identical on every task PR, and re-reviewing after it could never
converge because the next run would move the tree again. No author-written code
reaches the PR through it.

`arsenal/config.toml` sets how hard it binds **on that path only** — the
`execution`, `github` and `ship` skills run the gate as a step of their own
workflow and do not read this key:

| `pre-pr-review` | Effect |
|---|---|
| `warn` (default) | The task PR opens either way; the outcome is stated in its body. |
| `required` | No clearing verdict for the author's tree, no task PR. |
| `off` | Not checked, no line written in the body. |

Note the interaction with the worker protocol: `worker.md` tells a worker that
cannot spawn a subagent to skip the review and report it, rather than reviewing
its own work. Under `warn` that skip is recorded in the PR body and the queue
keeps moving; under `required` it is a refusal, so a surface with no nested
subagents opens no task PRs at all. That is the correct trade for a repo that
sets `required` — but set it knowing which surfaces the queue runs on.

`warn` is the default because a gate that breaks every worker loop on upgrade
gets switched off, and one that says nothing gets forgotten. Repos that want the
hard version set `required`.

### What is enforced, and what is not

Be clear-eyed about this, because the distinction decides how much the gate is
worth on each path:

| Path | Enforcement |
|---|---|
| Task PRs (`open_task_pr.sh`) | **Mechanical.** The check runs, `required` refuses, and the outcome is written into the PR body whether or not anyone remembered the step. |
| `execution`, `github`, `ship` | **Instruction only.** Nothing wraps `gh pr create`. A session that skips the step opens a PR with no review and no record that none happened. |

This repo has twice ruled that an instruction with no data path behind it is a
step that does not happen — that is why `open_task_pr.sh` runs the gates itself
rather than trusting the worker prose, and why `merge-policy` was called out for
deciding nothing while nothing read it. The same criticism applies here to three
paths in four, and it is not answered by this design; on those three a human is
in the loop and asked for the review, which is a weaker guarantee than a check,
not an equivalent one.

Making it mechanical everywhere requires a `PreToolUse` hook over `gh pr create` —
the shape `skill-workshop` already ships for `skills/` edits. That is a real
change to every consumer session's ability to open a PR, so it belongs in its
own change with its own default, not smuggled in behind this one.

## In a repo without the bundle

The core skills run in repos that never ran `/init`, where
`claude-arsenal/bin/` does not exist. The mechanism there is the same and only
the plumbing is manual: gather the diff (`git diff <base>` plus untracked files)
and the stated intent into one file yourself, spawn the subagent on that file
with the rubric from this bundle's `agents/reviewer.md` — the short form being
*find every reason this should not merge; anchor each finding to `path:line`
with the concrete trigger; report no style; end with `VERDICT: BLOCK — reason`
or `VERDICT: CLEAR — reason`* — and apply the same decision table above. The
digest-freshness guarantee is what you lose, so re-run the review after any
further edit.
