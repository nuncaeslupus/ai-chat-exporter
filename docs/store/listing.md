# Store listing kit (Chrome Web Store and Firefox Add-ons)

Everything to paste into the two dashboards. Plain text only: neither store
renders Markdown. The per-release text (what's new, version history) stays in
`docs/store-listings/*-v{VERSION}.txt`; this file holds the evergreen fields.

Read `docs/dev/releasing.md` § "Keyword density" before editing the description:
v1.3.0 was refused for it. Check with `node build/check-release.cjs keywords`.

## Identity

| Field | Value |
|---|---|
| Name | AI Chats Exporter and Printer |
| Category (Chrome) | Productivity |
| Category (AMO) | Productivity |
| Language | English (the extension ships ca, de, en, es, fr, it, pt) |
| License (AMO) | MIT |
| Homepage | https://github.com/nuncaeslupus/ai-chat-exporter |
| Support URL | https://github.com/nuncaeslupus/ai-chat-exporter/issues |
| Privacy policy URL | https://github.com/nuncaeslupus/ai-chat-exporter/blob/main/docs/PRIVACY.md |

## Chrome: short summary (max 132 characters)

```
Export and print ChatGPT, Claude and Gemini conversations to PDF, Markdown, Word and other formats with rich formatting.
```

(120 characters.) Paste into the dashboard's summary field. The manifest
`description` comes separately from `_locales/en/messages.json`.

## AMO: summary (max 250 characters)

```
Export and print ChatGPT, Claude and Gemini conversations to PDF, Markdown, Word and other formats. Everything is processed locally in your browser, with no account, no server and no tracking.
```

(192 characters.)

## Full description (both stores)

```
Export your AI conversations with professional formatting - AI Chats Exporter and Printer makes it easy to save and share your conversations with ChatGPT, Claude and Gemini in multiple formats.

🎯 Key Features

Multiple Export Formats:

• Six formats to choose from, including PDF, Markdown and Word
• Code highlighting, images, tables and math are kept in every one
• Page numbers and print-ready pagination where the format supports it

Multiple Access Methods:

• Extension toolbar icon with popup interface
• Right-click context menus for quick access
• Keyboard shortcut (Ctrl+Shift+E / Cmd+Shift+E)

Print Support:

• Opens the conversation in a new tab and raises the browser print dialog
• Print-friendly formatting
• Available for every format except Word
• Quick access via context menu

Rich Content Preservation:

• Code blocks with syntax highlighting
• Mathematical formulas, kept as their LaTeX source
• Images and visual content
• Tables and lists
• Web citations and references (ChatGPT)
• Code artifacts (ChatGPT and Claude)

Multi-Language Support:

• English, Spanish, French, German, Italian, Portuguese, Catalan
• Automatic language detection
• Localized user interface

🌐 Supported Platforms

• ChatGPT (chat.openai.com, chatgpt.com) - Including code artifacts and web search results
• Claude (claude.ai) - Including artifact contents
• Gemini (gemini.google.com) - Full conversation export

🔒 Privacy & Security

• Local Processing - Reading the page, formatting the export, and generating the file all happen in your browser
• No Data Collection - The extension has no backend, analytics, or telemetry. We never see, store, or receive your conversations
• No Third Parties - The extension sends nothing to any third party. Its only network requests go to the chat provider whose page you are already on: claude.ai's own API (using your existing session) to fetch Claude conversation data, and, for PDF exports, the images already in your conversation so they can be embedded in the file. See our Privacy Policy for details.
• Open Source - Full transparency with public source code

📋 How to Use

Method 1: Extension Popup
1. Open any supported AI chat platform
2. Click the extension icon in your toolbar
3. Choose your export format
4. Click Export (or Print) - the whole conversation is exported
5. Download your formatted conversation

Method 2: Right-Click Menu
1. Open any supported AI chat platform
2. Right-click anywhere on the page
3. Select "Export" or "Print" from the context menu
4. Choose your desired format
5. Your conversation is instantly exported or printed

Method 3: Keyboard Shortcut
• Press Ctrl+Shift+E (Windows/Linux) or Cmd+Shift+E (Mac) to export straight away, in the format you last used

🎨 Professional Output

All exports include:

• Conversation title and metadata (platform, model, date, URL)
• Proper formatting and structure
• Code syntax highlighting
• Images, embedded in the file or linked, depending on the format
• Web search results and citations

🚀 Perfect For

• Developers - Save code examples and technical discussions
• Researchers - Archive research conversations with citations
• Students - Keep learning materials and study notes
• Content Creators - Export content for blogs and articles
• Teams - Share conversations and knowledge
• Documentation - Create guides and tutorials

🆓 Completely Free

No subscriptions, no hidden costs, no limitations. All features are available to everyone.

💡 Support & Feedback

Having issues or suggestions? Visit our GitHub repository (https://github.com/nuncaeslupus/ai-chat-exporter) to report bugs or request features.```

## Single purpose statement (Chrome "Single purpose" field)

```
Export the conversation open in a ChatGPT, Claude or Gemini tab to a downloadable file (PDF, Markdown, Word and other formats), or print it. Everything the extension does serves that one purpose.
```

## Permission justifications (Chrome "Permission justification" fields)

Paste each into the field with the matching name.

| Permission | Justification |
|---|---|
| `activeTab` | Lets the toolbar popup, context menu and keyboard shortcut act on the chat tab the user is looking at when they ask for an export or print. |
| `storage` | Saves the user's preferences (last used format, language, theme, meta-info toggle) in `chrome.storage.local`, on the device only. Nothing is synced or sent anywhere. |
| `contextMenus` | Adds the right-click "Export" and "Print" entries on supported chat pages. |
| `scripting` | Re-injects the extension's own content script into a supported chat tab that was already open when the extension was installed, updated or reloaded, so export works without a page refresh. It can only run on the hosts listed below. |
| Host permissions: `chat.openai.com`, `chatgpt.com`, `claude.ai`, `gemini.google.com` | Needed to read the conversation on the open page, which is the extension's single purpose. On claude.ai the extension also calls Claude's own API with the user's existing session to get artifact content the page does not render. No other site is accessible. |
| Host permission: `*.web-sandbox.oaiusercontent.com` | A ChatGPT Deep Research report renders in a sandboxed frame served from this subdomain, cross-origin from chatgpt.com. Without access the report text cannot be exported. Scoped to the `web-sandbox` subdomain only, not all of `oaiusercontent.com`. |
| Remote code | **No, I am not using remote code.** All JavaScript ships inside the package (the PDF, Word and other exporters are bundled). No `eval`, no remotely hosted scripts or modules. |

AMO has no per-permission form; reviewers read the "Notes to reviewer" below.

## Chrome privacy tab: data usage

**Which user data do you collect?** Tick none of the categories (owner's decision). The extension
reads page content (the conversation) to build the file, but that content is
processed on the device and never transmitted to the developer or any third
party; the developer runs no server. Google's policy counts data that leaves the
device. If the owner prefers a conservative reading, the only categories that
could be argued are "Website content" and "Personal communications"; do not tick
them unless the dashboard blocks submission without it.

Then certify all three disclosures:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## AMO: data collection (manifest key, already set)

`manifest.firefox.json` declares `data_collection_permissions.required: ["none"]`,
so AMO shows "no data collection". It matches the policy above.

## AMO: notes to reviewer (paste into "Notes to Reviewer")

```
Source and build: the uploaded source zip contains BUILD_INSTRUCTIONS.md.
Node >= 22 and pnpm 10.27.0 are required. Run "pnpm install" then
"pnpm build:firefox"; the output in dist/firefox/ is what was uploaded (the zip is
made with "pnpm package:firefox"). Dependencies are pinned by pnpm-lock.yaml.

Network use: the extension has no backend and no analytics. The only requests
go to the chat site the user is already on: on claude.ai it calls
/api/organizations and /api/organizations/<id>/chat_conversations/<id> with the
user's own session to read artifact content; during PDF export it downloads
images that the chat page already shows. No remote code is loaded; there is no
eval or Function use.

Permissions: activeTab, storage, contextMenus, scripting, and host access to
chat.openai.com, chatgpt.com, claude.ai, gemini.google.com and
*.web-sandbox.oaiusercontent.com (the sandboxed frame that holds ChatGPT Deep
Research reports). Each is justified in the store listing.

To test: log in to any of the three chat sites, open a conversation, click the
toolbar icon and choose a format.
```

## Screenshots

Chrome: 1 to 5 at exactly 1280x800 (or 640x400), 24-bit PNG or JPEG, no alpha.
AMO: any size, at most 10. See `submit.md` for how to capture them. Suggested set:

1. Popup open over a chat, formats visible.
2. Right-click menu showing Export and Print.
3. An exported PDF page with code highlighting.
4. An exported document with a table and math.
5. Language setting in the popup.

Chrome also asks for a small promotional tile (440x280 PNG, required to show in
some surfaces, recommended) and the 128x128 icon (taken from the package).
`docs/hero.png` is 2560x1280 and is not a valid tile as is.

## Open decisions for the owner

1. **Firefox add-on id.** `manifests/manifest.firefox.json` uses the placeholder
   `ai-chat-exporter@example.com`. See `manifests/README.md`: an AMO listing with
   slug `ai-chat-exporter` already exists under another author and guid
   `claude-chat-exporter@example.com`. If this project has no AMO listing yet,
   pick a real id (an email-style or `{uuid}` id you control) before the first
   upload, because the id cannot change afterwards. If it does have one, use that
   id verbatim. The slug `ai-chat-exporter` is taken: use
   `ai-chats-exporter-and-printer`.

Decided:

- **Name:** "AI Chats Exporter and Printer" everywhere (manifest `extensionName`,
  both store listings, exported-file footers).
- **Chrome data usage:** tick none of the categories (see above).
