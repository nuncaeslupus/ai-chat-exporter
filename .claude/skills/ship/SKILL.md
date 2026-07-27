---
name: ship
description: When the user is confirming a change is ready for production before merge — compatibility, tests, observability, rollback. Do NOT use for implementation (see execution) or PR review (see review).
metadata:
  type: workflow
---

# Ship Workflow

CANARY: ship-loaded-2026-06-15-3b7e91c2d84fa056

Reads `status/specification.md` to know what should be shipping. Confirms scope coverage, compatibility, tests, observability, and rollback before the merge.

## Steps

### Step 1: Confirm final scope

- Intended vs actual scope. Any drift? Any missing pieces?
- If drift → decide: acceptable or split into separate PR?
- If scope grew significantly → does the risk assessment need updating?

### Step 2: Confirm objective coverage

- Does the change solve the stated problem?
- All acceptance criteria satisfied?
- Every task's **Gate** is recorded and met — run the `gate-check` engine (`run_gate.py --input status/plan.md`): exit 0 means all gated tasks pass with complete evidence (measured value, command, commit SHA, provenance). A failing or unrecorded gate is No-Go; exit 2 means no Gate column found or a usage error (missing file, bad `--id`) — confirm the correct plan file exists and the invocation uses `--input`; fall back to the acceptance-criteria check only after confirming the plan genuinely predates the gate convention.
- If partial delivery → is the partial state safe and functional?

### Step 3: Compatibility check

- [ ] Backwards compatible with previous API version (if API changes)
- [ ] Database migration is forward-compatible (no destructive changes in same deploy)
- [ ] Inter-service contracts maintained or migrated
- [ ] Client notification sent (if public API changes)

### Step 4: Test confirmation

- [ ] All unit/integration tests pass (including the new tests written for this change)
- [ ] E2E tests pass (if applicable)
- [ ] Manual testing completed for high-risk paths
- [ ] No flaky tests introduced

### Step 5: Observability check

- [ ] New endpoints have tracing instrumentation
- [ ] Error conditions produce meaningful log entries
- [ ] Business metrics updated (if applicable)
- [ ] Alerts configured for new failure modes (if applicable)

### Step 6: Deployment plan

- [ ] Deployment order defined (if multi-service)
- [ ] Feature flags configured (if gradual rollout)
- [ ] Data migration tested (if applicable)
- [ ] Rollback plan documented
- [ ] On-call team aware (if high-risk)

### Step 7: Adversarial reviewer gate

Spawn a sub-agent as an independent adversarial reviewer **before** pushing
or producing the ship document. The sub-agent receives no conversation history —
pass only the diff and the specification so the review is genuinely independent.

Gather inputs:
- Specification: contents of `status/specification.md` (fall back to the PR
  description or the entire `status/plan.md` if the file is absent).
- Diff: output of `git diff main...HEAD` (or the branch base if `main` is not
  the target).

Pass this prompt verbatim to the sub-agent:

> Role: adversarial code reviewer. Task: find every reason this change should
> NOT be merged. Read the specification and diff below, then list every flaw
> across correctness, security, compatibility, test coverage, observability,
> and rollback safety. Be harsh — assume the author is wrong; prove otherwise
> before clearing. Ignore style unless it causes bugs.
>
> At the end write a single line:
> VERDICT: BLOCK — <one sentence reason>
> or
> VERDICT: CLEAR — <one sentence reason>
>
> Specification:
> {{specification}}
>
> Diff:
> {{diff}}

Decision rules:
- **VERDICT: BLOCK** → Show the sub-agent's findings verbatim. Halt the
  workflow by default, but allow a manual override if the finding is a false
  positive — record the override justification in the ship output (§ 3
  Adversarial review row) and proceed to Step 8. Otherwise, resolve the
  blockers and re-run from Step 1.
- **VERDICT: CLEAR** → proceed to Step 8. Append a one-line summary of the
  verdict to the ship output document (§ 3 Checks completed → Adversarial
  review row).

### Step 8: Produce ship output

Load `references/template.md` when producing the ship output document.

---

## Abbreviation

**Abbreviated ship** = Steps 2 + 4 + Go/No-Go. Whether abbreviation is allowed
depends on project conventions documented in the host repo's `CLAUDE.md`.

The adversarial reviewer gate (Step 7) runs even in abbreviated mode unless
the host repo's `CLAUDE.md` carries the marker
`<!-- ship: adversarial-review=skip -->` **and** the change is docs-only or
config-only. For all code changes the gate is mandatory regardless of
abbreviation.
