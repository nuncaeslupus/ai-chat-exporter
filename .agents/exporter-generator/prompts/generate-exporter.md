# Generate Exporter Implementation

You are an expert TypeScript developer specializing in creating file format exporters.

## Task

Generate a complete, production-ready exporter implementation for the AI Chat Exporter extension.

## Required Information

You will receive:
- **Format Identifier**: Lowercase format ID (e.g., "epub", "latex", "rtf")
- **Format Display Name**: Human-readable name (e.g., "E-Book (EPUB)", "LaTeX Document")
- **MIME Type**: The format's MIME type
- **File Extension**: Including the dot (e.g., ".epub", ".tex")
- **Dependencies**: Required NPM packages
- **Features**: Required capabilities (from format analysis)

## Generation Guidelines

### Code Quality Standards

- Follow existing project patterns (see ChatGPT parser and PDF exporter)
- Use TypeScript with strict typing
- Extend `BaseExporter` class
- Handle errors gracefully
- Add comprehensive JSDoc comments
- Follow naming conventions
- Use async/await for asynchronous operations

### Required Methods

All exporters must implement:

```typescript
export class FormatExporter extends BaseExporter {
  protected formatName: ExportFormat = 'format';
  protected mimeType = 'mime/type';
  protected fileExtension = '.ext';

  async export(
    conversation: StructuredConversation,
    options?: ExportOptions
  ): Promise<Blob> {
    // Implementation
  }
}
```

### Structured Content Support

Handle all structured content block types:
- Paragraph
- Heading (levels 1-6)
- Code Block (with language and syntax highlighting)
- List (ordered and unordered, nested)
- Blockquote
- Table
- Horizontal Rule
- Image

Handle all inline formatting:
- Bold
- Italic
- Code
- Link
- Strikethrough

### Error Handling

- Validate input conversation
- Check for required dependencies
- Handle missing or malformed content
- Provide helpful error messages
- Never throw raw errors to user

### Performance

- Use streaming for large conversations when possible
- Avoid loading entire file in memory
- Optimize image handling
- Cache repeated elements

## Output Structure

Generate these complete files:

### 1. Exporter Implementation

**File**: `src/core/exporters/[format]-exporter.ts`

```typescript
/**
 * [Format Name] exporter
 */

import type { ExportOptions, ExportFormat } from '../types/exporter';
import type { StructuredConversation } from '../types/structured-content';
import { BaseExporter } from './base-exporter';

/**
 * Export conversations to [Format Name] format
 */
export class [Format]Exporter extends BaseExporter {
  protected formatName: ExportFormat = '[format]';
  protected mimeType = '[mime/type]';
  protected fileExtension = '.[ext]';

  /**
   * Export conversation to [Format]
   */
  async export(
    conversation: StructuredConversation,
    options?: ExportOptions
  ): Promise<Blob> {
    // Validate input
    this.validateConversation(conversation);

    // Generate content
    const content = await this.generateContent(conversation, options);

    // Create blob
    return new Blob([content], { type: this.mimeType });
  }

  /**
   * Generate [format] content from conversation
   */
  private async generateContent(
    conversation: StructuredConversation,
    options?: ExportOptions
  ): Promise<[ContentType]> {
    // Implementation
  }

  // Helper methods
  private renderParagraph(block: ParagraphBlock): [ReturnType] { }
  private renderHeading(block: HeadingBlock): [ReturnType] { }
  private renderCodeBlock(block: CodeBlock): [ReturnType] { }
  private renderList(block: ListBlock): [ReturnType] { }
  // etc.
}
```

### 2. Test File

**File**: `tests/unit/core/exporters/[format].test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { [Format]Exporter } from '../../../../src/core/exporters/[format]-exporter';
import type { StructuredConversation } from '../../../../src/core/types/structured-content';

describe('[Format]Exporter', () => {
  const exporter = new [Format]Exporter();

  const mockConversation: StructuredConversation = {
    id: 'test-1',
    title: 'Test Conversation',
    platform: 'chatgpt',
    pairs: [
      {
        id: 'pair-1',
        index: 0,
        selected: true,
        question: {
          id: 'q1',
          role: 'user',
          content: 'Hello',
          structuredContent: [
            {
              type: 'paragraph',
              content: [{ type: 'text', content: 'Hello' }]
            }
          ]
        },
        answer: {
          id: 'a1',
          role: 'assistant',
          content: 'Hi there!',
          structuredContent: [
            {
              type: 'paragraph',
              content: [{ type: 'text', content: 'Hi there!' }]
            }
          ]
        }
      }
    ],
    url: 'https://test.com',
    createdAt: new Date('2026-01-01')
  };

  it('should export simple conversation', async () => {
    const blob = await exporter.export(mockConversation);
    expect(blob).toBeDefined();
    expect(blob.type).toBe('[mime/type]');
  });

  it('should handle code blocks', async () => {
    // Test implementation
  });

  it('should handle images', async () => {
    // Test implementation
  });

  it('should handle long conversations', async () => {
    // Test implementation
  });
});
```

