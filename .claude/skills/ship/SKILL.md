---
name: ship
description: When the user is confirming a change is ready for production before merge — compatibility, tests, observability, rollback. Do NOT use for implementation (see execution) or PR review (see review).
metadata:
  section: workflow
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

Before pushing or producing the ship document, put the change in front of a
reviewer that has no history with it. This is the same gate `execution` and
`github` run before opening a PR, re-run here against the merge-ready tree —
which is not the tree that was reviewed then. Review feedback and CI fixes have
landed since, and those commits have had no independent read of their own.

```bash
REVIEW="${CLAUDE_SKILL_DIR}/../init/assets/bin/adversarial_review.sh"
bash "$REVIEW" emit      # prints the packet's absolute path
# spawn a sub-agent whose whole prompt is: read THAT path, reply into verdict.md beside it
bash "$REVIEW" verdict   # 0 CLEAR · 1 BLOCK · 2 no verdict · 3 the tree moved mid-review
```

The sub-agent gets the packet path and nothing else — no conversation history,
no summary of what is shipping, no note about which parts are already reviewed.
Load `claude-arsenal:core:init § references/pre-pr-review.md` for the full
protocol and the manual form for a repo without the vendored bundle.

Decision rules:
- **Exit 1 (BLOCK)** → Show the sub-agent's findings verbatim. Halt the
  workflow by default, but allow a manual override if the finding is a false
  positive — record the override justification in the ship output (§ 3
  Adversarial review row) and proceed to Step 8. Otherwise, resolve the
  blockers and re-run from Step 1.
- **Exit 2 (no verdict line) or 3 (the tree moved mid-review)** → not a pass and
  not an override case: re-run the gate.
- **Exit 0 (CLEAR)** → proceed to Step 8. Append a one-line summary of the
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
