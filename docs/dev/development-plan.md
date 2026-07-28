---
name: development-plan
description: Development roadmap and progress tracking
metadata:
  category: development
  audience: developers
---

# Development Plan & Progress

## Current Status

Extension is fully functional with:
- ✅ ChatGPT parser (images, canvas, deep research support)
- ✅ Content script and message passing
- ✅ Structured content architecture (HTML → JSON → Exporters)
- ✅ All exporters using structured content (MD, PDF, DOCX, HTML, TXT, JSON)
- ✅ Clean export output without UI artifacts
- ✅ Context menu integration
- ✅ Multi-language support (8 languages)

## Architecture

```
ChatGPT DOM → ChatGPTParser → Conversation
  → ConversationStructureService → StructuredConversation
  → Exporters (MD, PDF, HTML, DOCX, TXT, JSON) → Download
```

### Key Files
- **Parsers**: `src/core/parsers/chatgpt/parser.ts`
- **Services**: `src/core/services/{html-content-parser,conversation-structure-service,filename-service}.ts`
- **Exporters**: `src/core/exporters/{structured-md,pdf,docx,html,txt,json}-exporter.ts`
- **Types**: `src/core/types/{conversation,structured-content,exporter}.ts`

## Next Steps

### High Priority
1. **Export Options UI** - Checkboxes for metadata, timestamps, etc.
2. **Selection Service** - UI for selecting specific Q&A pairs

### Medium Priority
3. **Image Support** - Parse and embed images in exports
4. **LaTeX/Math Support** - Preserve equations
5. **Export Statistics** - Token count, character count
6. **Multilanguage** - Translate export headers

## Quality Goals

- ✅ Clean markdown without UI artifacts
- ✅ Proper code block formatting
- ✅ Correct title extraction
- ✅ Professional PDF output
- ✅ Beautiful HTML export
- ✅ Properly formatted DOCX

## Pre-Release Checklist

- [ ] Test all export formats
- [ ] Test on conversations with code blocks, lists, headings
- [ ] Verify metadata correctness
- [ ] Check filename generation
- [ ] Reload extension and verify no errors

See [releasing.md](releasing.md) for release process.
