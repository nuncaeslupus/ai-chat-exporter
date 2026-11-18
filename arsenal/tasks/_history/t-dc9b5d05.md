---
id: t-dc9b5d05
title: "review: Popup keeps showing the previous conversation after SPA navigation to a non-chat page"
priority: 5
requires: [human:gate]
status: merged
---

Imported from issue #282

**Severity:** medium · **Confidence:** medium · **Category:** correctness

**Where:** `src/extension/content/content-script.ts:82-90, src/extension/content/content-script.ts:803-812, src/core/parsers/claude/parser.ts:126-143, src/core/parsers/gemini/parser.ts:34-38`

### Finding
initialize() returns early without clearing this.conversation (or this.drift when no parser matches) when parsing yields nothing, and GET_CONVERSATION then answers with the cached object. Open a Claude/Gemini chat, navigate in-app to a page where canParse() is false (settings, projects, a view without the container), open the popup: it lists the old chat's pairs as exportable, then Export fails with NO_CONVERSATION.

### Evidence
traced code path (node_modules absent, tests could not be run): parseConversation returns null at l.109-111/120-122, initialize only calls notifyPageReadyState(false); success:true + stale data is sent at l.806-820. Popup-side handling not read.

### Suggested direction
Set this.conversation = null and this.drift = undefined on a failed parse, and answer success:false so the popup shows its 'no conversation' state.

_From the full repo review of 2026-11-11 (finding #3). Not fixed yet; verify before acting._

## Acceptance gate

<!-- This task came from an issue, so its "gate" is prose. Write a real check
     below, then DELETE the `requires: [human:gate]` line in the front matter.
     Until that line is gone the selector will not offer this task, which is
     deliberate: a prose gate runs nothing, and a gate that runs nothing passes
     everything. -->

```bash
# arsenal:gate-placeholder — replace with the real check; it may land in this task's own PR
false
```
