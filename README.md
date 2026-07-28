# AI Chat Exporter

A powerful browser extension to export your AI chatbot conversations from ChatGPT, Claude, and Gemini to multiple formats.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)

## Features

- 🚀 **Multi-Platform Support**: Export conversations from ChatGPT, Claude (coming soon), and Gemini (coming soon)
- 📄 **Multiple Export Formats**:
  - **Markdown** (.md) - Clean, readable format with proper formatting
  - **PDF** (.pdf) - Professional documents with syntax highlighting
  - **HTML** (.html) - Standalone HTML with ChatGPT-like styling
  - **Word Document** (.docx) - Rich formatted documents
  - **Plain Text** (.txt) - Simple text format
  - **JSON** (.json) - Structured data for programmatic use
- 🎨 **Rich Content Support**:
  - Code blocks with syntax highlighting
  - Images (user uploads and AI-generated)
  - Canvas/document content
  - Deep research results with metadata
  - Lists, headings, blockquotes
  - Inline formatting (bold, italic, code, links)
- 🔧 **Smart Parsing**:
  - Preserves conversation structure
  - Removes UI artifacts (buttons, icons)
  - Maintains code formatting
  - Handles special ChatGPT features (canvas, research mode)
- 🌍 **Multilingual**: Interface and exports support multiple languages

## Installation

