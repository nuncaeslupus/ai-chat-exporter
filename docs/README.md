# AI Chat Exporter

Export your AI chatbot conversations to multiple formats with ease.

## Overview

AI Chat Exporter is a browser extension that allows you to export conversations from popular AI chatbots (ChatGPT, Claude, Gemini) to various file formats including PDF, Markdown, TXT, JSON, and DOCX.

## Features

- **Multi-Platform Support**: Works with ChatGPT, Claude, and Gemini
- **Multiple Export Formats**:
  - PDF - Professional document format with preserved formatting
  - Markdown - Plain text with formatting for easy editing
  - TXT - Simple plain text format
  - JSON - Structured data format for programmatic use
  - DOCX - Microsoft Word format
- **Selective Export**: Choose which Q&A pairs to include in your export
- **Print Support**: Print conversations directly from your browser
- **Smart Filenames**: Automatic filename generation based on conversation title and date
- **Browser Support**: Chrome and Firefox

## Quick Start

1. Install the extension (see [Installation Guide](INSTALLATION.md))
2. Navigate to any supported AI chat platform
3. Click the export button in the conversation header
4. Select your preferred format
5. Download your conversation

## Supported Platforms

| Platform | Status | URL Pattern |
|----------|--------|-------------|
| ChatGPT  | ✅ Full Support | chat.openai.com |
| Claude   | 🚧 Coming Soon | claude.ai |
| Gemini   | 🚧 Coming Soon | gemini.google.com |

## Export Formats

### PDF
Professional document format with:
- Preserved text formatting and code blocks
- Clean, readable layout
- Page numbers and metadata

### Markdown
Plain text with formatting:
- Compatible with most text editors
- Preserves code blocks with syntax highlighting markers
- Easy to edit and version control

### Plain Text
Simple, universal format:
- No formatting, pure text content
- Maximum compatibility
- Smallest file size

### JSON
Structured data format:
- Complete conversation data including metadata
- Programmatic access to messages
- Timestamps and role information

### DOCX
Microsoft Word format:
- Editable document format
- Compatible with Word and LibreOffice
- Preserves basic formatting

## Usage

For detailed usage instructions, see the [Usage Guide](USAGE.md).

### Basic Export
1. Open a conversation on a supported platform
2. Click the export button (appears in the conversation header)
3. Select your desired format from the dropdown
4. Click "Export" to download

### Selective Export
1. Click the "Select Q&A Pairs" button
2. Check/uncheck individual question-answer pairs
3. Click "Export Selected"
4. Choose your format and download

### Print
1. Click the print button in the conversation header
2. Adjust print settings in the browser dialog
3. Print or save as PDF

## Settings

Access extension settings by:
- Clicking the extension icon in your browser toolbar
- Right-clicking on the page and selecting "Export Conversation"
- Using the keyboard shortcut: `Ctrl+Shift+E` (Windows/Linux) or `Cmd+Shift+E` (Mac)

### Available Options
- **Default Export Format**: Set your preferred export format
- **Include Metadata**: Add conversation metadata (date, platform, model) to exports
- **Filename Template**: Customize how exported files are named

## Privacy

- **No Data Collection**: This extension does not collect or transmit any of your conversation data
- **Local Processing**: All exports are processed locally in your browser
- **No External Servers**: No data is sent to external servers
- **Open Source**: Source code is available for review

## Troubleshooting

### Export button not appearing
- Refresh the page
- Check that you're on a supported platform
- Ensure the extension is enabled in your browser

### Export fails or produces empty file
- Try refreshing the page and exporting again
- Check browser console for errors (F12 → Console)
- Report issues on GitHub

### Print formatting issues
- Use the PDF export instead for better control
- Adjust print settings in browser dialog
- Try a different browser

## Support

- **Documentation**: See [Usage Guide](USAGE.md) and [Installation Guide](INSTALLATION.md)
- **Issues**: Report bugs or request features on [GitHub Issues](https://github.com/nuncaeslupus/ai-chat-exporter/issues)
- **Contributions**: See developer documentation in `.dev/docs/`

## License

MIT License - see LICENSE file for details

## Contributing

We welcome contributions! See `.dev/docs/ADDING_PARSERS.md` for information on adding support for new AI platforms.

For development setup and architecture information, see:
- [Architecture Guide](.dev/docs/ARCHITECTURE.md)
- [Testing Guide](.dev/docs/TESTING_GUIDE.md)
- [Adding Parsers](.dev/docs/ADDING_PARSERS.md)
