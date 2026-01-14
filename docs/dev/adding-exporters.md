---
name: adding-exporters
description: Guide for implementing exporters for new file formats
metadata:
  category: development
  audience: developers
---

# Adding New Exporters

Guide for implementing exporters for new file formats.

## Overview

An exporter converts normalized `StructuredConversation` data into a specific file format.

**Required components:**
1. Exporter class extending `BaseExporter`
2. Rendering logic for structured content
3. Unit tests
4. Dependencies (if needed)

**Reference files:**
- `src/core/types/structured-content.ts` - Content data model
- `src/core/exporters/base-exporter.ts` - Base class
- `src/core/exporters/txt-exporter.ts` - Simple example
- `src/core/exporters/pdf-exporter.ts` - Complex example

---

## Implementation Steps

### 1. Create Files

```bash
touch src/core/exporters/format-exporter.ts
touch tests/unit/core/exporters/format.test.ts
```

### 2. Implement Basic Exporter

```typescript
// src/core/exporters/format-exporter.ts
import type { ExportOptions, ExportFormat } from '../types/exporter';
import type { StructuredConversation } from '../types/structured-content';
import { BaseExporter } from './base-exporter';

export class FormatExporter extends BaseExporter {
  protected formatName: ExportFormat = 'format';
  protected mimeType = 'application/format';
  protected fileExtension = '.fmt';

  async export(
    conversation: StructuredConversation,
    options?: ExportOptions
  ): Promise<Blob> {
    this.validateConversation(conversation);
    const content = this.generateContent(conversation, options);
    return new Blob([content], { type: this.mimeType });
  }

  private generateContent(
    conversation: StructuredConversation,
    options?: ExportOptions
  ): string {
    let output = '';

    if (options?.includeMetadata !== false) {
      output += this.generateMetadata(conversation);
    }

    for (const pair of conversation.pairs) {
      if (!pair.selected) continue;
      output += this.renderMessage(pair.question);
      output += this.renderMessage(pair.answer);
    }

    return output;
  }
}
```

### 3. Add Structured Content Support

```typescript
private renderMessage(message: StructuredMessage): string {
  if (!message.structuredContent) return message.content;

  return message.structuredContent.map(block => this.renderBlock(block)).join('');
}

private renderBlock(block: StructuredContentBlock): string {
  switch (block.type) {
    case 'paragraph': return this.renderParagraph(block);
    case 'heading': return this.renderHeading(block);
    case 'code': return this.renderCodeBlock(block);
    case 'list': return this.renderList(block);
    case 'blockquote': return this.renderBlockquote(block);
    case 'table': return this.renderTable(block);
    case 'horizontal_rule': return this.renderHorizontalRule();
    default: return '';
  }
}

private renderInlineContent(content: InlineContent[]): string {
  return content.map(item => {
    switch (item.type) {
      case 'text': return item.content;
      case 'bold': return `**${item.content}**`;
      case 'italic': return `*${item.content}*`;
      case 'code': return `\`${item.content}\``;
      case 'link': return `[${item.content}](${item.url})`;
      case 'strikethrough': return `~~${item.content}~~`;
      default: return item.content || '';
    }
  }).join('');
}
```

### 4. Write Tests

```typescript
// tests/unit/core/exporters/format.test.ts
import { describe, it, expect } from 'vitest';
import { FormatExporter } from '../../../../src/core/exporters/format-exporter';

describe('FormatExporter', () => {
  const exporter = new FormatExporter();

  it('should export simple conversation', async () => {
    const conversation = {
      id: 'test-1',
      title: 'Test',
      platform: 'chatgpt',
      pairs: [{
        id: 'pair-1',
        index: 0,
        selected: true,
        question: { id: 'q1', role: 'user', content: 'Hello' },
        answer: { id: 'a1', role: 'assistant', content: 'Hi!' }
      }]
    };

    const blob = await exporter.export(conversation);
    expect(blob.type).toBe('application/format');
    const text = await blob.text();
    expect(text).toContain('Hello');
  });
});
```

Test scenarios: simple conversation, code blocks, tables, selection filtering, edge cases.

### 5. Register Exporter

```typescript
// src/core/exporters/index.ts
import { FormatExporter } from './format-exporter.js';

