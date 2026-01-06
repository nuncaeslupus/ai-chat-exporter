# AI Chat Exporter - Development Plan & Progress

## ✅ Completed (Current Session)

### 1. Fixed Extension Loading Issues
- **Problem**: Content script not communicating with popup ("Connection does not exist" error)
- **Solution**:
  - Added message listener in content script (content-script.ts:133)
  - Created getConversation() method to return parsed data
  - Handles `get_conversation`, `export_conversation`, and `print_conversation` messages

### 2. Fixed Build Configuration
- **Problem**: Content scripts built as ES modules (not supported in Chrome extensions)
- **Solution**:
  - Created separate build config for content scripts (build/vite.content.ts)
  - Builds content scripts in IIFE format
  - Updated package.json with `build:content` script
  - Proper build order: content scripts → background/popup

### 3. Fixed Conversation Parsing
- **Problem**: Parser found 0 pairs because it ran before ChatGPT loaded content
- **Solution**:
  - Made initialize() re-parse on every call (ChatGPT is a SPA)
  - Re-parse when popup opens
  - Re-parse before each export
  - Now correctly finds all 13 conversation pairs

### 4. Fixed Content Cleanup
- **Problem**: Exports included UI artifacts ("Copiar código", copy buttons, etc.)
- **Solution**:
  - Enhanced cleanupElement() in base-parser.ts:186
  - Removes all buttons, SVG icons, screen-reader elements
  - Cleans aria-hidden and empty elements
  - Preserves code blocks while removing UI chrome

### 5. Fixed Title Extraction
- **Problem**: Title showed "ChatGPT Conversation" instead of actual title
- **Solution**:
  - Uses page `<title>` element first (chatgpt/parser.ts:42)
  - Falls back to sidebar selectors if needed
  - Now shows "SiliconFlow API compatibility" correctly

### 6. Implemented Structured Content Architecture ⭐
- **New Approach**: Parse to JSON first, then generate all formats from structured data
- **Created**:
  - `src/core/types/structured-content.ts` - Rich content types (paragraphs, code blocks, headings, lists, etc.)
  - `src/core/services/html-content-parser.ts` - Parses HTML → structured JSON
  - `src/core/services/conversation-structure-service.ts` - Converts Conversation → StructuredConversation

### 7. Improved Markdown Exporter ⭐
- **File**: `src/core/exporters/structured-md-exporter.ts`
- **Improvements**:
  - Clean metadata table instead of bold text
  - `### 👤 User` / `### 🤖 Assistant` headers with emojis
  - Horizontal rules `---` between Q&A pairs
  - Fixed list rendering (content on same line as bullet)
  - Proper heading levels (h1 title, h3 user/assistant, h4+ content)
  - Trimmed empty content
  - Clean code block formatting with language labels

### 8. PDF Exporter V2
- **File**: `src/core/exporters/improved-pdf-exporter.ts`
- **Approach**: jsPDF text rendering (no html2canvas to avoid CORS issues)
- **Features**:
  - Detects and styles code blocks with gray backgrounds
  - Color-coded User (green) / Assistant (gray)
  - Smart pagination
  - Page numbers
  - Monospace fonts for code

### 9. HTML Exporter ⭐
- **File**: `src/core/exporters/html-exporter.ts`
- **Approach**: Standalone HTML with embedded CSS and ChatGPT-like styling
- **Features**:
  - Self-contained with embedded styles
  - ChatGPT-like conversation bubbles
  - Syntax highlighting (highlight.js CDN)
  - Mobile-responsive design
  - Proper rendering of all block types (paragraphs, code, lists, headings, blockquotes, etc.)
  - Support for inline formatting (bold, italic, code, links, strikethrough)

### 10. Updated All Exporters to Use Structured Content ⭐
- **PDF Exporter**: `src/core/exporters/pdf-exporter.ts` (renamed from improved-pdf-exporter.ts)
  - Now uses StructuredConversation
  - Renders all block types properly
  - Support for headings, lists, blockquotes, horizontal rules
  - Nested lists with proper indentation
  - Clean code block rendering with language labels
- **DOCX Exporter**: `src/core/exporters/docx-exporter.ts`
  - Now uses StructuredConversation
  - Rich formatting with docx library
  - Code blocks with shading and borders
  - Lists with proper bullets/numbering
  - Inline formatting (bold, italic, code, links, strikethrough)
  - Headings, blockquotes, horizontal rules
- **Markdown Exporter**: Already uses StructuredConversation
- All exporters now generate consistent, high-quality output from the same structured data

## 🔄 In Progress / Known Issues

### 1. Date Metadata
- Current: Shows export date (conversation creation date not available in DOM)
- Label: "Exported" to be clear it's not conversation date

