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

An exporter converts a normalized `Conversation` (plus the `QAPair`s the user
selected) into a specific file format. Most exporters convert that
`Conversation` to a `StructuredConversation` first (via
`ConversationStructureService`) to get rich, block-based content instead of
raw HTML/text — see Step 3.

**Required components:**
1. Exporter class extending `BaseExporter`
2. Rendering logic for structured content
3. Unit tests
4. Dependencies (if needed)

**Reference files:**
- `src/core/types/structured-content.ts` - Structured content data model
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
import type { ExportFormat, ExportOptions, ExportResult, Conversation, QAPair } from '../types';
import { BaseExporter } from './base-exporter';

export class FormatExporter extends BaseExporter {
  readonly format: ExportFormat = 'format';
  readonly extension = 'fmt';
  readonly mimeType = 'application/format';

  async export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      const content = this.generateContent(conversation, selectedPairs, options);
      return this.createSuccessResult(content, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export'
      );
    }
  }

  private generateContent(
    conversation: Conversation,
    pairs: QAPair[],
    options: ExportOptions
  ): string {
    let output = '';

    if (options.includeMetadata) {
      output += `${conversation.title}\n${conversation.platform}\n\n`;
    }

    for (const pair of pairs) {
      output += `${pair.question.content}\n${pair.answer.content}\n\n`;
    }

    return output;
  }
}
```

Note the three abstract members are `format`, `extension` (no leading dot —
`createSuccessResult` appends it for you), and `mimeType`. `export()` takes
the *already-selected* pairs as its own `selectedPairs` argument — callers
decide selection upstream, so there is nothing to filter by `pair.selected`
inside the exporter. `createSuccessResult`/`createErrorResult` (both on
`BaseExporter`) build the `ExportResult` for you.

### 3. Add Structured Content Support

The example above only reads each message's plain-text `content`. To render
rich formatting (headings, code blocks, tables, images…), convert the
conversation to `StructuredConversation` with `ConversationStructureService`
first, then walk each pair's `StructuredMessage.blocks`:

```typescript
import type {
  ExportFormat,
  ExportOptions,
  ExportResult,
  Conversation,
  QAPair,
  StructuredContentBlock,
  InlineContent,
} from '../types';
import { BaseExporter } from './base-exporter';
import { ConversationStructureService } from '../services';

export class FormatExporter extends BaseExporter {
  readonly format: ExportFormat = 'format';
  readonly extension = 'fmt';
  readonly mimeType = 'application/format';

  async export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      const content = this.generateContent(conversation, selectedPairs, options);
      return this.createSuccessResult(content, options.filename);
    } catch (error) {
      return this.createErrorResult(
        error instanceof Error ? error.message : 'Failed to export'
      );
    }
  }

  private generateContent(
    conversation: Conversation,
    pairs: QAPair[],
    options: ExportOptions
  ): string {
    const structured = ConversationStructureService.toStructured({
      ...conversation,
      pairs,
    });

    let output = '';

    if (options.includeMetadata) {
      output += `${structured.title}\n${structured.platform}\n\n`;
    }

    for (const pair of structured.pairs) {
      output += this.renderBlocks(pair.question.blocks);
      output += this.renderBlocks(pair.answer.blocks);
    }

    return output;
  }

  private renderBlocks(blocks: StructuredContentBlock[]): string {
    return blocks.map(block => this.renderBlock(block)).join('');
  }

  private renderBlock(block: StructuredContentBlock): string {
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        return `${this.renderInline(block.content)}\n\n`;
      case 'code':
        return `${block.code}\n\n`;
      case 'list':
        return block.items.map(item => this.renderInline(item.content)).join('\n') + '\n\n';
      case 'blockquote':
        return this.renderBlocks(block.content);
      case 'table':
        return ''; // format-specific table rendering
      case 'hr':
        return '---\n\n';
      case 'image':
        return `[Image: ${block.alt}]\n\n`;
      default:
        return '';
    }
  }

  private renderInline(content: InlineContent[]): string {
    return content
      .map(item => {
        switch (item.type) {
          case 'bold':
            return `**${item.text}**`;
          case 'italic':
            return `*${item.text}*`;
          case 'code':
            return `\`${item.text}\``;
          case 'link':
            return `[${item.text}](${item.url})`;
          case 'strikethrough':
            return `~~${item.text}~~`;
          default:
            return item.text;
        }
      })
      .join('');
  }
}
```

`StructuredMessage` carries its rich content in `blocks`, not
`structuredContent`; each `InlineContent` item carries its text in `text`, not
`content`; and the horizontal-rule block's `type` discriminant is `'hr'`, not
`'horizontal_rule'` (the interface name is still `HorizontalRuleBlock` — see
Content Types below).

### 4. Write Tests

```typescript
// tests/unit/core/exporters/format.test.ts
import { describe, it, expect } from 'vitest';
import type { ExportFormat } from '../../../../src/core/types/exporter';
import { FormatExporter } from '../../../../src/core/exporters/format-exporter';

