# Manifests

`manifest.base.json` holds the shared manifest. `manifest.chrome.json` and
`manifest.firefox.json` are deep-merged on top of it at build time
(`build/vite.chrome.ts`, `build/vite.firefox.ts`) to produce
`dist/<browser>/manifest.json`. A key present in a browser overlay wins over
the base — so any top-level scalar (like `name`) set in an overlay silently
shadows the base value.

## Extension ID

**Decided (owner, 2026-11-26):** the gecko id is
`ai-chats-exporter-and-printer@nuncaeslupus.github.io`. It replaces the
`ai-chat-exporter@example.com` placeholder, which was never submitted to AMO, so
no installed base is orphaned. It is an email-shaped id, not a mailbox; it is on
`nuncaeslupus.github.io`, a domain the project controls. **Never change it after
the first AMO upload** — a new gecko id creates a new add-on and cuts existing
users off from updates.

Background, kept for the record:

There **is** an AMO listing at the slug `ai-chat-exporter`
(`https://addons.mozilla.org/api/v5/addons/addon/ai-chat-exporter/`), and its
guid is `claude-chat-exporter@example.com` — not the id in this repo. But the
listing metadata does **not** establish that it belongs to this project:

| Field | Live AMO listing | This repo |
| --- | --- | --- |
| guid | `claude-chat-exporter@example.com` | `ai-chats-exporter-and-printer@nuncaeslupus.github.io` |
| author | `Hamza` (AMO user 19601913) | `nuncaeslupus` |
| version | 1.4.0 | 1.2.0 |
| created | 2025-11-29 | — |
| homepage / support URL | none set | — |

The version is two minor releases ahead of this repo and the author is a
different account, so the more likely reading is that this is a **different
developer's add-on** (an upstream or a sibling fork), not this project's own
listing. Matching permissions and host patterns prove nothing here — any fork of
the same codebase has them.

**Consequence: do not adopt `claude-chat-exporter@example.com`.** Publishing
under a guid that belongs to someone else's add-on is not a merge — AMO would
reject it, and if it did not, it would be a hijack of their listing.

This project had no AMO listing of its own, so the placeholder was replaced
rather than kept.