### 2. HTML Format in UI
- Current: HTML format added but UI needs to be updated to show it in export options
- TODO: Add HTML to format selection dropdown in popup

## 📋 Next Steps (Priority Order)

### High Priority

1. **Add Export Options UI**
   - Checkboxes for what to include (metadata, timestamps, etc.)
   - Format selection with previews
   - Filename template editor
   - Add HTML format to dropdown
   - Currently only shows in popup settings

2. **Implement Selection Service**
   - File exists: `src/core/services/selection-service.ts`
   - Allow users to select specific Q&A pairs to export
   - UI for selecting/deselecting pairs
   - "Select All" / "Select None" buttons

3. **Print Functionality**
   - Currently returns "Print not yet implemented"
   - Should open print dialog with formatted conversation
   - Use HTML export internally

### Medium Priority

4. **Claude.ai and Gemini Parsers**
   - Files exist but return empty pairs: `claude/parser.ts`, `gemini/parser.ts`
   - Need to inspect DOM and create proper selectors
   - Same structured approach as ChatGPT

5. **Image Support**
   - ChatGPT conversations can include images
   - Parse `<img>` tags from HTML
   - Include in exports (base64 embed or download)

6. **LaTeX/Math Support**
   - ChatGPT renders LaTeX equations
   - Detect and preserve in markdown ($$...$$)
   - Render properly in PDF/HTML/DOCX

7. **Export Statistics**
   - Show token count estimate
   - Character/word count
   - Number of code blocks
   - Conversation length metrics

8. **Multilanguage Support**
   - Internationalize UI strings
   - Translate export headers ("User", "Assistant", "Platform", "Model", "Exported", etc.)
   - Support for multiple languages in the popup and export outputs
   - Add language selection in settings

## 🏗️ Architecture

### Current Data Flow
```
ChatGPT DOM
  ↓
ChatGPTParser (parser.ts)
  ↓
Conversation (basic types)
  ↓
ConversationStructureService
  ↓
StructuredConversation (rich types)
  ↓
Exporters (MD, PDF, HTML, DOCX)
  ↓
Download
```

### Key Files

**Content Scripts**:
- `src/extension/content/content-script.ts` - Main content script entry
- Initializes parsers, handles messages, triggers exports

**Parsers**:
- `src/core/parsers/base-parser.ts` - Base parser class
- `src/core/parsers/chatgpt/parser.ts` - ChatGPT-specific parser
- `src/core/parsers/chatgpt/selectors.ts` - DOM selectors

**Services**:
- `src/core/services/html-content-parser.ts` - HTML → structured JSON
- `src/core/services/conversation-structure-service.ts` - Conversation → StructuredConversation
- `src/core/services/filename-service.ts` - Filename generation with templates

**Exporters**:
- `src/core/exporters/structured-md-exporter.ts` - ✅ Markdown (uses structured)
- `src/core/exporters/pdf-exporter.ts` - ✅ PDF (uses structured)
- `src/core/exporters/docx-exporter.ts` - ✅ DOCX (uses structured)
- `src/core/exporters/html-exporter.ts` - ✅ HTML (uses structured)
- `src/core/exporters/txt-exporter.ts` - Plain text exporter
- `src/core/exporters/json-exporter.ts` - JSON exporter

**Types**:
- `src/core/types/conversation.ts` - Basic types
- `src/core/types/structured-content.ts` - Rich content types
- `src/core/types/exporter.ts` - Export options, formats

**Build**:
- `build/vite.content.ts` - Content script build (IIFE format)
- `build/vite.chrome.ts` - Background/popup build (ES modules)
- `build/vite.firefox.ts` - Firefox-specific build

## 🐛 Known Bugs

None critical - extension is functional!

## 🎯 Quality Goals

- ✅ Clean markdown without UI artifacts
- ✅ Proper code block detection and formatting
- ✅ Correct title extraction
- ✅ Fixed list formatting
- ✅ Professional PDF output (uses structured content)
- ✅ Beautiful HTML export (ChatGPT-like styling with syntax highlighting)
- ✅ Properly formatted DOCX (rich formatting with all block types)

## 📝 Testing Checklist

Before each release:
- [ ] Test on ChatGPT conversation with code blocks
- [ ] Test on conversation with lists (ordered and unordered)
- [ ] Test on conversation with headings and formatting
- [ ] Test all export formats (MD, PDF, JSON, TXT, DOCX)
- [ ] Test on long conversations (pagination)
- [ ] Verify metadata is correct
- [ ] Check filename generation
- [ ] Test popup UI
- [ ] Reload extension and verify no errors

## 🚀 Future Enhancements

- Export to Notion
- Export to Obsidian vault
- Cloud sync of conversations
- Search within exported conversations
- Batch export multiple conversations
- Auto-export on conversation end
- Export templates/themes
- API for programmatic export