export const EXPORTERS: Record<ExportFormat, typeof BaseExporter> = {
  // ... existing exporters
  format: FormatExporter,
};

// src/core/types/exporter.ts
export type ExportFormat = 'pdf' | 'md' | 'html' | 'docx' | 'txt' | 'json' | 'format';
```

### 6. Add to UI

```html
<!-- src/extension/popup/popup.html -->
<option value="format" data-i18n="formatFormat">Format Name</option>
```

```json
// _locales/en/messages.json
{
  "formatFormat": {
    "message": "Format Name",
    "description": "Export format description"
  }
}
```

### 7. Test

```bash
pnpm test -- format     # Unit tests
pnpm build:chrome       # Build extension
# Manual test in browser
```

---

## BaseExporter API

**Inherited methods:**
```typescript
protected validateConversation(conversation: StructuredConversation): void
protected getMetadata(conversation: StructuredConversation): ConversationMetadata
protected getSelectedPairs(conversation: StructuredConversation): QAPair[]
```

**Must implement:**
```typescript
abstract export(conversation: StructuredConversation, options?: ExportOptions): Promise<Blob>
```

---

## Content Types

**Structured blocks:**
- `ParagraphBlock` - Text paragraphs with inline formatting
- `HeadingBlock` - Headers (levels 1-6)
- `CodeBlock` - Code with syntax highlighting
- `ListBlock` - Ordered/unordered lists
- `BlockquoteBlock` - Quoted text
- `TableBlock` - Tables with headers
- `HorizontalRuleBlock` - Horizontal dividers
- `ImageBlock` - Images

**Inline content:**
- `TextContent` - Plain text
- `BoldContent` - Bold text
- `ItalicContent` - Italic text
- `CodeContent` - Inline code
- `LinkContent` - Hyperlinks
- `StrikethroughContent` - Strikethrough text

**Export options:**
```typescript
interface ExportOptions {
  includeMetadata?: boolean;    // Include title, platform, date
  preserveHtml?: boolean;        // Preserve HTML formatting
  selectedOnly?: boolean;        // Export selected pairs only
}
```

---

## Best Practices

**Error handling:**
```typescript
async export(conversation: StructuredConversation): Promise<Blob> {
  try {
    this.validateConversation(conversation);
    if (conversation.pairs.length === 0) {
      throw new Error('No conversation pairs to export');
    }
    // ... export logic
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Export failed: ${message}`);
  }
}
```

**Performance for large conversations:**
```typescript
// Good: Stream content
private async generateContent(conversation: StructuredConversation): Promise<Blob> {
  const chunks: BlobPart[] = [];
  for (const pair of conversation.pairs) {
    chunks.push(this.renderPair(pair));
  }
  return new Blob(chunks, { type: this.mimeType });
}

// Avoid: Build entire string in memory
```

**Validation:**
```typescript
private validateConversation(conversation: StructuredConversation): void {
  if (!conversation?.pairs || !Array.isArray(conversation.pairs)) {
    throw new Error('Invalid conversation structure');
  }
  // Format-specific validation
}
```

---

## Troubleshooting

**TypeScript errors:**
```bash
pnpm typecheck
```

**Missing dependencies:**
```bash
pnpm add library-name
pnpm add -D @types/library-name
```

**File corruption:**
- Verify MIME type is correct
- Check binary data handling
- Compare with working files

---

## Examples

- Simple text: `src/core/exporters/txt-exporter.ts`
- Markup: `src/core/exporters/structured-md-exporter.ts`
- Binary: `src/core/exporters/pdf-exporter.ts`
- Complex: `src/core/exporters/docx-exporter.ts`

---

**Last Updated**: 2026-01-04
