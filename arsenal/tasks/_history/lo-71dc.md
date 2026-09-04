---
id: lo-71dc
title: "Sanitize scraped HTML on the two live re-injection paths"
priority: 10
workspace: "SECURITY"
tags: ["CLI"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/8
---

## Acceptance gate

**Gate**: a conversation containing `<img src=x onerror=alert(1)>` and `<script>` in a message body exports and prints with the payload inert; a test asserts it.


Prose-only gate — verified by worker judgment, no script to run.

## The two live sinks

1. `src/core/exporters/html-exporter.ts:852` — the inline highlighter script shipped inside every exported HTML file reads `block.textContent` (decoding the exporter's own escaping back to raw text) and then assigns `block.innerHTML = html`, undoing `escapeHtml()`. The exported file is opened via a same-origin `blob:` URL by `printBlob()`, so this executes at the chat site's origin.
2. `src/extension/content/content-script.ts:355` — `marked.parse()` output goes into the print document with no sanitizer. `marked` passes raw inline HTML through by default.

Both are reachable from conversation content, which is attacker-influenceable: anything pasted into a chat, or returned by a model that was prompt-injected, becomes markup the extension re-emits.

## Verified NOT at risk (do not "fix")

- `src/core/services/html-content-parser.ts` — reads `textContent`/attributes only, never re-emits raw HTML.
- `html-exporter.ts` main render path (`renderBlocks`/`renderInline`/`renderTable`) — escapes consistently.
- `popup.ts` conversation title uses `textContent`.

## Tests

- `it('renders script tags in message content inert in the HTML export')`
- `it('does not execute inline event handlers from scraped content')`

## Context

Two options: sanitize on the way in (one place, in `base-parser.ts:195` where `clone.innerHTML` is captured) or on the way out (each exporter). Prefer the former — one choke point, and every current and future exporter inherits it. There is no sanitizer dependency in the repo yet; a `<template>`-based scrub or DOMPurify are both defensible, but adding a dependency needs a deliberate call.
