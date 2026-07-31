---
name: usage
description: Complete guide to using AI Chat Exporter features
metadata:
  category: user
  audience: end-users
---

# Usage Guide

Complete guide to using the AI Chat Exporter extension.

## Table of Contents

- [Getting Started](#getting-started)
- [Exporting Conversations](#exporting-conversations)
  - [From the Popup](#from-the-popup)
  - [From the Right-Click Menu](#from-the-right-click-menu)
  - [Export Formats](#export-formats)
- [Printing Conversations](#printing-conversations)
- [Extension Popup](#extension-popup)
- [Keyboard Shortcut](#keyboard-shortcut)
- [Defaults](#defaults)
- [What the Extension Does Not Do](#what-the-extension-does-not-do)
- [Advanced Usage](#advanced-usage)
- [Tips & Best Practices](#tips--best-practices)
- [FAQ](#faq)

---

## Getting Started

After installing the extension (see [Installation Guide](installation.md)):

1. Navigate to a supported AI chat platform:
   - ChatGPT: https://chat.openai.com or https://chatgpt.com
   - Claude: https://claude.ai
   - Gemini: https://gemini.google.com

2. Open or start a conversation

3. Click the extension icon in your browser toolbar, or right-click on the page

> The extension adds no buttons to the chat page itself. Everything is reached
> from the toolbar popup, the right-click menu, or the keyboard shortcut.

---

## Exporting Conversations

### From the Popup

1. **Click the extension icon** in your browser toolbar

   The popup shows the detected platform, the conversation title, and the
   number of Q&A pairs found.

2. **Pick a format** from the format menu

   Markdown, HTML, PDF, Word (DOCX), Plain Text or JSON. See
   [Export Formats](#export-formats).

3. **Click "Export"**

   Your browser downloads the file. Filename: `{conversation-title}_{date}.{ext}`
   by default — customizable, see [Extension Popup](#extension-popup).

By default the whole conversation is exported; use the pair chooser (see
[Extension Popup](#extension-popup)) to export only some exchanges.

### From the Right-Click Menu

1. Right-click anywhere on a supported chat page
2. Hover **Export** (or **Print**)
3. Pick a format from the submenu

The export starts immediately — no popup needed. **Print** offers every format
except DOCX.

### Export Formats

#### PDF
**Best for**: Sharing, archiving, printing

- Paginated document layout
- Preserves formatting and code blocks
- Includes a metadata header (title, date, platform, model)
- Page numbers and conversation info
- Conversation images are embedded in the file
- File size: Medium to large

**Output example**:
```
Title: Understanding Neural Networks
Date: 2026-01-02
Platform: ChatGPT
Model: gpt-4

Q: What is a neural network?
A: A neural network is...
[continues with formatted content]
```

#### Markdown (.md)
**Best for**: Documentation, editing, version control

- Plain text with formatting markers
- Code blocks with language tags
- Compatible with GitHub, VSCode, Obsidian, etc.
- Easy to edit and search
- File size: Small

**Output example**:
```markdown
# Understanding Neural Networks

**Date**: 2026-01-02
**Platform**: ChatGPT

## Q: What is a neural network?

A: A neural network is...

```python
# Code blocks preserved
import torch
```
```

#### HTML (.html)
**Best for**: Reading in a browser, printing, sharing a single self-contained file

- Styling and code highlighting are inlined — no external stylesheet, script or
  web font
- Images are referenced by their original URL rather than embedded, so they load
  only while you are still signed in to the chat provider
- File size: Small to medium

#### Plain Text (.txt)
**Best for**: Maximum compatibility, minimal processing

- Pure text, no formatting
- Works everywhere
- Smallest file size
- Easy to parse programmatically

**Output example**:
```
Understanding Neural Networks
Date: 2026-01-02

Q: What is a neural network?

A: A neural network is...
```

#### JSON (.json)
**Best for**: Programmatic access, data analysis

- Structured data format
- Includes conversation metadata, roles, and the raw HTML of each message
- Image, artifact and web-search metadata is preserved per message
- Easy to parse with code
- File size: Medium

**Structure** (with "Show meta-info" on):
```json
{
  "schemaVersion": 2,
  "title": "Understanding Neural Networks",
  "platform": "claude",
  "model": "claude-opus-4",
  "url": "https://claude.ai/chat/...",
  "exportedAt": "2026-07-29T15:12:04+02:00",
  "dateRange": {
    "from": "2026-07-29T15:10:11+02:00",
    "to": "2026-07-29T15:12:04+02:00"
  },
  "pairs": [
    {
      "index": 0,
      "question": {
        "role": "user",
        "content": "What is a neural network?",
        "timestamp": "2026-07-29T15:10:11+02:00"
      },
      "answer": {
        "role": "assistant",
        "content": "A neural network is...",
        "timestamp": "2026-07-29T15:12:04+02:00"
      }
    }
  ]
}
```

`exportedAt`, `dateRange` and per-message `timestamp` are local time with an
explicit UTC offset, not `Z` — the offset round-trips through `new Date()`
unchanged, which a normalized `Z` timestamp would not. `title`, `platform`,
`model`, `url`, `createdAt` and `dateRange` are only present when "Show
meta-info" is on. A message's `timestamp` is present only where the platform
provides one — today only Claude does; ChatGPT and Gemini messages never carry
a timestamp. `htmlContent` and `metadata` (images, artifacts, web-search
results) are included per message when present, regardless of the
"Show meta-info" setting.

#### DOCX (.docx)
**Best for**: Editing in Word, sharing with non-technical users

- Microsoft Word format
- Compatible with Word, LibreOffice, Google Docs
- Editable formatting
- File size: Medium

**Features**:
- Headings for structure
- Preserved basic formatting
- Code blocks as monospace text

---

## Printing Conversations

Printing generates the conversation in the format you pick, opens it in a new
tab and calls the browser's print dialog. Markdown is rendered to clean HTML
first; plain-text formats are wrapped in a simple monospace page.

1. **Start the print**
   - Click **Print** in the popup, or right-click → **Print** → format
   - Every format except DOCX can be printed
   - Your browser must allow the extension to open a new tab; if a popup
     blocker stops it, allow popups for the chat site

2. **Adjust print settings**
   - Paper size (Letter, A4, etc.)
   - Margins
   - Color vs. black & white
   - Headers/footers

3. **Print or save as PDF**
   - Send to printer, or
   - "Save as PDF" destination for digital copy

**Tips**:
- For better print quality, use PDF export instead
- Adjust margins if content is cut off
- Use landscape orientation for wide code blocks

---

## Extension Popup

Click the extension icon in your browser toolbar. The popup contains:

### Status Display
- The detected platform (ChatGPT, Claude or Gemini), with its logo
- The conversation title
- The number of Q&A pairs found

If the page is not a supported conversation, the popup says so and lists the
platforms it does support. If you installed or updated the extension while the
page was already open, the popup asks you to reload the page first.

### Actions
- **Format menu** - Markdown, HTML, PDF, Word, Plain Text, JSON
- **Export** - Download the conversation (or just the pairs you selected) in
  that format
- **Print** - Open it in a new tab and raise the print dialog
- **Content row** - Opens the pair chooser, where you pick which Q&A
  exchanges to include instead of the whole conversation; the row itself
  shows "Whole conversation" or "N of M pairs"
- **Options row** - Opens a "Show meta-info" toggle (metadata + timestamps), a
  text-size choice, and a filename builder (see [Defaults](#defaults))
- **Gear icon** (header) - Opens Settings: theme, plus the About links

---

## Keyboard Shortcut

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Export the conversation | `Ctrl+Shift+E` | `Cmd+Shift+E` |

This is the only shortcut the extension registers. It exports immediately in the
format you last used (PDF until you have exported once) — it does not open a
dialog. It only works on a supported platform page.

To change it:
- **Chrome**: `chrome://extensions/shortcuts`
- **Firefox**: `about:addons` → Gear icon → "Manage Extension Shortcuts"

---

## Defaults

These are the out-of-the-box values; the Options row and Content row (see
[Extension Popup](#extension-popup)) let you change the ones marked
"configurable":

| Setting | Default | Configurable? |
|---------|---------|---------------|
| Format used by the keyboard shortcut | The last format you exported; PDF if you never have | No |
| Conversation metadata + timestamps ("Show meta-info") | On | Yes — toggle in Options |
| Text size | Normal | Yes — Compact / Normal / Large in Options |
| Filename | `{title}_{date}`, e.g. `Understanding-Neural-Networks_2026-01-02` | Yes — drag-and-drop builder in Options → File name |
| Q&A pairs exported | All | Yes — pick specific pairs from the Content row |
| Theme | Auto | Yes — Light / Dark / Auto in Settings (gear icon) |

Special characters in the title are sanitized automatically, and the extension
appends the format's own extension. Timestamps only appear where the platform
provides them — today that's Claude only.

---

## What the Extension Does Not Do

- **Buttons inside the chat page.** Use the popup, the right-click menu, or the
  keyboard shortcut.
- **Batch export.** One conversation at a time.

---

## Advanced Usage

### Context Menu Export

Right-click anywhere on a supported platform page:
1. Right-click on the page
2. Hover **Export** (or **Print**)
3. Pick a format from the submenu — the export starts right away

### Batch Exporting

There is no batch export. To export several conversations:
1. Open each conversation in a separate tab
2. Export each one (popup, right-click menu or `Ctrl+Shift+E`)
3. All downloads queue in your browser

### Integrating with Workflows

#### Save to specific folder
Configure browser download settings:
- **Chrome**: `chrome://settings/` → Downloads → Location
- **Firefox**: `about:preferences` → Files and Applications

#### Auto-organize exports
Use browser download management:
- Chrome: Can auto-organize by file type
- Firefox: Can prompt for location per download

#### Import into note-taking apps
- **Obsidian**: Save markdown exports to vault folder
- **Notion**: Import markdown or copy-paste from TXT
- **Roam**: Use JSON for programmatic import
- **OneNote/Evernote**: Use DOCX for best compatibility

---

## Tips & Best Practices

### File Organization
- Use descriptive conversation titles before exporting — the title becomes the
  filename
- Create a dedicated folder for AI conversation exports

### Format Selection
- **Long-term archiving**: Use PDF or Markdown
- **Quick reference**: Use TXT
- **Data analysis**: Use JSON
- **Editing/collaboration**: Use DOCX
- **Documentation**: Use Markdown

### Performance
- Large conversations may take a few seconds to export
- PDF generation is the slowest (it renders and embeds images)
- JSON/TXT are the fastest

### Privacy
- Review content before sharing exported files — by default an export
  contains the whole conversation, unless you used the Content row to limit it
- Exports are saved locally on your device; see [PRIVACY.md](PRIVACY.md)

### Quality
- For code-heavy conversations, use Markdown or JSON
- For sharing with non-technical users, use PDF or DOCX
- For maximum compatibility, use TXT

---

## FAQ

### Can I export multiple conversations at once?
No. You must export each conversation individually. The keyboard shortcut makes this quicker.

### Can I export only part of a conversation?
Yes. Open the popup's Content row and pick which Q&A exchanges to include;
unselected pairs are left out of the export.

### What happens if I close the page during export?
The export process completes almost instantly for most formats. If interrupted, simply retry the export.

### Can I edit the conversation before exporting?
No, the extension exports the conversation as-is from the platform. Use DOCX or Markdown format if you want to edit after export.

### Why is my export file empty?
- Refresh the page and try again
- Check that the conversation has loaded completely
- Verify no browser errors in console (F12)
- Report persistent issues on GitHub

### Can I export conversations from mobile?
Not currently. Browser extensions are typically desktop-only. Mobile support may come in a future version.

### Does this work offline?
The extension works if the conversation page is already loaded. However, you need internet to access the AI chat platforms initially.

### Can I customize the export styling?
Currently, styling is preset for each format. Advanced customization may be added in future versions.

### What's the maximum conversation size?
There is no built-in limit. Long conversations simply take longer to export, and PDF is the slowest format.

### Can I export conversation images?
Yes. **PDF** embeds them in the file. **HTML** and **Markdown** link to them at their original URL, so they load only while you are still signed in to the chat provider. **DOCX** and **TXT** put a `[Image: ...]` placeholder in their place, and **JSON** records the URLs as data.

### Is my data sent to any servers?
Your conversations are never sent to us — the extension has no backend, no analytics and no telemetry, and it sends nothing to any third party.

It does make two kinds of request, both to the chat provider whose page you are already on:

- Exporting from **claude.ai** calls Claude's own API with your existing logged-in session, to fetch artifact content the page does not render in the DOM.
- A **PDF** export downloads the conversation's own images from the provider so it can embed them.

Full detail in [PRIVACY.md](PRIVACY.md).

---

## Getting Help

- **Documentation**: Check [README](README.md) and this guide
- **Installation Issues**: See [Installation Guide](installation.md)
- **Bug Reports / Feature Requests**: [GitHub Issues](https://github.com/nuncaeslupus/ai-chat-exporter/issues)

---

## Next Steps

- Explore different export formats to find your preference
- Rebind the keyboard shortcut if `Ctrl+Shift+E` clashes with something else
- Star the project on GitHub if you find it useful
