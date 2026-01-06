# Analyze Export Format Requirements

You are an expert at designing file format exporters and understanding format specifications.

## Task

Analyze the requirements for a new export format and provide a detailed implementation plan for the AI Chat Exporter extension.

## Required Information

You will receive:
- **Format Name**: Name of the format (e.g., "EPUB", "LaTeX", "RTF")
- **Description**: Purpose and use case for this format
- **Requirements**: Specific features and capabilities needed

## Analysis Process

Provide a comprehensive analysis covering these areas:

### 1. Format Overview

**Research and describe**:
- Format type (binary, text, archive, etc.)
- Common use cases
- Platform compatibility
- Standard specifications (if any)
- Current adoption and support

**Output**: Brief overview of the format

### 2. Technical Requirements

**Identify**:
- File structure (single file, archive, etc.)
- Required file extensions
- MIME type
- Character encoding requirements
- Maximum size limitations
- Metadata support

**Output**: Technical specifications

### 3. Library Research

**Find and evaluate**:
- Available Node.js libraries
- Library maturity and maintenance
- Bundle size impact
- TypeScript support
- License compatibility
- Alternative approaches if no library exists

**Output**: Recommended libraries with pros/cons

### 4. Content Structure Mapping

**Map conversation elements to format**:
- How to represent Q&A pairs
- Message role indication
- Metadata (title, platform, model, date)
- Images and attachments
- Code blocks
- Lists and formatting
- Links and citations
- Tables (if supported)

**Output**: Structure mapping table

### 5. Rendering Approach

**Determine**:
- Template-based or programmatic?
- How to handle structured content blocks
- Styling approach
- Font and typography
- Color scheme
- Page layout (if applicable)
- Responsive design (if applicable)

**Output**: Recommended rendering strategy

### 6. Special Handling

**Identify edge cases**:
- Very long conversations
- Large images
- Complex code blocks
- Mathematical equations
- Multi-language content
- Right-to-left text
- Special characters
- Embedded media

**Output**: Edge case handling strategies

### 7. Limitations and Constraints

**Document**:
- What features can't be supported
- Format-specific restrictions
- Performance considerations
- Browser compatibility (if relevant)
- File size limitations

**Output**: Known limitations list

### 8. Testing Strategy

**Propose**:
- How to verify correctness
- What tools to use for validation
- Example test cases
- Quality metrics

**Output**: Testing approach

### 9. Implementation Complexity

**Estimate**:
- Development effort (simple/moderate/complex)
- Required dependencies
- Potential challenges
- Time estimate

**Output**: Complexity assessment

## Output Format

Provide your analysis in this structure:

```markdown
# Format Analysis: [Format Name]

## Overview
[Brief description of the format and its use case]

## Technical Specifications
- **File Extension**: .xyz
- **MIME Type**: application/xyz
- **Encoding**: UTF-8
- **Structure**: [single file / archive / etc.]

## Recommended Libraries

### Option 1: [Library Name]
- **NPM Package**: `library-name`
- **Version**: 1.2.3
- **Bundle Size**: ~50KB
- **TypeScript**: ✅ Yes
- **Maintenance**: Active
- **Pros**: Easy to use, well-documented
- **Cons**: Large bundle size
- **License**: MIT

### Option 2: [Alternative]
[...]

**Recommendation**: Use Option 1 because [reason]

## Content Structure Mapping

| Conversation Element | Format Representation |
|---------------------|----------------------|
| Q&A Pair | [how to represent] |
| User Message | [representation] |
| Assistant Message | [representation] |
| Code Block | [representation] |
| Image | [representation] |
| Metadata | [representation] |

## Rendering Approach

[Detailed description of how to render content]

### Structured Content Handling
- **Paragraph**: [how to render]
- **Heading**: [how to render]
- **Code Block**: [how to render]
- **List**: [how to render]
- **Blockquote**: [how to render]
- **Table**: [how to render]
- **Horizontal Rule**: [how to render]

### Inline Formatting
- **Bold**: [how to render]
- **Italic**: [how to render]
- **Code**: [how to render]
- **Link**: [how to render]
- **Strikethrough**: [how to render]

## Special Handling

### Edge Cases
1. **Long Conversations**: [strategy]
2. **Large Images**: [strategy]
3. **Complex Code**: [strategy]
4. **Math Equations**: [strategy]
5. **Special Characters**: [strategy]

### Performance Optimizations
- [optimization 1]
- [optimization 2]

## Limitations

Known limitations of this format:
- [limitation 1]
- [limitation 2]

Workarounds:
- [workaround 1]
- [workaround 2]

## Testing Strategy

### Validation
- [how to validate output]
- [tools to use]

### Test Cases
1. Simple conversation (1-2 Q&A pairs)
2. Long conversation (50+ pairs)
3. Conversation with code blocks
4. Conversation with images
5. Conversation with special formatting

### Quality Metrics
- [metric 1]
- [metric 2]

## Implementation Plan

### Step 1: Setup
- Install dependencies: `pnpm add library-name`
- Create exporter file: `src/core/exporters/format-exporter.ts`

### Step 2: Basic Structure
- Extend BaseExporter
- Implement basic export() method
- Handle simple text content

### Step 3: Structured Content
- Add rendering for all block types
- Add inline formatting support

### Step 4: Advanced Features
- Image embedding
- Code syntax highlighting
- Metadata integration

### Step 5: Polish
- Error handling
- Performance optimization
- Documentation

## Complexity Assessment

- **Effort**: [Simple / Moderate / Complex]
- **Time Estimate**: [X hours]
- **Dependencies**: [number of new packages]
- **Challenges**: [main challenges]

## Example Code Snippet

```typescript
// Example of key functionality
export class FormatExporter extends BaseExporter {
  async export(conversation: StructuredConversation): Promise<Blob> {
    // [example implementation]
  }
}
```

## References

- [Link to format specification]
- [Link to library documentation]
- [Link to examples]
```

## Tips for Claude

- Research actual libraries and provide real package names
- Be specific about technical details
- Consider existing exporters in the project as examples
- Highlight any unique challenges for this format
- Suggest alternatives if direct approach is difficult
- Consider bundle size impact on extension
- Think about user experience (speed, quality)

## Example Input

```
Format: EPUB
Description: E-book format for reading conversations on e-readers
Requirements:
- Chapter-based (one chapter per Q&A)
- Table of contents
- Embedded images
- Code syntax highlighting
- Works on Kindle and iBooks
- Metadata (title, author, date)
```

## Example Output

[Would provide full analysis as shown in template above]
