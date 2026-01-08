# Release Notes - v1.1.0

## 🎉 AI Chat Exporter v1.1.0

**Release Date:** January 8, 2026

### 🚀 New Features

#### Enhanced ChatGPT Support

**Code Artifacts Extraction**
- Automatically extracts all code blocks from ChatGPT responses
- Preserves language information (JavaScript, Python, React, CSS, SVG, etc.)
- Proper syntax highlighting in all export formats
- SVG artifacts rendered with visual preview in Markdown
- Collapsible code sections in HTML exports

**Web Search Citations**
- Extracts and preserves all web search results from ChatGPT
- Includes clickable links to sources
- Shows domain names for each citation
- Displays favicons for visual reference (HTML/PDF)
- Groups citations by search query
- Shows result counts

**Improved Export Quality**
- Consistent image sizing across all formats (200px max width)
- Better thumbnail handling for user-uploaded images
- Improved PDF layout for code blocks and citations
- Enhanced HTML styling for citations with hover effects
- Optimized Markdown output for better readability

### 🔧 Technical Improvements

**Parser Enhancements**
- Added `extractArtifacts()` method to ChatGPT parser
- Added `extractWebSearches()` method to ChatGPT parser
- Updated selectors with proper CSS escaping for special characters
- Improved DOM element detection and extraction

**Exporter Updates**
- Updated Markdown exporter with citation rendering
- Enhanced HTML exporter with styled citation cards
- Improved PDF exporter with formatted citation lists
- Better handling of code blocks in all formats

**Testing**
- Added 4 comprehensive test fixtures for ChatGPT features
- 18 new unit tests for artifact and citation extraction
- All 58 tests passing
- Improved test coverage for ChatGPT parser

### 📦 Build Information

**Package Sizes:**
- Chrome: 717 KB (691 KB gzipped for content script)
- Firefox: 717 KB (691 KB gzipped for content script)
- Source: 332 KB

**Version Numbers:**
- Extension version: 1.1.0
- Package version: 1.1.0
- Manifest version: 3

### 🐛 Bug Fixes

- Fixed: HTML exporter now uses consistent image sizing (200px max) matching PDF and Markdown
- Fixed: Proper escaping of CSS class names with `!` character in selectors
- Fixed: Image sizing consistency across all export formats

### 📝 Documentation

- Created updated Chrome Web Store listing
- Created updated Firefox Add-ons listing
- Updated version history in store descriptions
- Added v1.1.0 release notes

### 🔄 Migration Notes

**From v1.0.0 to v1.1.0:**
- No breaking changes
- All existing functionality preserved
- New features automatically available
- No configuration changes required
- Existing exports remain compatible

### 🎯 What's Included

**Export Formats:**
- PDF (with code artifacts and citations)
- Markdown (with collapsible SVG code)
- HTML (with interactive citations)
- DOCX (with formatted code blocks)
- JSON (with full metadata)
- TXT (plain text)

**Supported Platforms:**
- ChatGPT (chat.openai.com, chatgpt.com) ✨ **Enhanced**
- Claude (claude.ai)
- Gemini (gemini.google.com)

**Languages:**
- English, Spanish, French, German, Italian, Portuguese, Catalan

### 🔒 Privacy & Security

- No changes to privacy policy
- All processing remains 100% local
- No data collection or tracking
- No external server communication
- Open source and transparent

### 📥 Installation

**Chrome Web Store:**
```
ai-chat-exporter-chrome-v1.1.0.zip
```

**Firefox Add-ons:**
```
ai-chat-exporter-firefox-v1.1.0.zip
```

**Source Code:**
```
ai-chat-exporter-source-v1.1.0.zip
```

### 🙏 Acknowledgments

Special thanks to all users who provided feedback and suggestions. This release focuses on enhancing the ChatGPT experience based on user requests.

### 🐛 Known Issues

None reported for v1.1.0.

### 📅 Future Plans

**v1.2.0 (Planned):**
- Table extraction for ChatGPT
- Shopping widget support
- Additional structured content handling
- Further export format enhancements

### 🔗 Links

- **GitHub Repository:** https://github.com/ivansaul/ai-chat-exporter
- **Issue Tracker:** https://github.com/ivansaul/ai-chat-exporter/issues
- **Documentation:** https://github.com/ivansaul/ai-chat-exporter/tree/main/docs
- **Privacy Policy:** https://github.com/ivansaul/ai-chat-exporter/blob/main/docs/PRIVACY.md

### 💬 Feedback

We'd love to hear from you! Please share your feedback:
- Report bugs on GitHub Issues
- Request features via GitHub Issues
- Star the repository if you find it useful
- Share with others who might benefit

---

**Full Changelog:** https://github.com/ivansaul/ai-chat-exporter/compare/v1.0.0...v1.1.0
