---
name: continue
description: When the user wants to resume work or run the worker loop — picks the next unblocked task, optionally scoped by tag(s) and/or a workspace, or matched by title text. Use /continue [TAG … | WORKSPACE | search-text]. Do NOT use before running init.
user-invocable: true
argument-hint: "[CAPABILITY | TAG … | WORKSPACE | search-text]"
metadata:
  type: workflow
---

# continue

Resumes session work: reads the task graph from the repository, picks the next unblocked
task, claims it so no other agent can take it, and runs the worker loop. Optionally scoped
by tag(s) and/or a workspace, or matched against a fuzzy task title.

CANARY: continue-loaded-2026-06-13-fb78d23e-b2c3d4e5f6a7b8c9

## When to load

Load this skill when:

- The user types `/continue`, "continue", "resume", "run the workers", or "WORKSPACE: Continue".
- The session needs to pick up where a previous session left off.
- The user provides a workspace name or task search string after the command.

## The loop

**1. Fetch the task issues.** List issues labelled `arsenal:task`, open **and** closed, using whatever GitHub access
this surface offers — the built-in GitHub tools, `gh`, or REST — and save the JSON. Closed ones matter: a closed-as-completed issue is what marks a
dependency satisfied.

Request `number`, `title`, `state`, `labels`, `assignees` — **not `body`**. The resolver reads the
`arsenal-task:` line when a body is present and falls back to matching the title against the task
files, so bodies change no answer here while dominating the cost: on a 40-issue board they are the
difference between ~9k and ~1.2k tokens, spent before the first task is even chosen.

Run `github_channel.sh --detect` (in `claude-arsenal/bin/`); it prints `gh`, `rest`, or `none`.

`none` means no scriptable channel exists here; make the call with the built-in GitHub
tools instead. It is not a reason to skip the step — a skipped step here means the session
picks up work another agent is already doing.

**2. Ask for the next task.** One call, one line of output:

Run `task_select.py` (in `claude-arsenal/scripts/`) with the saved issues:

```bash
task_select.py --tasks-dir arsenal/tasks --issues /tmp/issues.json \
               --capability surface:cli --workspace FRONTEND --tag DOCS
```

Ordering is a computation, not a judgement — deps, priority, capabilities and scope are
all applied by the script, so the decision costs one line of context rather than a
protocol re-read each session.

Pass one `--capability` per entry in `arsenal/session/surface_profile.json`, plus what
only this session can see. The probe is a shell hook, so it detects the *machine* —
surface, running services — and is blind to what the session itself was given: a
connected browser shows up in the session's own tools while `claude mcp list` reports
nothing. Check there before adding `access:browser`.

**3. Check nobody else holds it.** Before claiming, read the task's issue and skip it if
it is closed, has an assignee, or carries `arsenal:claimed`. This is not a race — a human
who assigned themselves did so long ago — so a plain check settles it.

**4. Claim it.**

Run `claim_task.sh <task-id>` (in `claude-arsenal/bin/`).

Obey the result verbatim:

- `won <ref>` → the task is claimed. Nobody else can hold it: creating the ref is a
  compare-and-swap that GitHub itself arbitrates.
- `lost` → another agent got there first. Drop it, take the next task. This is normal, not
  an error.
- `manual POST <path> <body>` → no scriptable channel; make that exact call with the
  built-in GitHub tools. **201 means won, 422 means lost.**
- `error:` → misconfiguration. Stop and surface it to the user.

Never work around a `lost` by claiming a different ref or re-running with another attempt
number. The whole point of the ref is that exactly one agent proceeds; routing around it
recreates the double-claims it exists to prevent.

Then mark the issue so a human can see which agent holds it: self-assign, add
`arsenal:claimed`, and comment with the session id from `CLAUDE_CODE_REMOTE_SESSION_ID`
— a `cse_…` value that doubles as a session URL, so the claim is clickable.

**5. Work the task, then open its PR with `open_task_pr.sh`.** It resolves the task's
issue number, writes `Closes #<issue>` into the PR body *and* the commit message, and
moves the task file into `arsenal/tasks/_history/` inside the same diff. Merging therefore
closes the issue, archives the task, and unblocks its dependents in one act — there is no
"update the queue" step to forget, and nothing left to verify afterwards.

Both keyword sites matter: the body form fires on a merge into the default branch, the
commit form survives a squash and covers a stacked PR based on another branch.

**6. Loop back to step 2.**

## Scoping

Bare-word tokens are order-independent and resolved by membership, in this order:

| the token matches | it resolves to |
|---|---|
| the suffix of a known capability | `--capability` filter (and grants it — below) |
| a known workspace | `--workspace` filter (at most one) |
| a known tag | `--tag` filter (several are ANDed) |
| nothing above | fuzzy title search |

```bash
/continue HUMAN             # access:human — the tasks waiting on a person
/continue BROWSER FRONTEND  # access:browser AND workspace FRONTEND
/continue DOCS INFRA        # tag DOCS AND tag INFRA
```

The suffix rule is derived from the vocabulary rather than a table to keep in step:
`HUMAN` finds `access:human`, `POSTGRES` finds `services:postgres`, `CLI` finds
`surface:cli`. Should two classes ever end in the same word, that token must be written
in full as `class:value`. `/continue BROWSER FRONTEND` and `/continue FRONTEND BROWSER`
resolve to the same scope, and a task qualifies only if it satisfies **every** token.

**Naming a capability grants it only where nothing can check it.** A token always
filters; whether it also *grants* depends on whether something authoritative already
knows the answer:

| token names | granted by the token? | because |
|---|---|---|
| `surface:*`, `services:*` | **no** — the probe decides | `/continue CLI` on a cloud session would otherwise hand out work that surface genuinely cannot run |
| `access:browser` | **no** — the session's tools decide | if none is connected, say so and stop rather than spending an attempt discovering it |
| `access:human`, `access:secrets`, `access:device` | **yes** | nothing can probe whether a person is watching or which keys this machine holds, so the person typing it is the evidence |

Without that last row `access:human` would be unusable — the filter would match a
capability no profile ever contains, and always return nothing. Without the first two,
a typo would quietly promote a session past a limit that exists for a reason.

## Gotchas

- **`WORKSPACE: Continue`** as natural language (e.g. "FRONTEND: Continue") is equivalent
  to `/continue FRONTEND`.
- **Task files are read from the default branch.** That is what makes every agent compute
  the same graph regardless of the branch it is working on. A task file on an unmerged
  branch is not yet in the queue.
- **A task with no issue handle is invisible.** Where `.github/workflows/arsenal-queue.yml`
  is installed, GitHub opens the handle as soon as the task file lands, so this should
  never be outstanding. Where it is not, run `handle_sync.py` (in `claude-arsenal/scripts/`)
  to list task files that need one, and create them. Missing handles delay work; they never
  corrupt it — and `open_task_pr.sh` refuses to open a PR for a task it cannot link, rather
  than merging one that closes nothing.
- **`gate: false` in the selector output means the task has no runnable gate.** A prose-only
  gate executes nothing and therefore passes everything. Fix the task file before working
  it, rather than completing something that nothing checked.
- **Blocked workspace**: if a scoped selection is empty but the global queue has tasks,
  report what is blocking and offer to fall back to the global queue.
- **Retries claim a new ref.** A crashed session blocks nothing: attempt 2 claims
  `<id>.a2`. Past `max-attempts` the task stops being offered and needs a human — read the
  `## Failure notes` in the task file before re-dispatching.
