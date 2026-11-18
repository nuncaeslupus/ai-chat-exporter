# Notes: T<N> — <task-title>

> Scratch for `tmp/<task-id>-notes.md`. Ephemeral — gitignored by the
> host repo, never committed. Capture decisions and deviations while
> implementing; the durable record is `status/plan.md` (task status) and
> the PR description. Delete the file once the PR is open.

**Task**: T<N> from `status/plan.md`
**Branch**: `<ticket-id>-description`

---

## Resume

> What a session needs to continue this task after context compaction. The
> `compact_resume.sh` hook re-injects this section, so keep it short and current:
> refresh it after RED, after GREEN, and after each decision — not every turn.
> Changed files are deliberately absent: `git status` is the truth.

- **Decided** (do not reopen): <choice> — <why>
- **Ruled out**: <approach> — <why it failed>
- **Next step**: `<the single next command>`

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

## Scratch

- <findings and commands worth remembering while working>

## Before opening the PR

- [ ] Red test from above now passes (green)
- [ ] Gate met and evidence recorded in `status/plan.md`'s Evidence log
- [ ] Lint + full test suite pass
- [ ] `status/plan.md` task status updated
- [ ] No debug code, commented-out blocks, or secrets left behind
