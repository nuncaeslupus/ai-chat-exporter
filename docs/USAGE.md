# Usage Guide

Complete guide to using the AI Chat Exporter extension.

## Table of Contents

- [Getting Started](#getting-started)
- [Exporting Conversations](#exporting-conversations)
  - [Quick Export](#quick-export)
  - [Selective Export](#selective-export)
  - [Export Formats](#export-formats)
- [Printing Conversations](#printing-conversations)
- [Extension Popup](#extension-popup)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Settings & Preferences](#settings--preferences)
- [Advanced Usage](#advanced-usage)
- [Tips & Best Practices](#tips--best-practices)
- [FAQ](#faq)

---

## Getting Started

After installing the extension (see [Installation Guide](INSTALLATION.md)):

1. Navigate to a supported AI chat platform:
   - ChatGPT: https://chat.openai.com
   - Claude: https://claude.ai (coming soon)
   - Gemini: https://gemini.google.com (coming soon)

2. Open or start a conversation

3. Look for the export buttons that appear in the conversation interface

---

## Exporting Conversations

### Quick Export

The fastest way to export the entire conversation:

1. **Locate the export button**
   - Appears in the conversation header area
   - Look for a download icon or "Export" button

2. **Click the export button**
   - A dropdown menu appears with format options

3. **Select your format**
   - Choose from: PDF, Markdown, TXT, JSON, or DOCX
   - See [Export Formats](#export-formats) for details

4. **Download**
   - Your browser will download the file automatically
   - Default filename: `{conversation-title}_{date}.{ext}`

### Selective Export

Export only specific Q&A pairs from a conversation:

1. **Open the selection panel**
   - Click "Select Q&A Pairs" button
   - The selection panel appears showing all Q&A pairs

2. **Choose pairs to export**
   - Each Q&A pair has a checkbox
   - Check the pairs you want to include
   - Use "Select All" / "Deselect All" for quick selection

3. **Export selected**
   - Click "Export Selected" button
   - Choose your format
   - Only selected pairs will be included

4. **Close the selection panel**
   - Click the "X" or click outside the panel

**Use cases**:
- Extract specific parts of a long conversation
- Remove sensitive or irrelevant Q&A pairs
- Create focused documentation from broader discussions

### Export Formats

#### PDF
**Best for**: Sharing, archiving, printing

- Professional document layout
- Preserves formatting and code blocks
- Includes metadata header (optional)
- Page numbers and conversation info
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
- Includes all metadata
- Easy to parse with code
- Contains timestamps and roles
- File size: Medium

**Structure**:
```json
{
  "id": "conv_123",
  "title": "Understanding Neural Networks",
  "platform": "chatgpt",
  "model": "gpt-4",
  "url": "https://chat.openai.com/c/...",
  "exportedAt": "2026-01-02T10:30:00Z",
  "pairs": [
    {
      "index": 0,
      "question": {
        "role": "user",
        "content": "What is a neural network?",
        "timestamp": "2026-01-02T10:00:00Z"
      },
      "answer": {
        "role": "assistant",
        "content": "A neural network is..."
      }
    }
  ]
}
```

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

Print directly from the browser with optimized formatting:

1. **Click the print button**
   - Located near the export button
   - Opens browser print dialog

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

Click the extension icon in your browser toolbar to access:

### Status Display
- Shows current platform (ChatGPT, Claude, etc.)
- Displays conversation title
- Shows Q&A pair count

### Quick Actions
- **Export Current** - Quick export with default format
- **Select & Export** - Open selection panel
- **Print** - Quick print action

### Settings Access
- Click gear icon for preferences
- Adjust default format
- Configure filename template
- Toggle metadata inclusion

---

## Keyboard Shortcuts

Speed up your workflow with keyboard shortcuts:

| Action | Windows/Linux | Mac |
|--------|---------------|-----|
| Quick Export | `Ctrl+Shift+E` | `Cmd+Shift+E` |
| Open Selection Panel | `Ctrl+Shift+S` | `Cmd+Shift+S` |
| Print | `Ctrl+Shift+P` | `Cmd+Shift+P` |

**Note**: Shortcuts only work when on a supported platform page.

To customize shortcuts:
- **Chrome**: `chrome://extensions/shortcuts`
- **Firefox**: `about:addons` → Gear icon → "Manage Extension Shortcuts"

---

## Settings & Preferences

### Accessing Settings

1. Click the extension icon
2. Click the gear/settings icon
3. Adjust preferences

### Available Settings

#### Default Export Format
Choose your preferred export format:
- PDF (default)
- Markdown
- Plain Text
- JSON
- DOCX

**Effect**: When you click "Quick Export", this format is used automatically.

#### Include Metadata
Toggle whether exports include conversation metadata:
- Title
- Date
- Platform
- Model (if available)
- URL

**Recommendation**: Keep enabled for better organization.

#### Filename Template
Customize how exported files are named.

**Available variables**:
- `{title}` - Conversation title
- `{date}` - Export date (YYYY-MM-DD)
- `{time}` - Export time (HH-MM-SS)
- `{platform}` - Platform name (chatgpt, claude, etc.)
- `{model}` - AI model (if available)

**Default**: `{title}_{date}`

**Examples**:
- `{platform}_{title}_{date}` → `chatgpt_Understanding-Neural-Networks_2026-01-02`
- `{date}_{time}_{title}` → `2026-01-02_10-30-45_Understanding-Neural-Networks`
- `{title}` → `Understanding-Neural-Networks`

**Note**: Special characters are automatically sanitized.

---

## Advanced Usage

### Context Menu Export

Right-click anywhere on a supported platform page:
1. Right-click on the page
2. Select "AI Chat Exporter" from context menu
3. Choose export action

### Batch Exporting

To export multiple conversations:
1. Open each conversation in a separate tab
2. Use quick export or keyboard shortcut on each
3. All downloads will queue in your browser

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
- Use descriptive conversation titles before exporting
- Include date in filename template for chronological sorting
- Create a dedicated folder for AI conversation exports

### Format Selection
- **Long-term archiving**: Use PDF or Markdown
- **Quick reference**: Use TXT
- **Data analysis**: Use JSON
- **Editing/collaboration**: Use DOCX
- **Documentation**: Use Markdown

### Performance
- Large conversations (100+ Q&A pairs) may take a few seconds to export
- PDF generation is slowest (due to rendering)
- JSON/TXT are fastest
- For very long conversations, consider selective export

### Privacy
- Review content before sharing exported files
- Use selective export to exclude sensitive information
- Remember that exports are saved locally on your device

### Quality
- For code-heavy conversations, use Markdown or JSON
- For sharing with non-technical users, use PDF or DOCX
- For maximum compatibility, use TXT

---

## FAQ

### Can I export multiple conversations at once?
Not currently. You must export each conversation individually. Use keyboard shortcuts or quick export for faster workflow.

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
Tested with conversations up to 200 Q&A pairs. Larger conversations should work but may take longer to export.

### Can I export conversation images?
Currently, only text content is exported. Image support is planned for future versions.

### Is my data sent to any servers?
No. All processing happens locally in your browser. The extension does not send any data externally.

---

## Getting Help

- **Documentation**: Check [README](README.md) and this guide
- **Installation Issues**: See [Installation Guide](INSTALLATION.md)
- **Bug Reports**: [GitHub Issues](https://github.com/nuncaeslupus/ai-chat-exporter/issues)
- **Feature Requests**: [GitHub Discussions](https://github.com/nuncaeslupus/ai-chat-exporter/discussions)

---

## Next Steps

- Explore different export formats to find your preference
- Set up keyboard shortcuts for your workflow
- Configure default settings in the extension popup
- Star the project on GitHub if you find it useful
