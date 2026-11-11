---
name: pin-check
description: Reverts a line, runs the scoped test and reports whether it pins the behaviour. Use when the user asks if a test catches a change. Not for mutation scoring.
argument-hint: "--source FILE --replace OLD --with NEW --test TARGET"
user-invocable: true
effort: low
metadata:
  section: python
---

# pin-check

One deliberate mutation per claim, aimed at one test: is this behaviour pinned,
or merely true? `coverage-gaps` answers whether a line ran and `mutmut-report`
scores thousands of automatic mutants; this answers one claim in seconds.

CANARY: pin-check-loaded-2026-09-15-1c4de0b7-9a2f61d08e4b7c35

## Step 1 — Name the claim and its one test

Give the exact text the claim is about and the one test that should catch it
changing. Scoping to that test keeps a run to seconds.

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/pin_check.py" \
    --source src/yourproject/rules.yaml \
    --replace "asynchronous" --with "async" \
    --test tests/<the-one-case>.py
```

`--expect-count N` refuses to run unless the target occurs exactly N times, so
one claim stays one mutation. `--root DIR` (repeatable) names extra trees to
purge bytecode from. Arguments after the flags go to `pytest`.

Use the script rather than a hand `sed` cycle: it purges `__pycache__`, runs
each test in a fresh subprocess, refuses a target that matches nothing, and
restores the file when the run ends; after a killed run, its sentinel makes the
next run refuse to start and print the manual restore command. A hand cycle gets
each of these wrong without noticing.

## Step 2 — Read the verdict

| verdict | exit | means |
|---|---|---|
| `PINNED` | 0 | the target changed and the scoped test went red; the claim holds |
| `NOT PINNED` | 1 | the test stayed green; it asserts something true, not something pinned |
| `NOT MUTATED` | 3 | the target was absent or matched a different count than `--expect-count`; nothing was tested |
| `INCONCLUSIVE` | 4 | the test was already red before the mutation, or the file could not be restored |
| error | 2 | bad arguments, or a sentinel from a killed run is on disk (the message says how to restore) |

## Step 3 — Act on it

- `NOT PINNED` → add an assertion on the value that changed, or a case that
  exercises the path, then re-run until `PINNED`.
- `PINNED` → cite it in the review.
- Either way, report the mutation — source, target, replacement, test — with
  the verdict, since the verdict is only as good as the mutation.

Files outside version control, or generated files, cannot be safely restored;
check them in first.
