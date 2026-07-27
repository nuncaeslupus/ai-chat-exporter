<!-- Load this template when writing the `<task-id>.md` payload file after `create_task.py` prints a new task ID. -->

# Payload: <task-id> — <task-title>

**Gate**: <copy the measurable acceptance condition from plan.md>

## Tests

Copy from the plan's Tests column. The worker writes these as failing (RED) tests before touching production code.

- `test_<what>_<condition>_<expected_result>` in `<file-path>` — <one-sentence assertion>

## References

Add one line per anchor needed to start the task without grepping.
Format: `<file> §<section or anchor>` — <one-line explanation of why this matters for the task>

- Spec: `spec.md §7.3` — full-Σ NegBin table (gate formula lives here)
- Decision: `DECISIONS.md #1` — R-1 enum divergence rationale
- Sibling: `<subproject>/path/to/sibling.py` — <what pattern to reuse and why>

## Context

<Optional: one short paragraph for anything that does not fit in a reference line.>

## Failure notes

<!-- This section is appended by the orchestrator after each failed worker attempt.
     The next worker MUST read all Attempt N failure entries before implementing. -->

<!-- Example of accumulated entries:

## Attempt 1 failure
Gate: exited with code 1
Output (first 20 lines):
  ruff check src/
  E501 Line too long (102 > 88 characters) — line 12
  Found 1 error.
Tried: Added the feature inline without adjusting line length.
Hypothesis: Wrap the long expression across two lines and re-run ruff.

-->
