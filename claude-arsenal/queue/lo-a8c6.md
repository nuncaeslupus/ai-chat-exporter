# Payload: lo-a8c6 — Image-only user turns shift every later pair

## Acceptance gate

**Gate**: a conversation whose second turn is an image with no text exports with every question matched to its own answer.


Prose-only gate — verified by worker judgment, no script to run.

## The defect

`src/core/parsers/chatgpt/parser.ts:195-197` — `extractUserMessage()` returns `null` when text content is empty, **before** `extractImages()` is called. So an image-only user turn produces no user message. The assistant side has no equivalent guard, so nothing is dropped there.

`base-parser.ts:121-136` then zips the two arrays **positionally**: `maxPairs = Math.min(userMessages.length, assistantMessages.length)`.

Worked example — turns U1(text)/A1, U2(image only)/A2, U3(text)/A3:
- users → [U1, U3], assistants → [A1, A2, A3]
- `maxPairs = min(2,3) = 2`
- pair0 = U1+A1 ✓, pair1 = **U3+A2** ✗ — U3 is paired with the answer to the image, and A3 is discarded entirely

Every turn after the first image-only message is attributed to the wrong question. Silent, and the export looks plausible.

## Fix

Mirror `src/core/parsers/claude/parser.ts:181-208`, which already handles this: extract images first, and fall back to an `[Uploaded images: …]` placeholder when text is empty but images exist, so the turn still occupies its slot.

## Context

The sibling parser gets this right — a good example of why the duplicated parser logic is worth consolidating. Positional zipping is the underlying fragility; a guard here fixes the reported symptom, but consider whether pairing should key off turn identity instead.
