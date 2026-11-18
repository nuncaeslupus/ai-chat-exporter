---
id: t-e1a45a6e
title: "review: Firefox add-on id is an example.com placeholder that does not match the published one"
priority: 5
requires: [human:gate]
---

Imported from issue #285

**Severity:** medium · **Confidence:** medium · **Category:** release

**Where:** `manifests/manifest.firefox.json:4, manifests/README.md:16-47`

### Finding
manifest.firefox.json ships gecko.id 'ai-chat-exporter@example.com'; manifests/README.md records that the AMO listing uses a different example.com guid. A build from this repo cannot update the listed add-on, and example.com is a domain the project does not control. Firefox store listings exist for six versions, so this is a live release hazard, not a draft.

### Evidence
Read the manifest; grep of manifests/README.md (only the matching lines were read). build/check-release.cjs has no check on the id.

### Suggested direction
Decide the id once (the already-published guid if updates must continue), set it in the manifest, and add a check-release assertion that it is not an example.com address.

_From the full repo review of 2026-11-11 (finding #6). Not fixed yet; verify before acting._

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
