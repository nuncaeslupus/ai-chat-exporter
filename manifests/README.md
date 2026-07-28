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

There **is** an AMO listing at the slug `ai-chat-exporter`
(`https://addons.mozilla.org/api/v5/addons/addon/ai-chat-exporter/`), and its
guid is `claude-chat-exporter@example.com` — not the id in this repo. But the
listing metadata does **not** establish that it belongs to this project:

| Field | Live AMO listing | This repo |
| --- | --- | --- |
| guid | `claude-chat-exporter@example.com` | `ai-chat-exporter@example.com` |
| author | `Hamza` (AMO user 19601913) | `nuncaeslupus` |
| version | 1.4.0 | 1.1.1 |
| created | 2025-11-29 | — |
| homepage / support URL | none set | — |

The version is three minor releases ahead of this repo and the author is a
different account, so the more likely reading is that this is a **different
developer's add-on** (an upstream or a sibling fork), not this project's own
listing. Matching permissions and host patterns prove nothing here — any fork of
the same codebase has them.

**Consequence: do not adopt `claude-chat-exporter@example.com`.** Publishing
under a guid that belongs to someone else's add-on is not a merge — AMO would
reject it, and if it did not, it would be a hijack of their listing.

What a maintainer needs to confirm before the next Firefox submission:
1. Does this project have its OWN AMO listing? If so, under which slug and guid?
   (The answer is not discoverable from the public API without knowing the slug.)
2. If it has never been submitted, then `ai-chat-exporter@example.com` has no
   installed base to orphan — and it should be replaced with a real id on a
   domain the project controls, because `example.com` is a reserved placeholder
   (RFC 2606) and is poor practice in a shipped manifest.
3. If it HAS been submitted under some other id, that id must be used verbatim —
   changing a published gecko id creates a **new** add-on and orphans every
   existing user.

Until (1) is answered, leave the value alone.
