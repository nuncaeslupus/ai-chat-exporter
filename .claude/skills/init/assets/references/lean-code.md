# Lean code — the smallest change that does the job

Load this when implementing a task (`execution` GREEN step) and when reviewing a
diff for code it did not need. Every line a change adds is a line someone reads,
tests and maintains; a change that does the job in less is a better change.

## The ladder — climb it before writing code

1. **Is it needed at all?** If the task or its gate does not ask for it, do not
   build it. "Might be useful later" is a later task.
2. **Does the language or platform already do it?** The standard library, a native
   element, a built-in flag of a tool already in use.
3. **Does this repo already have it?** A helper, a script, the pattern in the file
   beside the change. Reuse it; don't write a second one.
4. **Only then write new code**, and only as much as passes the gate.

## The rules

| Rule | Why |
|---|---|
| The smallest diff that meets the gate | Every extra line is review time and a place for a bug |
| Delete before you add | Removing dead or duplicate code often is the fix |
| No speculative abstraction, option or parameter | Nobody asked for it, so nothing tests it and it rots |
| No defensive code for impossible states | It hides the real invariant and never runs |
| No unrequested refactor | It enlarges the diff and mixes concerns in one review |
| No comment restating the code | It drifts from the code it describes |
| No new dependency for a few lines | A dependency is code you maintain without reading it |

## Never cut

Input validation, error handling, security checks, accessibility, and tests. Lean
means no code the task did not need, not less safety than it needs.

## In review

Code the task did not need, judged by the ladder, is reported as
`RISK | path:line — SCOPE: <what could go> (<lines>; confidence: …)`. SCOPE never
blocks on its own: the author removes it, or answers why it stays. In the PR's digest
record (`references/digest.md` § 1) a removed item is a `fixes` entry whose `what`
starts `SCOPE:`; a kept one goes in `open` as `SCOPE: … — kept because …`.