### From Chrome Web Store (Coming Soon)
Visit the [Chrome Web Store](#) and click "Add to Chrome"

### From Firefox Add-ons (Coming Soon)
Visit [Firefox Add-ons](#) and click "Add to Firefox"

### Manual Installation (Development)

#### Chrome/Edge
1. Download or clone this repository
2. Run `pnpm install` to install dependencies
3. Run `pnpm build:chrome` to build the extension
4. Open Chrome and go to `chrome://extensions/`
5. Enable "Developer mode"
6. Click "Load unpacked" and select the `dist/chrome` folder

#### Firefox
1. Download or clone this repository
2. Run `pnpm install` to install dependencies
3. Run `pnpm build:firefox` to build the extension
4. Open Firefox and go to `about:debugging#/runtime/this-firefox`
5. Click "Load Temporary Add-on"
6. Select the `manifest.json` file in the `dist/firefox` folder

## Usage

1. Navigate to a conversation on ChatGPT, Claude, or Gemini
2. Click the extension icon in your browser toolbar
3. Choose your preferred export format
4. Click "Export" to download the conversation

### Keyboard Shortcuts (Coming Soon)
- `Ctrl+Shift+E` - Open export menu
- `Ctrl+Shift+P` - Print conversation

## Supported Platforms

### ChatGPT ✅
- Full support for all message types
- Image extraction (uploaded and generated)
- Canvas/document content
- Deep research mode with metadata
- Code blocks with syntax highlighting
- All conversation features

### Claude (Coming Soon)
- Basic conversation export
- Feature parity with ChatGPT planned

### Gemini (Coming Soon)
- Basic conversation export
- Feature parity with ChatGPT planned

## Development

### Prerequisites
- Node.js >= 18.0.0
- pnpm (package manager)

### Setup
```bash
# Install dependencies
pnpm install

# Run development build with watch mode
pnpm dev:chrome  # For Chrome
pnpm dev:firefox # For Firefox

# Run tests
pnpm test

# Type checking
pnpm typecheck

# Linting
pnpm lint
pnpm lint:fix

# Format code
pnpm format
```

### Project Structure
```
ai-chat-exporter/
├── src/
│   ├── core/
│   │   ├── parsers/      # Platform-specific parsers
│   │   │   ├── chatgpt/  # ChatGPT parser (fully implemented)
│   │   │   ├── claude/   # Claude parser (placeholder)
│   │   │   └── gemini/   # Gemini parser (placeholder)
│   │   ├── exporters/    # Export format handlers
│   │   │   ├── md-exporter.ts
│   │   │   ├── pdf-exporter.ts
│   │   │   ├── html-exporter.ts
│   │   │   ├── docx-exporter.ts
│   │   │   ├── txt-exporter.ts
│   │   │   └── json-exporter.ts
│   │   ├── services/     # Core services
│   │   └── types/        # TypeScript types
│   ├── extension/        # Extension-specific code
│   │   ├── background/   # Service worker
│   │   ├── content/      # Content scripts
│   │   └── popup/        # Extension popup
│   └── ui/               # UI components
├── tests/                # Test files
├── build/                # Build configuration
└── manifests/            # Extension manifests
```

### Architecture

The extension uses a clean architecture with structured content:

1. **Parsers** - Extract conversations from platform DOM
2. **Structure Service** - Convert HTML to structured JSON (paragraphs, code blocks, headings, etc.)
3. **Exporters** - Generate files from structured content
4. **Content Scripts** - Inject into web pages and handle parsing
5. **Background Service** - Manage extension lifecycle
6. **Popup UI** - User interface for export options

See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for detailed progress and architecture.

### Adding a New Parser

To add support for a new AI platform:

1. Create a new folder in `src/core/parsers/[platform]/`
2. Create `parser.ts` extending `BaseParser`
3. Create `selectors.ts` with DOM selectors
4. Implement required methods:
   - `canParse()` - Check if URL matches platform
   - `getTitle()` - Extract conversation title
   - `getModel()` - Extract model name
   - `extractQAPairs()` - Parse messages into Q&A pairs
5. Register parser in `src/core/parsers/index.ts`

### Adding a New Export Format

1. Create a new exporter in `src/core/exporters/[format]-exporter.ts`
2. Extend `BaseExporter`
3. Implement `export()` method
4. Register in `src/core/exporters/index.ts`

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Guidelines
- Follow the existing code style
- Add tests for new features
- Update documentation as needed
- Ensure all tests pass (`pnpm test`)
- Run type checking (`pnpm typecheck`)

## Roadmap

### Current Focus
- [ ] Complete Claude.ai parser
- [ ] Complete Gemini parser
- [ ] Chrome Web Store submission
- [ ] Firefox Add-ons submission

### Planned Features
- [ ] Conversation selection (export specific messages)
- [ ] Export options UI (metadata, timestamps, etc.)
- [ ] LaTeX/Math equation support
- [ ] Export templates/themes
- [ ] Batch export multiple conversations
- [ ] Auto-export on conversation end
- [ ] Cloud sync (optional)
- [ ] Search within exported conversations
- [ ] Export to Notion/Obsidian

See [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for detailed roadmap.

## Privacy & Security

- **No Data Collection**: The extension has no backend. It never sends your conversations anywhere, and we never see, store, or receive them
- **Local Processing**: Reading the page, formatting the export, and generating the output file all happen locally in your browser
- **No Analytics**: No usage tracking, no telemetry, no third-party SDKs
- **No Third-Party Requests**: The only network requests are to the chat provider whose page you are already on — `claude.ai`'s own API (using your existing session) for message content the DOM doesn't render, and, for PDF exports, the conversation's images so they can be embedded in the file
- **Open Source**: Full source code available for review

Exported HTML and Markdown reference conversation images by their original URL
rather than embedding them, so opening one asks the provider for those images.
Everything else in an exported file is inlined — no external stylesheet, script,
web font, or tracking pixel. Full details in [docs/PRIVACY.md](./docs/PRIVACY.md).

## Technical Details

### Built With
- TypeScript 5.8
- Vite (build tool)
- Vitest (testing)
- jsPDF (PDF generation)
- docx (Word document generation)
- marked (Markdown parsing)

### Browser Compatibility
- Chrome/Edge: Version 88+
- Firefox: Version 109+

### Permissions
The extension requires:
- `activeTab` - To access the current conversation
- `storage` - To save user preferences
- Host permissions for `chat.openai.com`, `chatgpt.com`, `claude.ai`, `gemini.google.com`

## License

MIT License - see [LICENSE](./LICENSE) file for details

## Support

- 🐛 [Report a Bug](https://github.com/nuncaeslupus/ai-chat-exporter/issues)
- 💡 [Request a Feature](https://github.com/nuncaeslupus/ai-chat-exporter/issues)
- 📧 [Contact](mailto:your.email@example.com)

## Acknowledgments

- Inspired by the need to preserve AI conversations
- Built with modern web technologies
- Thanks to the open-source community

---

**Note**: This extension is not affiliated with or endorsed by OpenAI, Anthropic, or Google.
