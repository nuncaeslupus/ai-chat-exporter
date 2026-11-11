# Multi-PR stacking

Load when a plan produces several PRs that will merge in sequence, or when a
stacked branch needs rebasing after its parent merged.

## Stack from the start

Base each branch on the previous one (`fix/iss-B` branched from `fix/iss-A`),
not every branch on `main`. When all branches share one base, every PR that
edits the same shared line (a version file, a changelog heading) conflicts
with each PR after it, because the merge base predates the earlier change.
Stacked, only the first PR meets `main`; the rest inherit their parent's state.

## One version bump per stack

When the repo keeps a version file, only the last PR in the stack bumps it.
Intermediate PRs ship content at the current version, so a release has exactly
one version-bump commit.

## Rebase the next branch after each merge

```bash
# After fix/iss-A merges into main:
bash claude-arsenal/bin/rebase_stack.sh fix/iss-B fix/iss-A
```

`rebase_stack.sh <branch> <old-base>` finds the fork point, runs
`git rebase --onto origin/main`, runs the repo's `host-gate`, and force-pushes
with lease. Cascade it down the stack (B→C, C→D, …) after each merge;
`--no-push` rebases only.

When every conflicted path is one a task declares as `evidence:` and `host-gate`
is set, the script takes the branch's side, re-runs `host-gate` to regenerate the
evidence, and continues, since hand-merging two measurements of a tree means
nothing. It stops instead, naming the paths for a human, when `host-gate` is
unset, when the branch's side cannot be checked out (a file deleted on one side),
when the gate fails, or on any other conflict.
