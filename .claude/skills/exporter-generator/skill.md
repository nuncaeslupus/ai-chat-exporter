# AI Chat Exporter Format Generator Skill

Claude skill for automatically analyzing export format requirements and generating exporter implementations.

## Overview

This skill assists developers in creating exporters for new file formats by:
1. Analyzing format requirements and specifications
2. Identifying content structure needs
3. Generating exporter implementation scaffolding
4. Creating format-specific rendering logic
5. Generating test files

## Prerequisites

Before using this skill:

1. **Understand target format** - Know the format specification (PDF, DOCX, etc.)
2. **Review ADDING_EXPORTERS.md** - Understand the exporter architecture
3. **Have example output** - Know what the exported file should look like
4. **Check dependencies** - Identify required libraries (jsPDF, docx, etc.)

## Skill Components

This skill consists of two main prompts:

### 1. Analyze Export Format

**Purpose**: Analyze a file format to understand its structure and requirements.

**Prompt**: `prompts/analyze-format.md`

**Usage**:
```
@analyze-format.md

Format: EPUB
Description: Generate EPUB e-books from conversations
Requirements:
- Chapter-based structure (one chapter per Q&A pair)
- Table of contents
- Embedded images
- Syntax highlighting for code
```

**Output**: Detailed analysis including:
- Required libraries/dependencies
- Content structure mapping
- Styling requirements
- Special handling needs
- Implementation approach

### 2. Generate Exporter Implementation

**Purpose**: Generate complete exporter implementation code.

**Prompt**: `prompts/generate-exporter.md`

**Usage**:
```
@generate-exporter.md

Format: EPUB
Format Name: E-Book (EPUB)
MIME Type: application/epub+zip
Extension: .epub
Dependencies: epub-gen
```

**Output**: Complete implementation including:
- Exporter class implementation
- Format-specific rendering logic
- Test file scaffold
- Integration instructions
- Example usage

## Workflow

### Step-by-Step Usage

#### 1. Research Format Requirements

```
Research the target format:
- File structure
- Required metadata
- Content organization
- Limitations
- Available libraries
```

#### 2. Analyze with Claude

Start a conversation with Claude:

```
I need to add EPUB export support to the AI Chat Exporter extension.

@analyze-format.md

Format: EPUB
Description: E-book format for conversations
Requirements:
- Portable across e-readers
- Table of contents
- Embedded images
- Code syntax highlighting
- Proper metadata (title, author, date)
```

#### 3. Review Analysis

Claude will provide:
- Recommended libraries
- Implementation approach
- Content structure
- Potential challenges
- Example code snippets

#### 4. Generate Implementation

```
Great analysis! Now please generate the complete exporter implementation.

@generate-exporter.md

Format: epub
Format Name: E-Book (EPUB)
MIME Type: application/epub+zip
Extension: .epub
Dependencies: epub-gen
Features: [from analysis]
```

#### 5. Implement Generated Code

Claude will provide complete files. Create them in your project:

```bash
# Exporter implementation
src/core/exporters/epub-exporter.ts

# Tests
tests/unit/core/exporters/epub.test.ts

# Example output (for testing)
tests/fixtures/exports/example.epub
```

#### 6. Manual Steps

The skill generates most code, but you still need to:

1. **Install dependencies**:
   ```bash
   pnpm add epub-gen
   pnpm add -D @types/epub-gen
   ```

2. **Register exporter** in `src/core/exporters/index.ts`:
   ```typescript
   import { EPUBExporter } from './epub-exporter.js';

   export const EXPORTERS: Record<ExportFormat, typeof BaseExporter> = {
     pdf: PDFExporter,
     md: StructuredMdExporter,
     html: HTMLExporter,
     docx: DocxExporter,
     txt: TxtExporter,
     json: JsonExporter,
     epub: EPUBExporter, // Add this
   };
   ```

3. **Update types** in `src/core/types/exporter.ts`:
   ```typescript
   export type ExportFormat =
     | 'pdf'
     | 'md'
     | 'html'
     | 'docx'
     | 'txt'
     | 'json'
     | 'epub'; // Add this
   ```

4. **Add to UI** in `src/extension/popup/popup.html`:
   ```html
   <option value="epub" data-i18n="formatEPUB">E-Book (EPUB)</option>
   ```

5. **Add i18n strings** in `_locales/en/messages.json`:
   ```json
   {
     "formatEPUB": {
       "message": "E-Book (EPUB)",
       "description": "Export format: EPUB e-book"
     }
   }
   ```

6. **Run tests**:
   ```bash
   pnpm test -- epub
   ```

7. **Manual testing**:
   ```bash
   pnpm build:chrome
   # Test in browser
   ```

## Prompt Details

### Analyze Format Prompt

**File**: `prompts/analyze-format.md`

**Input Required**:
- **Format name** (e.g., "EPUB", "LaTeX")
- **Description** (purpose and use case)
- **Requirements** (features needed)

**Analysis Process**:
1. Research format specifications
2. Identify required libraries
3. Map conversation structure to format
4. Determine rendering approach
5. Identify special handling needs
6. Note limitations
7. Recommend implementation strategy

