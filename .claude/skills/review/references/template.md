# Review: <title>

**Date**: YYYY-MM-DD
**PR/Change**: link or reference
**Ticket**: <id>
**Specification**: `status/specification.md` (the intent this change is audited against)
**Author**: <name>
**Reviewer**: <name>

---

## 1. Summary

<One paragraph: what this change does, why, and its scope.>

## 2. Strengths

- <What the author did well — good patterns, thorough tests, clean design>

## 3. Risks

| Risk | Severity | Description | Recommendation |
|------|----------|-------------|----------------|
| | Low/Med/High | | |

## 4. Observations

### Standards compliance

| Check | Status | Notes |
|-------|--------|-------|
| Repo structure | Pass/Fail | |
| Tech stack | Pass/Fail | |
| Code conventions | Pass/Fail | |
| API versioning | Pass/Fail | |
| Security | Pass/Fail | |
| Configuration | Pass/Fail | |
| Testing | Pass/Fail | |
| Observability | Pass/Fail | |
| Git conventions (branch naming, commit messages) | Pass/Fail | |

### Debt and complexity

- <Observations about over-engineering, duplication, coupling, scope creep>

### Test assessment

| Aspect | Status | Notes |
|--------|--------|-------|
| New code paths covered | Yes/No | |
| Test-code ordering (tests precede or accompany code) | Yes/No/N-A | |
| Happy path tested | Yes/No | |
| Error paths tested (2+) | Yes/No | |
| Integration tests | Yes/No/N/A | |
| Security tests | Yes/No/N/A | |
| Existing tests still pass | Yes/No | |
| Task gates recorded with complete evidence | Yes/No/N-A | `run_gate.py --input status/plan.md` |
| Each gate's measured value meets its threshold | Yes/No/N-A | exit 0 = all pass; exit 2 = no Gate column or usage error (verify before treating as grandfathered) |

## 5. Blockers

- <Issues that MUST be resolved before merge. Empty if none.>

## 6. Recommendations

- <Suggestions for improvement that do NOT block merge>

## 7. Verdict

**Verdict**: Approve / Approve with comments / Request changes / Block

**Reason**: <one-line justification>

**Action required**: <what the author needs to do next, if anything>
