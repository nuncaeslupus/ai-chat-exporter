# AI Chat Exporter

<!-- claude-arsenal:attribution: added by claude-arsenal's /init. Delete this block to drop it (it is not put back), or set `attribution = false` in the arsenal config.toml. -->
[![Built with claude-arsenal](https://img.shields.io/badge/built%20with-claude--arsenal-d97756)](https://github.com/nuncaeslupus/claude-arsenal)
<!-- /claude-arsenal:attribution -->

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/jnllafelflonllnhccgofcakopbpjahf?label=chrome%20web%20store)](https://chromewebstore.google.com/detail/ai-chat-exporter/jnllafelflonllnhccgofcakopbpjahf)
[![Firefox Add-ons](https://img.shields.io/amo/v/ai-chat-exporter-and-printer?label=firefox%20add-ons)](https://addons.mozilla.org/en-US/firefox/addon/ai-chat-exporter-and-printer/)
[![CI](https://github.com/nuncaeslupus/ai-chat-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/nuncaeslupus/ai-chat-exporter/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

<p align="center">
  <img src="https://raw.githubusercontent.com/nuncaeslupus/ai-chat-exporter/main/docs/hero.png" width="100%" alt="AI Chat Exporter: a conversation from ChatGPT, Claude or Gemini, with one question-and-answer pair selected and one left out, goes through the extension's download icon, triggered by Ctrl+Shift+E, the popup or a right-click, and comes out as Markdown, PDF, HTML, Word, plain text or JSON">
</p>

**Export or print your ChatGPT, Claude and Gemini conversations as Markdown, PDF, HTML, Word, plain text or JSON.**

Chat platforms keep your conversations behind their own UI, and copy-paste loses
code blocks, tables, math, citations and artifacts. AI Chat Exporter is a Chrome,
Edge and Firefox extension that reads the open conversation, keeps its structure,
and writes a clean file. Everything runs locally in your browser; there is no backend.

## Quick start

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/ai-chat-exporter/jnllafelflonllnhccgofcakopbpjahf)
(Chrome, Edge) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/ai-chat-exporter-and-printer/).
Open a conversation on ChatGPT, Claude or Gemini and press `Ctrl+Shift+E`
(`Cmd+Shift+E` on Mac). The file downloads in the format you last used.

## Example

A ChatGPT reply with a heading, lists, a table, a blockquote, code and LaTeX,
exported to Markdown (excerpt of the actual output for the
`tests/fixtures/dom-snapshots/chatgpt/formatting-showcase-2026-07.html` capture):

````markdown
# ChatGPT Conversation

| **Field** | **Value** |
|---|---|
| Platform | ChatGPT |
| Model | gpt-5-5 |
| Exported | 2026-10-20 09:18:59 |
| URL | https://chatgpt.com/c/abc123 |

---

**User**

> Reply with a short formatting showcase using ONLY invented sample data about a fictional widget factory. [...]

**ChatGPT**

## Fictional Widget Factory

- Blue widgets
- Red widgets
  - Tested daily
- Golden widgets

| Widget | Batch | Status |
| --- | --- | --- |
| Alpha | F-101 | Ready |
| Beta | F-102 | Packed |

> Every fictional widget passed pretend inspection.

Inline: $E = mc^2$

$$\sum_{i=1}^{3} i = 6$$

### Artifacts

#### Python

```python
factory = "Fictional"
widgets = ["Alpha", "Beta"]
[...]
```
````

The same conversation as JSON (shortened):

```json
{
  "schemaVersion": 2,
  "title": "ChatGPT Conversation",
  "platform": "chatgpt",
  "model": "gpt-5-5",
  "url": "https://chatgpt.com/c/abc123",
  "exportedAt": "2026-10-20T09:18:59+00:00",
  "createdAt": "2026-10-20T09:18:59+00:00",
  "pairs": [
    {
      "index": 0,
      "question": { "role": "user", "content": "Reply with a short formatting showcase ..." },
      "answer": { "role": "assistant", "content": "...", "htmlContent": "...", "metadata": {} }
    }
  ]
}
```

## From an agent

There is no MCP server or agent API: the extension acts on a page open in your
browser. For agent workflows, export with **JSON** and hand the file to the agent;
it carries `schemaVersion`, platform, model, URL, timestamps and the ordered
question/answer `pairs`. Markdown is the better choice when the agent should read
the conversation as text. The JSON layout is documented in
[docs/usage.md](./docs/usage.md#json-json).

## Features

- **Platforms**: ChatGPT (`chatgpt.com`, `chat.openai.com`), Claude (`claude.ai`), Gemini (`gemini.google.com`).
- **Formats**: Markdown, PDF (paginated, syntax-highlighted, page numbers), standalone HTML, Word (.docx), plain text, JSON.
- **Content kept**: code blocks, tables, lists, headings, blockquotes, inline formatting, images, artifacts and canvas content, web search citations (link, title, domain), math as its LaTeX source.
- **Q&A selection**: pick which question/answer pairs to export instead of all or nothing.
- **Three ways to export**: toolbar popup, right-click **Export** / **Print** menus, `Ctrl+Shift+E`.
- **Print**: every format except DOCX can be sent to the browser print dialog.
- **Options**: metadata/timestamp toggle, text size, drag-and-drop filename builder, dark mode in the popup and in exported HTML.
- **Languages**: English, Spanish, French, German, Italian, Portuguese, Catalan; a setting pins the language of both the popup and the exported file.

## Usage

1. Open a conversation on a supported site.
2. Click the extension icon, choose a format, then **Export** (download) or **Print**.
3. Or right-click the page and pick a format from **Export** or **Print**.

`Ctrl+Shift+E` (`Cmd+Shift+E`) is the only shortcut and repeats the last format.
Rebind it at `chrome://extensions/shortcuts`, or in Firefox at `about:addons` ->
gear icon -> "Manage Extension Shortcuts".

Platform notes:

- **Claude**: artifact bodies are fetched from Claude's own API with your existing
  session, because the page only renders an artifact chip. If that call fails the
  export still succeeds and tells you the bodies are missing.
- **Gemini**: the thinking panel and action bars are left out.
- **ChatGPT**: Deep Research reports are read from their sandboxed frame.

Full guide: [docs/usage.md](./docs/usage.md).

### Install from source

Requires Node.js >= 22.0.0 and pnpm.

```bash
pnpm install
pnpm build:chrome    # or: pnpm build:firefox
```

- **Chrome / Edge**: `chrome://extensions/` -> enable Developer mode -> **Load unpacked** -> `dist/chrome`.
- **Firefox**: `about:debugging#/runtime/this-firefox` -> **Load Temporary Add-on** -> `dist/firefox/manifest.json`.

Supported browsers: Chrome/Edge 88+, Firefox 112+.

## Privacy and permissions

The extension collects nothing and sends your conversations nowhere: parsing,
formatting and file generation happen in the browser, with no analytics or
third-party SDKs. The only network requests go to the chat provider whose page you
are on: Claude's API for artifact content, and conversation images for PDF
embedding. Exported HTML and Markdown reference images by their original URL.

Permissions: `activeTab`, `storage`, `contextMenus`, `scripting`, plus host access
to `chat.openai.com`, `chatgpt.com`, `claude.ai`, `gemini.google.com` and
`*.web-sandbox.oaiusercontent.com`. Each is explained in [docs/PRIVACY.md](./docs/PRIVACY.md).

## Limitations

- No in-page export buttons: use the popup, the context menu or the shortcut.
- One conversation at a time; no batch export.
- Parsers read each site's DOM, so a markup change on a platform can break
  extraction until the parser is updated. `pnpm probe` generates a DevTools snippet
  that reports selector matches for a bug report.

Open work is tracked in [GitHub issues](https://github.com/nuncaeslupus/ai-chat-exporter/issues).

## Documentation

- [Installation](./docs/installation.md), [Usage](./docs/usage.md), [Privacy](./docs/PRIVACY.md)
- Developer docs: [docs/dev/](./docs/dev/README.md) (architecture, building, testing, adding parsers and exporters)
- [CHANGELOG.md](./CHANGELOG.md)

## Development

```bash
pnpm install
pnpm dev:chrome      # watch build; or pnpm dev:firefox
pnpm test            # vitest
pnpm typecheck
pnpm lint
pnpm validate        # lint, format check, typecheck, coverage, build
```

Code layout: parsers in `src/core/parsers/<platform>/`, exporters in
`src/core/exporters/`, extension code (service worker, content scripts, popup) in
`src/extension/`. See [docs/dev/architecture.md](./docs/dev/architecture.md),
[adding-parsers.md](./docs/dev/adding-parsers.md) and
[adding-exporters.md](./docs/dev/adding-exporters.md).

## Related projects

- [claude-arsenal](https://github.com/nuncaeslupus/claude-arsenal) — spec-driven Claude Code workflow and gated task queue.
- [drawspec](https://github.com/nuncaeslupus/drawspec) — declarative diagram spec → clean SVG/PNG/text, writable by LLMs; MCP server included.
- [doc-control](https://github.com/nuncaeslupus/doc-control) — lets AI agents edit Word documents as tracked changes.
- [literary-critic](https://github.com/nuncaeslupus/literary-critic) — LLM manuscript analysis the way a professional editor would.
- [integral-job-search](https://github.com/nuncaeslupus/integral-job-search) — candidate-centred job search run in Claude Code.

## License

MIT. See [LICENSE](./LICENSE). Not affiliated with or endorsed by OpenAI, Anthropic or Google.
