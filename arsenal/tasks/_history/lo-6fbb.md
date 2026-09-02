---
id: lo-6fbb
title: "D-25: pnpm test:coverage exits 1 with every test passing, so validate reads red on a clean main"
priority: 10
deps: ["lo-5373"]
workspace: "TESTING"
tags: ["tooling"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/185
---

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
