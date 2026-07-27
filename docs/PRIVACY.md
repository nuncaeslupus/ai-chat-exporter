# Privacy Policy

_Last updated: 2026-07-28_

AI Chat Exporter is a browser extension that exports your ChatGPT and Claude
conversations to PDF, Markdown, DOCX, HTML, TXT, and JSON. This page explains
what data it touches and where any network requests go.

## What we collect

Nothing. The extension has no backend and no analytics or telemetry. We (the
developers) never see, receive, or store your conversations or any other
data from your use of the extension.

## Local processing

Reading the page, formatting the export, and generating the output file all
happen locally in your browser. Export settings (e.g. your preferred format)
are saved with `chrome.storage`, which stays on your device.

## Network requests the extension makes

The extension does make two kinds of outbound requests, both to services you
are already interacting with or have cited — not to us:

- **Claude conversation data.** When exporting a conversation from
  `claude.ai`, the extension calls Claude's own API
  (`https://claude.ai/api/organizations/.../chat_conversations/...`) using
  your existing logged-in session, to retrieve message content the page
  doesn't fully render in the DOM. This uses your own Claude session and
  goes only to `claude.ai` — not to us or any third party.
- **Favicons for ChatGPT web-search citations.** When a ChatGPT conversation
  includes web-search citations, the exported document embeds favicon icons
  loaded from Google's public favicon service
  (`https://www.google.com/s2/favicons`). These icons are fetched when you
  later open the exported file, and that request tells Google which cited
  domains you exported and your IP address — no conversation content is
  included.

## Permissions

The extension requests `activeTab`, `storage`, and `contextMenus`, plus host
access limited to `chat.openai.com`, `chatgpt.com`, and `claude.ai` — the
sites it can currently export from. Gemini support is not yet shipped.

## Questions

Open an issue at
https://github.com/nuncaeslupus/ai-chat-exporter/issues.
