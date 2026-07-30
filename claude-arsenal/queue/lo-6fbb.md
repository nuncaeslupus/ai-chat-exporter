# D-25: `pnpm test:coverage` exits 1 with every test passing

**What the spec requires:** `pnpm validate` is the developer gate. Green suite +
met thresholds should mean exit 0.

**What happens:** on a clean checkout of `main`, with nothing else running:

```
$ pnpm test:run
 Test Files  69 passed (69)
      Tests  1170 passed (1170)          <- exit 0, no Errors line

$ pnpm test:coverage
 Test Files  69 passed (69)
      Tests  1170 passed (1170)
     Errors  1 error                     <- exit 1
```

The error:

```
⎯⎯⎯ Unhandled Error ⎯⎯⎯
Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 ❯ Object.onTimeoutError vitest/dist/chunks/rpc.…
```

Coverage itself is fine — 86.56% statements against a 40% floor — and no test
fails. Vitest exits non-zero purely because of that unhandled worker RPC
timeout, and `validate` chains on `&&`, so the whole gate reads red.

**Not the same as D-21 (`lo-f804`).** That was individual jsdom tests timing out
under load, and it is fixed — `test:run` is clean and reproducibly so. This is
the *reporter* channel timing out during the coverage run specifically, with
every test green. It reproduces on an idle machine, so it is not contention.

**Why it matters:** a developer running the documented gate on unmodified `main`
sees a failure and has to dig through ~900 lines of log to learn it is spurious.
That is exactly the signal-erosion D-24 was about — a gate you learn to ignore
stops being a gate.

**Note:** CI does *not* hit this — #177 and #178 both passed `validate` green on
GitHub. So it is environment-sensitive (runner speed, worker pool, or v8
instrumentation overhead), not a universal break.

**Fix direction:** likely `poolOptions` / `teardownTimeout` in `vitest.config.ts`,
or moving coverage off the default worker RPC reporter. Confirm first whether
raising the RPC timeout alone clears it before changing the pool.

## Acceptance gate

`test:coverage` exits 0 on a clean checkout with no test failures.

```bash
pnpm test:coverage
```

## Tests
No unit test — this is a test-runner configuration issue. The gate is the exit
code of the command itself.

## Location
`vitest.config.ts`

---

## OWNER DECISION 2026-07-30 — the accepted fix is `onUnhandledError`, after the vitest 4 upgrade

Attempt 1 closed PR #182 unmerged. Do **not** repeat its approach.

**Rejected:** `dangerouslyIgnoreUnhandledErrors: true` in `vitest.config.ts`. It
suppresses every unhandled error in every vitest invocation, so a future genuine
unhandled promise rejection would also stop failing the suite. D-25 is a
signal-erosion task; that trade replaces one eroded signal with a broader one.

**Also rejected:** scoping the same flag to just the `test:coverage` script.
Narrower, but `validate` gates on `test:coverage`, so a real unhandled error
would still slip past the developer gate.

**Accepted:** once `lo-5373` lands vitest 4.x, use the `onUnhandledError`
callback to suppress **only** the
`[vitest-worker]: Timeout calling "onTaskUpdate"` RPC error — matched by message
— and keep failing the run on every other unhandled error. This task is now
blocked on `lo-5373` and is a small change once it lands.

Do not re-derive what attempt 1 established: the 3.2.4 birpc timeout is
hardcoded and exposed through no public config surface, and
`poolOptions.threads.maxThreads` measurably does not clear it. See `lo-5373.md`.

## Attempt 1 failure
Gate: passed mechanically (exit 0), but the approach was rejected on review.
Tried: `dangerouslyIgnoreUnhandledErrors: true` in `vitest.config.ts` (PR #182,
closed unmerged), after ruling out RPC-timeout config and thread-pool changes.
Hypothesis: wait for `lo-5373` (vitest 4), then filter by message via
`onUnhandledError`. Attempts were reset — the work was sound, the design
direction was overridden by the owner.
