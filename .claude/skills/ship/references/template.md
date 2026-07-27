# Release Readiness: <title>

**Date**: YYYY-MM-DD
**PR/Change**: link or reference
**Ticket**: <id>
**Specification**: `status/specification.md` (what should be shipping)
**Author**: <name>
**Assessed by**: <name>

---

## Contents

- [1. General status](#1-general-status)
- [2. Remaining risks](#2-remaining-risks)
- [3. Checks completed](#3-checks-completed)
- [4. Checks pending](#4-checks-pending)
- [5. Monitoring plan](#5-monitoring-plan)
- [6. Rollback plan](#6-rollback-plan)
- [7. Decision](#7-decision)

---

## 1. General status

**Decision**: Ready / Ready with cautions / Not ready

**Summary**: <one paragraph — what is shipping, overall risk level, and confidence>

---

## 2. Remaining risks

| Risk | Severity | Mitigation | Status |
|------|----------|------------|--------|
| | Low/Med/High | | Mitigated / Accepted / Open |

---

## 3. Checks completed

### Scope

- [ ] Actual scope matches intended scope
- [ ] No unplanned scope drift
- [ ] No missing pieces from the plan

### Objective

- [ ] Original objective is fully covered
- [ ] Acceptance criteria satisfied
- [ ] Every task gate recorded with complete evidence and met (`run_gate.py --input status/plan.md` exits 0; exit 2 = no Gate column or usage error — verify before treating as grandfathered)
- [ ] Known edge cases handled

### Compatibility

- [ ] API backwards compatible (or new version created)
- [ ] Inter-service contracts verified
- [ ] Database migration forward-compatible
- [ ] Feature flag off-state safe (if applicable)
- [ ] New environment variables documented and configured

### Tests

- [ ] Test suite passes (use the host repo's test command)
- [ ] Lint passes (use the host repo's lint command)
- [ ] E2E passes (if applicable)
- [ ] Manual verification completed
- [ ] All existing tests still green
- [ ] CI checks passing

### Adversarial review

- [ ] Adversarial reviewer gate passed — VERDICT: CLEAR (<one-line reason from sub-agent>)

### Observability

- [ ] Tracing instrumented (if applicable)
- [ ] Metrics exposed
- [ ] Structured logging in place
- [ ] No sensitive data in logs
- [ ] Alerts cover new functionality (or new alerts created)

### Mitigation and rollback

- [ ] Rollback strategy defined
- [ ] Database migration reversible (or forward-fix plan documented)
- [ ] Blast radius identified
- [ ] Feature flag available (if applicable)
- [ ] Estimated time to recover: <time>

### External dependencies

- [ ] Infrastructure changes deployed (or not needed)
- [ ] Dependent service changes deployed (or not needed)
- [ ] Client notification sent (or not needed)
- [ ] Third-party credentials configured (or not needed)
- [ ] Team coordination completed (or not needed)
- [ ] Deploy ordering documented (or single service)

---

## 4. Checks pending

| Check | Owner | ETA | Blocking? |
|-------|-------|-----|-----------|
| | | | Yes/No |

---

## 5. Monitoring plan

**First 30 minutes after deploy**:
- Watch: <what dashboards, logs, or alerts to monitor>
- Alert on: <what signals indicate a problem>
- Rollback trigger: <what condition triggers rollback>

**First 24 hours**:
- Watch: <longer-term signals>
- Verify: <data correctness, performance baseline>

---

## 6. Rollback plan

**Strategy**: revert merge and redeploy / feature flag off / manual steps

**Steps**:
1. <step>
2. <step>

**Estimated time to rollback**: <time>

**Data recovery** (if applicable):
- <how to recover or fix data if corruption occurred>

---

## 7. Decision

**Decision**: Ready / Ready with cautions / Not ready

**Conditions** (if ready with cautions):
- <what must be monitored>
- <what triggers escalation>

**Blockers** (if not ready):
- <what must be resolved>
- <who owns the resolution>