**Output Format**:
```
Format Analysis: EPUB
=====================

Overview:
- E-book format based on XHTML
- ZIP container with metadata
- Chapter-based organization

Required Libraries:
- epub-gen: Main EPUB generation
- marked: Markdown to HTML conversion
- highlight.js: Code syntax highlighting

Content Structure:
1. Cover page (conversation title)
2. Table of contents (auto-generated)
3. Chapters (one per Q&A pair)
4. Inline images (base64 embedded)
5. Code blocks (syntax highlighted)

Implementation Approach:
- Use StructuredConversation as input
- Convert each QAPair to EPUB chapter
- Embed images inline
- Generate TOC automatically
- Apply custom CSS for styling

Special Handling:
- Large conversations: split into volumes
- Images: compress and embed
- Code blocks: use <pre> with classes
- Links: preserve as hyperlinks
```

### Generate Exporter Prompt

**File**: `prompts/generate-exporter.md`

**Input Required**:
- **Format identifier** (e.g., "epub")
- **Format display name** (e.g., "E-Book (EPUB)")
- **MIME type** (e.g., "application/epub+zip")
- **File extension** (e.g., ".epub")
- **Dependencies** (library names)
- **Features** (from analysis)

**Generation Process**:
1. Create exporter class extending BaseExporter
2. Implement export() method
3. Add format-specific rendering
4. Handle structured content blocks
5. Create test file scaffold
6. Provide integration instructions

**Output Format**:
Complete TypeScript files ready to copy-paste into the project.

## Examples

### Example 1: Adding LaTeX Export

**Input**:
```
@analyze-format.md

Format: LaTeX
Description: Academic paper format with equations
Requirements:
- Document class: article
- Math equations support
- Code listings with syntax highlighting
- Bibliography support
- PDF compilation
```

**Output**: Analysis with recommendations for `latex-js` or template approach

### Example 2: Adding CSV Export

**Input**:
```
@generate-exporter.md

Format: csv
Format Name: Spreadsheet (CSV)
MIME Type: text/csv
Extension: .csv
Dependencies: none (built-in)
Features:
- Columns: Index, Role, Content, Timestamp
- Escape special characters
- UTF-8 with BOM
```

**Output**: Complete CSV exporter implementation

## Tips for Best Results

### 1. Be Specific About Requirements

Instead of:
> "Add EPUB export"

Use:
> "Add EPUB export with:
> - Chapter per Q&A pair
> - Embedded images
> - Syntax-highlighted code
> - Table of contents
> - Works on Kindle and Apple Books"

### 2. Research the Format First

- Read format specification
- Check available libraries
- Try generating sample files manually
- Note any quirks or limitations

### 3. Provide Example Output

Share a sample of what the exported file should look like:
> "Here's an example EPUB I generated manually. The exporter should produce similar output..."

### 4. Consider Edge Cases

Think about:
- Very long conversations
- Large images
- Special characters
- Complex code blocks
- Multi-language content

## Troubleshooting

### Library compatibility issues

**Problem**: Generated code uses library version that doesn't match

**Solutions**:
- Specify exact library version in prompt
- Check library docs for API changes
- Ask Claude to use specific API version

### Format limitations

**Problem**: Format can't support all features

**Solutions**:
- Ask Claude for workarounds
- Gracefully degrade features
- Document limitations
- Suggest alternative formats

### File size issues

**Problem**: Exported files too large

**Solutions**:
- Compress images
- Split large conversations
- Remove unnecessary content
- Optimize rendering

## Advanced Usage

### Custom Styling

Request custom styling:

```
@generate-exporter.md

[...standard inputs...]

Styling Requirements:
- ChatGPT-like conversation bubbles
- User messages in blue
- Assistant messages in gray
- Code blocks with line numbers
- Responsive for different screen sizes
```

### Multi-Format Support

Generate variations:

```
I need both EPUB 2.0 and EPUB 3.0 support.
Can you generate two exporters or one with a version option?
```

### Optimization

Request performance improvements:

```
The EPUB exporter should:
- Stream large conversations instead of loading all in memory
- Compress images on the fly
- Generate chapters in parallel
- Cache repeated elements
```

## Maintenance

### Updating Prompts

1. Edit `prompts/analyze-format.md` or `prompts/generate-exporter.md`
2. Test with multiple format types
3. Document changes
4. Update this skill.md

### Adding Format Templates

Create reusable templates for common formats:

```bash
.claude/skills/exporter-generator/templates/
  epub.template.ts
  latex.template.ts
  rtf.template.ts
```

## Integration with Development Workflow

### Testing New Exporters

```bash
# 1. Generate exporter
# [Use Claude with prompts]

# 2. Install dependencies
pnpm add <library-name>

# 3. Implement generated code
code src/core/exporters/new-format-exporter.ts

# 4. Test
pnpm test -- new-format

# 5. Manual test
pnpm build && test in browser
```

## Resources

- [ADDING_EXPORTERS.md](../../../docs/development/ADDING_EXPORTERS.md) - Manual exporter development guide
- [BaseExporter source](../../../src/core/exporters/base-exporter.ts) - Base class reference
- [Existing exporters](../../../src/core/exporters/) - Examples to follow

## Support

For help with this skill:

1. Check existing exporter implementations
2. Review format specifications
3. Open GitHub issue with "exporter-skill" label
4. Provide example output and requirements

---

**Last Updated**: 2026-01-04
**Skill Version**: 1.0
**Compatible with**: Claude 3.5 Sonnet and above