### 3. Integration Instructions

```markdown
## Integration Steps

1. **Install Dependencies**
   ```bash
   pnpm add [dependencies]
   pnpm add -D @types/[dependencies]
   ```

2. **Register Exporter**

   In `src/core/exporters/index.ts`:
   ```typescript
   import { [Format]Exporter } from './[format]-exporter.js';

   export const EXPORTERS: Record<ExportFormat, typeof BaseExporter> = {
     // ... existing exporters
     [format]: [Format]Exporter,
   };
   ```

3. **Update Types**

   In `src/core/types/exporter.ts`:
   ```typescript
   export type ExportFormat =
     | 'pdf'
     | 'md'
     | 'html'
     | 'docx'
     | 'txt'
     | 'json'
     | '[format]'; // Add this
   ```

4. **Add to UI**

   In `src/extension/popup/popup.html`:
   ```html
   <option value="[format]" data-i18n="format[Format]">[Format Name]</option>
   ```

5. **Add i18n**

   In `_locales/en/messages.json`:
   ```json
   {
     "format[Format]": {
       "message": "[Format Name]",
       "description": "Export format: [description]"
     }
   }
   ```

6. **Test**
   ```bash
   pnpm test -- [format]
   pnpm build
   ```
```

### 4. Example Usage (Optional)

```typescript
// Example usage
import { [Format]Exporter } from './[format]-exporter';

const exporter = new [Format]Exporter();
const blob = await exporter.export(conversation, {
  includeMetadata: true,
  preserveHtml: true
});

// Save or download blob
```

## Format-Specific Considerations

### For Binary Formats (PDF, DOCX, EPUB)
- Use appropriate library
- Handle encoding carefully
- Test file validity
- Consider file size

### For Text Formats (Markdown, LaTeX, CSV)
- Use UTF-8 encoding
- Handle special characters
- Consider line endings
- Validate syntax

### For Web Formats (HTML, SVG)
- Embed styles inline or reference
- Consider CSP restrictions
- Test in different browsers
- Minify if appropriate

### For Archive Formats (ZIP-based)
- Organize internal structure
- Compress appropriately
- Include manifest/metadata
- Validate archive integrity

## Examples to Reference

Look at existing exporters in the project:

- **Simple text**: `TxtExporter` - Good for basic text formats
- **Markup**: `StructuredMdExporter` - Good for markup languages
- **Web**: `HTMLExporter` - Good for HTML-based formats
- **Binary**: `PDFExporter` - Good for binary formats
- **Complex**: `DocxExporter` - Good for complex document formats

## Tips for Implementation

1. **Start simple** - Get basic export working first
2. **Test incrementally** - Test each feature as you add it
3. **Handle errors** - Gracefully handle all edge cases
4. **Optimize later** - Make it work, then make it fast
5. **Document well** - Add JSDoc for all public methods
6. **Follow patterns** - Match existing exporter style

## Common Pitfalls to Avoid

- Don't assume all content has HTML
- Don't forget to handle empty conversations
- Don't ignore structured content types
- Don't hardcode styles (use options when possible)
- Don't forget error messages
- Don't skip validation
- Don't ignore async operations

## Output Format

Provide complete, copy-paste ready code for each file, with clear file paths and proper TypeScript formatting.

## Example Input

```
Format: epub
Format Name: E-Book (EPUB)
MIME Type: application/epub+zip
Extension: .epub
Dependencies: epub-gen
Features:
- Chapter per Q&A pair
- Embedded images (base64)
- Syntax highlighting for code
- Table of contents
- Metadata (title, author, date)
```

## Example Output

[Would provide complete implementation files as shown above]
