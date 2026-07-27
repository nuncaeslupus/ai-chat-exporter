# Notes: T<N> — <task-title>

> Scratch for `tmp/<task-id>-notes.md`. Ephemeral — gitignored by the
> host repo, never committed. Capture decisions and deviations while
> implementing; the durable record is `status/plan.md` (task status) and
> the PR description. Delete the file once the PR is open.

**Task**: T<N> from `status/plan.md`
**Branch**: `<ticket-id>-description`

---

## Gate & failing check (RED)

- Gate (from `status/plan.md`): `<metric> <op> <threshold>`
- Test / measurement: `<path>::<test_name>` or `<command>`
- Asserts: <what assertion or measured value proves this task meets the gate>
- Confirmed failing for the expected reason: yes / no

## Gate evidence (RECORD)

Copy into `status/plan.md`'s Evidence log once green:

- Measured value: <number>
- Command run: `<command>`
- Commit SHA: <sha>
- Environment provenance: <ci / local / project tag>
- Gate met (`run_gate.py --input status/plan.md --id <task> <measured>` → PASS): yes / no

## Decisions & deviations

| Decision | Reason |
|----------|--------|
| <deviation from the plan or spec> | <why> |

## Scratch

- <findings, dead ends, commands worth remembering while working>

## Before opening the PR

- [ ] Red test from above now passes (green)
- [ ] Gate met and evidence recorded in `status/plan.md`'s Evidence log
- [ ] Lint + full test suite pass
- [ ] `status/plan.md` task status updated
- [ ] No debug code, commented-out blocks, or secrets left behind
