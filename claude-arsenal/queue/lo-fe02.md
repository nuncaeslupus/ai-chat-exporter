# Payload: lo-fe02 — Dependency and config tidy-up

## Acceptance gate

**Gate**: `pnpm install` on a clean checkout pulls nothing unused; `pnpm build` unchanged.


Prose-only gate — verified by worker judgment, no script to run.

1. `package.json` declares `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` at `^8.33.1`, but nothing imports them directly — `eslint.config.js` uses the `typescript-eslint` metapackage, which declares them itself at `^8.65.0`. Two dead direct deps pinned to a range that drifts from what actually resolves. Remove.
2. `package.json:41` — `engines.node: ">=18.0.0"` is fiction. Vite 6 declares `^18 || ^20 || >=22` (no 19, no 21), `@types/node` is pinned `^22`, and CI runs 22. Decide the real floor and state it.
3. `build/vite.chrome.ts` and `build/vite.firefox.ts` are ~98 % identical (109 lines each) — both manifest plugins, both `deepMerge` copies, both asset-copy blocks, differing only in `outDir` and which manifest they read. Factor into one parameterised plugin so future asset changes cannot be applied to one browser and forgotten in the other.
