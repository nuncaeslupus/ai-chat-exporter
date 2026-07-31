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
- ✅ ChatGPT, Claude and Gemini parsers (images, canvas, deep research,
  artifacts, thinking panels)
- ✅ Content script and message passing
- ✅ Structured content architecture (HTML → JSON → Exporters)
- ✅ All exporters using structured content (MD, PDF, DOCX, HTML, TXT, JSON)
- ✅ Clean export output without UI artifacts
- ✅ Context menu integration
- ✅ Q&A pair selection, export options (metadata/timestamp toggle, text
  size), and a filename builder in the popup
- ✅ Multi-language support (7 languages)

## Architecture

```
Platform DOM → <Platform>Parser → Conversation
  → ConversationStructureService → StructuredConversation
  → Exporters (MD, PDF, HTML, DOCX, TXT, JSON) → Download
```

### Key Files
- **Parsers**: `src/core/parsers/{chatgpt,claude,gemini}/parser.ts`
- **Services**: `src/core/services/{html-content-parser,conversation-structure-service,filename-service,selection-service,claude-api-service}.ts`
- **Exporters**: `src/core/exporters/{structured-md,pdf,docx,html,txt,json}-exporter.ts`
- **Types**: `src/core/types/{conversation,structured-content,exporter}.ts`

## Next Steps

The live backlog is tracked in GitHub issues and the `claude-arsenal/` queue,
not here.

### Medium Priority
1. **Export Statistics** - Token count, character count

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
