---
id: lo-2cb3
title: "R-7: JSON — schemaVersion 2, 2-space indent, stable key order, ISO-8601 with offset"
priority: 10
deps: ["lo-37cc"]
workspace: "EXPORTERS"
tags: ["redesign"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/164
---

Spec Phase 2 / JSON. Depends on R-1 (nothing visual, but ships with the set).

- `"schemaVersion": 2`.
- Two-space indent and a **stable key order**, so a diff between two exports of
  the same conversation is readable.
- Timestamps as ISO-8601 **with UTC offset**, not bare `Z`-normalised UTC.
- Emit `dateRange` from `dateBounds()` — it returns null until a platform
  supplies real per-message times, so omit the key rather than writing nulls.

## Acceptance gate

```bash
pnpm test:run tests/unit/core/exporters/json-exporter.test.ts
```

## Tests
`tests/unit/core/exporters/json-exporter.test.ts` — assert two exports of the
same conversation are byte-identical, that key order is fixed, and that a
timestamp round-trips with its offset intact.

## Location
`src/core/exporters/json-exporter.ts`
