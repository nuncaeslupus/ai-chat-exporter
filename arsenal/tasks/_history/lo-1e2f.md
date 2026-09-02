---
id: lo-1e2f
title: "BUILD-1: the documented release process packages without building, so the zip can ship the previous build"
priority: 6
workspace: "RELEASE"
tags: ["tooling"]
status: merged
pr: https://github.com/nuncaeslupus/ai-chat-exporter/pull/218
---

Source: the 13-dimension senior review of 2026-07-31 (26 agents, findings adversarially reviewed).
**8 findings** in this task: 1 high, 5 medium, 2 low.

The release finding is the important one — `pnpm package:all` zips whatever is already in `dist/`, and
`dist/` is never cleaned, so a store upload can contain stale or orphaned chunks. That is a shipping
hazard, and it interacts with the release task (`lo-7422`).

---

## Findings

### [high] Documented release process packages without building — the zip ships the previous build

- **Where:** `docs/dev/releasing.md`:27
- **Problem:** Step 1 of the release runbook bumps the version in package.json + manifests/manifest.base.json; step 2 says to run `pnpm package:all`. `package:all` is `node build/package-all.cjs`, which only runs `package:chrome && package:firefox && package:source` and then renames the zips using the version read from package.json — it never invokes `pnpm build`. Nothing regenerates dist/, and because every vite config sets `emptyOutDir: false` (build/vite.config.ts:27, build/vite.content.ts:57) dist/ is never cleaned either. The zip filename therefore comes from the *new* package.json while the manifest.json and JS inside come from whatever build last happened to run. `pnpm build:test` (package.json:14) and `make package` do build first; the runbook points at the one entry point that does not.
- **Failure scenario:** Bump package.json/manifest.base.json to 1.1.2, follow releasing.md: `pnpm package:all` produces dist/ai-chat-exporter-v1.1.2-chrome.zip whose manifest.json still reads "version": "1.1.1" and whose code is the last local build. Chrome Web Store rejects it ("version 1.1.1 already exists"), or — if the previous build was from an untracked/experimental branch — an unreviewed build ships under the release name. This is reproducible in the current tree: manifests/manifest.chrome.json exposes assets/* to https://*.web-sandbox.oaiusercontent.com/* (commit 4e6d373), but dist/chrome/manifest.json (built 23:05, before that commit) does not, so packaging right now would ship a build in which the Deep Research frame cannot import its own chunk.
- **Suggested fix:** Make `package:all` build first — change package.json:27 to `"package:all": "pnpm build && node build/package-all.cjs"` (CI already does build-then-package, so this is a no-op there) — and change releasing.md step 2 to `pnpm build && pnpm package:all` (or `make release-check`). Optionally have package-all.cjs assert `dist/chrome/manifest.json`.version === package.json.version before zipping.

### [medium] dist/ is never cleaned, so orphaned chunks from earlier builds are packaged into the store zips

- **Where:** `build/vite.config.ts`:27
- **Problem:** `emptyOutDir: false` is set in the shared base config (and again in vite.content.ts:57) and no script removes dist/ before a build; the popup/background build emits content-hashed names (`chunkFileNames: 'chunks/[name]-[hash].js'`, build/vite.config.ts:36), so every edit to a shared module leaves the previous hash behind forever. `package:chrome`/`package:firefox` (package.json:24-25) then `zip -r` the whole directory. Grepping every emitted entry and chunk in dist/chrome and dist/firefox for chunk references shows only `chunks/tab-messaging-lMX7AtqD.js` is reachable; `chunks/messages-BCXdmkJC.js`, `chunks/storage-eVCm3w4o.js`, five other `chunks/tab-messaging-*.js`, `assets/chunk-html2canvas.esm.js` (202,379 B) and `assets/chunk-index.js` (969,259 B) are referenced by nothing — ~1.19 MB of dead JS per tree, present identically in both. build/check-bundle-size.cjs cannot catch this: it validates that every getURL target *exists*, never that every emitted file is *reachable*.
- **Failure scenario:** Developer builds a few times while iterating, then cuts a release. ai-chat-exporter-v{V}-chrome.zip and -firefox.zip each carry ~1.19 MB of unreferenced JS (including a 969 KB stale highlight.js chunk). Firefox add-on review compares the source zip's `pnpm build` output against the submitted package; files the fresh build does not produce are unexplained and prompt reviewer questions, and the store package is ~2.4x larger than needed.
- **Suggested fix:** Add a clean step to the build entry point: `"build": "rm -rf dist/chrome dist/firefox && pnpm build:chrome && pnpm build:firefox"` (the zips live in dist/ itself, so only the two subdirs may be removed). Alternatively drop `[hash]` from `chunkFileNames` so names are stable, and extend check-bundle-size.cjs with a reachability sweep that fails on any emitted .js not reachable from an entry.

### [medium] Content-script injection fallback injects the Deep Research frame script into the top-level chat page

- **Where:** `src/shared/tab-messaging.ts`:45
- **Problem:** `injectContentScripts` loops over *every* `content_scripts` entry in the manifest and executes each entry's `js` in the tab's top frame. Its comment still says "there is exactly one"; the manifest has had two since Deep Research landed (manifests/manifest.base.json content_scripts[1] = content/deep-research-frame.js, matched only to https://*.web-sandbox.oaiusercontent.com/* with all_frames). `chrome.scripting.executeScript` is called without `allFrames`, so the recovery path (a) runs the sandbox-only script in the top-level chatgpt.com / claude.ai / gemini.google.com document, where it does not belong, and (b) still never reaches the sandbox iframe it was written for, so it fixes nothing there. The unit tests miss it because both stub getManifest() with a single entry (tests/unit/extension/background/service-worker.test.ts:34, tests/unit/extension/popup/popup-states.test.ts:30).
- **Failure scenario:** A chat tab was open when the extension was installed/reloaded; the user opens the popup. `sendTabMessage` gets "receiving end does not exist", injects, and deep-research-frame.ts now runs on the chat page itself: findFrame() returns the page's first (cross-origin) iframe, nestedDocument() throws→null, so targetDocument() falls back to the whole chat document; relay() reads `document.body.innerText` for the entire conversation (a full forced layout + text extraction), and watch() attaches a `{childList, subtree, characterData}` MutationObserver to document.body for 30 s, re-running that whole-page innerText read after every 500 ms of quiet — repeatedly, for the whole time the user is streaming a reply. The relayed postMessage is rejected by DEEP_RESEARCH_FRAME_ORIGIN_RE in content-script.ts:712 (so no data corruption), i.e. all of that work is pure waste.
- **Suggested fix:** Inject only the entries whose `matches` apply to the tab being repaired — simplest correct version: filter to the entry that lists the tab's host, or hardcode the main entry since it is the only one the popup/background ever needs: iterate `content_scripts` but skip entries with `all_frames: true` / whose matches do not include the tab URL. Also update the stale `ponytail:` comment on line 41-42, and fix the test stubs to mirror the real two-entry manifest.

### [medium] Every message's raw scraped HTML is serialized to the popup on every popup open, though nothing reads it

- **Where:** `src/extension/content/content-script.ts`:753
- **Problem:** The `get_conversation` handler responds with the whole `Conversation`, including `Message.htmlContent` (src/core/types/conversation.ts:124) for every question and answer — the raw innerHTML of every turn, captured because the parser config sets `preserveHtml: true`. Grepping every reference to `htmlContent` shows the only consumers are the exporters (json-exporter.ts:162-166, conversation-structure-service.ts:84) and the parsers, all of which run *in the content script*. The popup stores the object (popup.ts:749) and uses only title/meta/pair text; it never reads htmlContent and never sends the conversation back. So the largest field in the payload crosses the extension messaging boundary (structured clone + full copy in the popup's heap) purely as dead weight, and it grows linearly with conversation length with no cap.
- **Failure scenario:** A long ChatGPT/Claude thread (say 200 turns, ~30 KB of rendered answer HTML each) — clicking the toolbar icon serializes ~6 MB out of the content script and materializes the same ~6 MB in the popup, blocking both, before a single pixel of the popup's ready state is painted. The user sees the popup hang on a conversation they can otherwise export fine; nothing in the popup ever touches that data.
- **Suggested fix:** Strip it at the boundary — the popup needs a summary, not the payload. In the `isGetConversationMessage` branch, respond with a projection: `pairs.map(p => ({...p, question: {...p.question, htmlContent: undefined}, answer: {...p.answer, htmlContent: undefined}}))` (or a dedicated `ConversationSummary` type carrying id/index/selected/role/content/timestamp only). Export/print already re-parse the page for their own snapshot (content-script.ts:142, :283), so nothing downstream depends on the popup's copy being complete.

### [medium] loadImagesParallel does not dedupe URLs — a repeated image is fetched, decoded and base64-encoded once per occurrence

- **Where:** `src/core/utils/image-loader.ts`:156
- **Problem:** `PdfExporter.extractImageUrls` (src/core/exporters/pdf-exporter.ts:201-212) walks every block and pushes every image URL it sees, duplicates included. `loadImagesParallel` then batches that raw list straight into `loadImageAsDataUrl` — the `Map` it builds dedupes only the *results*, after the work is done. So each occurrence of the same URL pays a separate network fetch, decode, canvas draw and `canvas.toDataURL()` (the expensive part: full re-encode at up to 300 px), and a URL that hangs pays the full 5 s timeout again each time.
- **Failure scenario:** A conversation where the user re-attaches or the assistant re-shows the same image across turns — 20 occurrences of one URL. PDF export performs 20 image loads + 20 canvas encodes instead of 1. If that URL is dead or a data: URI that never fires onload/onerror, each occurrence burns the 5 s timeout: at concurrency 3 that is ~35 s of dead wait before the PDF starts rendering, versus ~5 s.
- **Suggested fix:** One line at the top of loadImagesParallel, which fixes it for every caller: `urls = [...new Set(urls)];` (or iterate `const unique = [...new Set(urls)]` in the batching loop). The returned Map is keyed by URL, so all callers already look results up by URL and need no change.

### [medium] Firefox manifest declares an ES-module background script while advertising a Firefox 109 floor

- **Where:** `manifests/manifest.firefox.json`:17
- **Problem:** The Firefox overlay pairs `"strict_min_version": "109.0"` (line 5) with `background: { scripts: [...], type: "module" }` (lines 12-17). Verified on the build output: dist/firefox/background/service-worker.js begins with `import{a as e,i as t,n,r,t as i}from"../chunks/tab-messaging-lMX7AtqD.js";` — a real static ES-module import, so this file cannot execute as a classic script. Per MDN's compat data, `background.type: "module"` for `background.scripts` is a considerably later Firefox feature than MV3 itself (Chrome 91 / Firefox 128 — this version number is the one part of this finding I could not verify from the repo, so confirm it before acting). README.md:249, docs/installation.md:211 and docs/store-listings/firefox-addons-v1.1.1.txt:177 all advertise "Firefox 109+", and build/check-release.cjs only asserts that `background.scripts` is an array — it never checks the module/min-version pairing.
- **Failure scenario:** A user on a Firefox between 109 and the first version supporting `background.type: "module"` (ESR 115 is the realistic case) installs the add-on, which AMO permits because strict_min_version says 109. Firefox loads service-worker.js as a classic script, hits `import` and throws a SyntaxError; the background script never initialises, so context menus are never created, the Ctrl+Shift+E command does nothing, the error badge never appears, and Claude artifact enrichment (which proxies its fetch through the background) silently degrades every export.
- **Suggested fix:** Confirm the real floor for `background.type: "module"` in Firefox, then either raise `strict_min_version` to it and update README.md:249 / docs/installation.md:211 / the store-listing text together, or drop the module requirement by bundling the background as a single self-contained file for Firefox (`build.rollupOptions.output.inlineDynamicImports` / a no-shared-chunk output for that entry) and remove `"type": "module"`. Either way, add the pairing to build/check-release.cjs's `manifest` mode so the two cannot drift again.

### [low] Content-script size gate has 5.3x headroom, so a large eager-bundle regression passes silently

- **Where:** `build/check-bundle-size.cjs`:19
- **Problem:** `LIMIT_BYTES = 300 * 1024` guards the per-page-load eager tax, but the actual eager graph is 58,225 B across 4 files (verified by running the script). That leaves 248 KB of slack. Measured against the real chunk sizes in dist, a regression that statically imports the HTML exporter path — chunk-html-exporter.js (31,072) + chunk-conversation-structure-service.js (6,353) + chunk-base-exporter.js (2,495) + chunk-code-highlight.js (2,663) + chunk-style-tokens.js (2,209) + chunk-marked.esm.js (39,910) + chunk-purify.es.js (26,869) ≈ 111 KB — lands at ~170 KB and still reports `ok`, despite tripling the tax the gate exists to protect.
- **Failure scenario:** Someone adds a static `import { HtmlExporter } from './html-exporter'` to the exporters barrel (exactly the mistake the barrel's header comment warns about) or imports `marked` statically for a helper. The eager bundle jumps from 58 KB to ~170 KB on every chatgpt.com/claude.ai/gemini page load, CI stays green, and nobody notices until someone reads the build log's byte count by hand.
- **Suggested fix:** Ratchet the limit to just above the current figure (e.g. `const LIMIT_BYTES = 80 * 1024;`) and bump it deliberately when a genuine increase is accepted — that is what turns the log line into a gate. Cheap alternative: keep 300 KB as a hard ceiling but also fail when the total grows more than ~20% over a committed baseline figure.

### [low] `pnpm build` runs the content bundle four times for two byte-identical outputs

- **Where:** `package.json`:11
- **Problem:** `build:content` runs vite twice (once with `--outDir dist/chrome`, once with `--outDir dist/firefox`) and then check-bundle-size. Both `build:chrome` (line 12) and `build:firefox` (line 13) depend on `build:content`, and `build` (line 10) runs both — so `pnpm build` executes the content bundle 4 times and check-bundle-size twice. build/vite.content.ts takes no browser parameter and contains no browser-specific branching, so the two outputs are byte-identical (confirmed: dist/chrome/assets and dist/firefox/assets have identical file sets and sizes).
- **Failure scenario:** Every `pnpm build` — locally, in `pnpm validate`, and in CI — pays 4 content-bundle builds (each pulling jsPDF, docx, html2canvas, highlight.js, marked through rolldown) where 1 build plus a directory copy would do. Pure wall-clock on the slowest step of the build, repeated on every PR.
- **Suggested fix:** Build the content bundle once into dist/chrome and copy it: `"build:content": "vite build --config build/vite.content.ts --mode production --outDir dist/chrome && cp -R dist/chrome/assets dist/chrome/content dist/firefox/ && node build/check-bundle-size.cjs"`, and drop `build:content` from one of build:chrome/build:firefox (or hoist it into `build`).

---

## Working rules for this task

- Treat each finding independently: fix what is real, and if one does not hold up on inspection say
  so in the PR rather than inventing a change. The reviewers were adversarially checked but not
  infallible.
- **Never trade correctness for tidiness.** If a fix would lose content or weaken a guard, stop and
  report instead.
- Every behavioural fix needs a test that FAILS before it and passes after. State that you verified
  this — it will be checked independently.
- Do not restyle or refactor code outside the findings listed here.

## Acceptance gate

Every finding above is either fixed with a proving test, or explicitly explained as not-a-defect.

```bash
pnpm test:run && pnpm lint && pnpm format:check && pnpm typecheck
```
