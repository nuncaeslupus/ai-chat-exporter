# Privacy Policy

_Last updated: 2026-07-29_

AI Chat Exporter is a browser extension that exports your ChatGPT, Claude, and
Gemini conversations to PDF, Markdown, DOCX, HTML, TXT, and JSON. This page
explains what data it touches and where any network requests go.

**In short: your conversations never leave your browser.** We have no server,
so there is nowhere for them to go. Nobody — including us — can read, collect,
or store what you export. The rest of this page is the detail behind that.

## What we collect

Nothing. The extension has no backend, no analytics, and no telemetry. There is
no server operated by us for it to talk to, so we never see, receive, or store
your conversations or anything else about your use of the extension.

Your conversations are read from the page, turned into a file, and saved to your
computer. They are never uploaded, never transmitted to us, and never shared
with anyone.

## Local processing

Reading the page, formatting the export, and generating the output file all
happen locally in your browser. Export settings (e.g. your preferred format)
are saved with `chrome.storage`, which stays on your device.

## Network requests the extension makes

The extension sends **no requests to any third party**. It makes no request at
all while you browse; the only requests happen when you export, and they go to
the chat provider whose page you are already on:

- **Claude conversation data.** When exporting from `claude.ai`, the extension
  calls Claude's own API
  (`https://claude.ai/api/organizations/.../chat_conversations/...`) using your
  existing logged-in session, to retrieve message content the page does not
  fully render in the DOM. This is the same request the page itself makes, it
  uses your own Claude session, and it goes only to `claude.ai`. Exports from
  other platforms make no API call at all.
- **Images already in the conversation.** If your conversation contains images
  (uploads, generated images, images in the assistant's reply), a **PDF** export
  downloads them from wherever the chat page already loads them from — the
  provider's own servers — so it can embed them in the file. This happens while
  you are on that page, under that page's session.

## What the exported files do when you open them

- **PDF** embeds its images directly in the file. **DOCX** and **TXT** replace
  images with a text placeholder, and **JSON** records their URLs as plain data.
  None of these four fetch anything when you open them.
- **HTML** and **Markdown** exports reference conversation images by their
  original URL rather than embedding them, so opening one asks the provider's
  servers for those images. Those URLs are usually session-scoped, which means
  the images typically fail to load once you are signed out. No other resource
  is requested: the exported HTML has no external stylesheet, script, web font,
  or tracking pixel, and its styling and code highlighting are inlined.
- **Generated video and audio** (Gemini's "Create video" / "Create music") are
  never downloaded or embedded — no export format bundles the clip itself. The
  **HTML** export puts a player in the page pointing at the original URL, so
  pressing play asks the provider's servers for it; **PDF**, **DOCX**, **TXT**
  and **Markdown** only write a labelled link, and **JSON** records the URL as
  plain data. Like image URLs, these are usually session-scoped and typically
  stop working once you are signed out.
- **Web-search citations** are exported as the link, the page title, and the
  domain only. Citation favicons are deliberately dropped rather than carried
  into the export, because chat pages serve them from third-party icon services
  and keeping them would tell that service which sources you exported — and
  reveal your IP address — every time the file was opened.

## Permissions

The extension requests `activeTab`, `storage`, `contextMenus`, and `scripting`,
plus host access limited to `chat.openai.com`, `chatgpt.com`, `claude.ai`,
`gemini.google.com`, and `*.web-sandbox.oaiusercontent.com`. It cannot read or
make requests to any other site.

`scripting` is used for one thing: putting the content script back into a chat
tab that was already open when the extension was installed, updated or reloaded.
It is bounded by the same hosts — there is no site it can reach that it could
not already read.

`*.web-sandbox.oaiusercontent.com` exists for one narrow purpose: a ChatGPT
Deep Research answer (and any sibling "connector" widget) renders in a
sandboxed `<iframe>` served from that host, cross-origin from `chatgpt.com`
itself — without this permission the extension cannot read a single character
of the report, and the export would only be able to name the widget instead of
including its content. The host is scoped to the `web-sandbox` subdomain
specifically, not all of `oaiusercontent.com` (which also serves your uploaded
files) — the extension has no access to that broader domain. The only thing
read from this frame is the report text it already rendered for you to look
at; nothing is read from any other frame on that host, and nothing from this
frame is sent anywhere except into the export file building locally in your
browser.

## Questions

Open an issue at
https://github.com/nuncaeslupus/ai-chat-exporter/issues.