describe('FormatExporter', () => {
  const exporter = new FormatExporter();

  it('should export simple conversation', async () => {
    const conversation = {
      id: 'test-1',
      title: 'Test',
      platform: 'chatgpt' as const,
      url: 'https://chatgpt.com/c/test-1',
      pairs: [{
        id: 'pair-1',
        index: 0,
        selected: true,
        question: { id: 'q1', role: 'user' as const, content: 'Hello' },
        answer: { id: 'a1', role: 'assistant' as const, content: 'Hi!' },
      }],
    };

    const result = await exporter.export(conversation, conversation.pairs, {
      // 'format' as ExportFormat until Step 5 adds it to the union.
      format: 'format' as ExportFormat,
      filename: 'test',
      includeMetadata: true,
      includeTimestamps: false,
    });

    expect(result.success).toBe(true);
    expect(result.blob?.type).toBe('application/format');
    const text = await result.blob!.text();
    expect(text).toContain('Hello');
  });
});
```

`Conversation` requires `url` (there is no default), and `export()` returns an
`ExportResult` — `{ success, blob?, filename?, mimeType?, error? }` — rather
than a bare `Blob`, so tests read the file off `result.blob`.

Test scenarios: simple conversation, code blocks, tables, selection filtering, edge cases.

### 5. Register Exporter

Exporters are dynamically `import()`ed on demand (`pdf`/`docx` pull in ~700 KB
of dependencies that must not sit in the content script's eager bundle), so
the registry stores async factories rather than classes:

```typescript
// src/core/exporters/index.ts
export const exporterRegistry: ExporterRegistry = new Map<ExportFormat, ExporterFactory>([
  ['md', async () => new (await import('./structured-md-exporter')).StructuredMarkdownExporter()],
  ['txt', async () => new (await import('./txt-exporter')).TextExporter()],
  ['json', async () => new (await import('./json-exporter')).JsonExporter()],
  ['pdf', async () => new (await import('./pdf-exporter')).PdfExporter()],
  ['docx', async () => new (await import('./docx-exporter')).DocxExporter()],
  ['html', async () => new (await import('./html-exporter')).HtmlExporter()],
  ['format', async () => new (await import('./format-exporter')).FormatExporter()], // Add
]);

// src/core/types/exporter.ts
export type ExportFormat = 'pdf' | 'md' | 'txt' | 'json' | 'docx' | 'html' | 'format';
```

`getExporter(format)` (in the same `index.ts`) is `async` and awaits the
matching factory — there is no `EXPORTERS` record of exporter classes to look
up synchronously.

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
protected validateOptions(options: ExportOptions): boolean
protected createSuccessResult(content: string | Blob, filename: string): ExportResult
protected createErrorResult(error: string): ExportResult
protected formatTimestamp(date?: Date): string
protected formatPlatformName(platform: string): string
protected getMetadataLabel(field: 'platform' | 'model' | 'exported' | 'url'): string
protected getRoleName(role: 'user' | 'assistant' | string, platform?: string): string
```

There is no `validateConversation`/`getMetadata`/`getSelectedPairs` on the
base class — pair selection happens before `export()` is called (the caller
passes only the selected `QAPair[]`), and any conversation validation an
exporter needs is its own responsibility (see Best Practices below).

**Must implement:**
```typescript
abstract export(
  conversation: Conversation,
  selectedPairs: QAPair[],
  options: ExportOptions
): Promise<ExportResult>
```

---

## Content Types

**Structured blocks** (`StructuredContentBlock`, discriminated by `type`):
- `ParagraphBlock` (`type: 'paragraph'`) - Text paragraphs with inline formatting
- `HeadingBlock` (`type: 'heading'`) - Headers (`level: 1-6`)
- `CodeBlock` (`type: 'code'`) - Code with a `language` and `code` string
- `ListBlock` (`type: 'list'`) - Ordered/unordered lists (`items`, each with optional `nested`)
- `BlockquoteBlock` (`type: 'blockquote'`) - Quoted text (nested `StructuredContentBlock[]`)
- `TableBlock` (`type: 'table'`) - Tables (`headers`/`rows` of `InlineContent[]`)
- `HorizontalRuleBlock` (`type: 'hr'`) - Horizontal dividers
- `ImageBlock` (`type: 'image'`) - Images (`url`, `alt`, optional `width`/`height`)

**Inline content:** a single `InlineContent` interface, not one type per kind —
`{ type: 'text' | 'bold' | 'italic' | 'code' | 'link' | 'strikethrough'; text: string; url?: string; children?: InlineContent[] }`.
`url` is only set for `'link'`.

**Export options** (`ExportOptions`, all required unless marked `?`):
```typescript
interface ExportOptions {
  format: ExportFormat;
  filename: string;
  includeMetadata: boolean;     // Include title, platform, date
  includeTimestamps: boolean;
  pdfOptions?: PDFExportOptions;
  docxOptions?: DOCXExportOptions;
}
```

There is no `preserveHtml`/`selectedOnly` flag — HTML is preserved per-message
via `Message.htmlContent` upstream in parsing, and pair selection is already
resolved into the `selectedPairs` argument before `export()` runs.

---

## Best Practices

**Error handling:**
```typescript
async export(
  conversation: Conversation,
  selectedPairs: QAPair[],
  options: ExportOptions
): Promise<ExportResult> {
  try {
    if (selectedPairs.length === 0) {
      throw new Error('No conversation pairs to export');
    }
    const content = this.generateContent(conversation, selectedPairs, options);
    return this.createSuccessResult(content, options.filename);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return this.createErrorResult(`Export failed: ${message}`);
  }
}
```

**Performance for large conversations:**
```typescript
// Good: build a Blob directly -- createSuccessResult(content, filename)
// accepts a Blob as well as a string, so large exports skip the
// intermediate string concatenation.
private buildBlob(pairs: QAPair[]): Blob {
  const chunks: BlobPart[] = [];
  for (const pair of pairs) {
    chunks.push(this.renderPair(pair));
  }
  return new Blob(chunks, { type: this.mimeType });
}

// Avoid: building one giant string in memory first
```

**Validation:**
```typescript
private assertHasPairs(pairs: QAPair[]): void {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new Error('No conversation pairs to export');
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

**Last Updated**: 2026-07-28
