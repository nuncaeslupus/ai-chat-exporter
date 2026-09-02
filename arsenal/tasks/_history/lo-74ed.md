---
id: lo-74ed
title: "cleanupElement strips aria-hidden and deletes rendered LaTeX from every export"
priority: 9
workspace: "CORRECTNESS"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/11
---

## Acceptance gate

**Gate**: a conversation containing a KaTeX-rendered formula exports with the formula text present.


Prose-only gate — verified by worker judgment, no script to run.

`src/core/parsers/base-parser.ts:216-218` — `cleanupElement()` unconditionally removes every `[aria-hidden="true"]` element, and it runs (via `extractContent`, line 180) for all three parsers before `textContent` is read.

Verified against `tmp/examples/artifacts-gemini-rendered.html`: `katex-html` appears **14 times**, `katex-mathml` **zero times**. Inspecting an instance (line 3838): `<span class="katex"><span class="katex-html" aria-hidden="true">…` — the visible glyphs are nested **inside** the aria-hidden span, with no MathML sibling to fall back on. So the strip is unconditional data loss: the formula vanishes from both `content` and `htmlContent`, with no placeholder.

## Fix

Exclude math-renderer output from the strip (`.katex, [class*="katex"], mjx-container`), or only remove an aria-hidden element when a sibling actually duplicates its text.

## Context

The aria-hidden strip exists to drop decorative UI, and it does that job — do not remove it wholesale. This is about carving out the one case where aria-hidden marks *the only copy* of real content.
