# Manifests

`manifest.base.json` holds the shared manifest. `manifest.chrome.json` and
`manifest.firefox.json` are deep-merged on top of it at build time
(`build/vite.chrome.ts`, `build/vite.firefox.ts`) to produce
`dist/<browser>/manifest.json`. A key present in a browser overlay wins over
the base — so any top-level scalar (like `name`) set in an overlay silently
shadows the base value.

## Extension ID

**Needs a human decision — do not change `manifests/manifest.firefox.json`'s
`browser_specific_settings.gecko.id` without reading this first.**

`manifest.firefox.json` currently sets the gecko id to
`ai-chat-exporter@example.com` (an `example.com` placeholder, present since the
initial commit — never changed in this repo's history).

Querying the public AMO API for the live listing (slug `ai-chat-exporter`,
`https://addons.mozilla.org/api/v5/addons/addon/ai-chat-exporter/`) shows the
**actual published guid is `claude-chat-exporter@example.com`** — a different
value than what's in this repo. The listing otherwise matches this project
(same permissions, same host list, same feature description), so this is not
a false match.

This means one of:
- the id in this repo was never the one actually submitted to AMO (a manual
  edit was made to the manifest before zipping/submitting at some point), or
- the live listing predates/diverges from this repo's manifest history for
  some other reason.

Changing `manifests/manifest.firefox.json`'s gecko id to match — or shipping
the current `ai-chat-exporter@example.com` as-is — both carry risk: Firefox
treats a gecko id change as a **new** add-on, orphaning every existing user of
whichever id is actually live. **Do not change this value until a maintainer
confirms which id the next submission should carry** (likely
`claude-chat-exporter@example.com`, to match what's already published).
