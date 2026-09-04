---
id: lo-5cda
title: "README and usage.md document features that do not exist and platforms as coming soon that shipped"
priority: 7
workspace: "DOCS"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/50
---

## Acceptance gate

**Gate**: every feature, platform and shortcut named in `README.md` and `docs/usage.md` exists in the code, verified claim by claim.


Prose-only gate — verified by worker judgment, no script to run.

## Confirmed wrong

- `README.md:5` — version badge says 1.0.0; actual is 1.1.1.
- `README.md:11,80-86` and `docs/usage.md:36` — "Claude (coming soon)". Claude is **shipped**: 602-line parser, registered at `src/core/parsers/index.ts:24`. Only Gemini is a placeholder.
- `docs/usage.md:66-90` — documents a "Select Q&A Pairs" button and selection panel. No such UI exists (`lo-adf1` will build it; until then the doc is fiction).
- `docs/usage.md:58-59,92-206` — lists PDF/MD/TXT/JSON/DOCX and **omits HTML**, which is a real registered format offered in the popup.
- `docs/usage.md:244-252` — a settings gear and filename-template UI that do not exist.
- `docs/usage.md:260-264` and `README.md:66-68` — `Ctrl+Shift+S` and `Ctrl+Shift+P` shortcuts that are not registered in any manifest (see `lo-aee0`).
- `README.md:156,215` — links to `./DEVELOPMENT_PLAN.md`, which does not exist (it is `docs/dev/development-plan.md`).
- `README.md:242` — claims `gemini.google.com` host permission; not in the manifest (`lo-194d` adds it).
- `docs/dev/README.md:67` — GitHub URL points at `ivansaul/ai-chat-exporter`; the repo is `nuncaeslupus/ai-chat-exporter`.

## Context

These are store-listing-adjacent: `README.md` is what a user reads before installing, and documenting non-existent features is the kind of thing that draws one-star reviews. Fix by deleting claims, not by building features to match.
