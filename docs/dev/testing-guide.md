---
name: testing-guide
description: Testing strategies and practices for AI Chat Exporter
metadata:
  category: development
  audience: developers
---

# Testing Guide

Comprehensive guide to testing strategies and practices for the AI Chat Exporter project.

## Overview

Test-Driven Development (TDD) approach with comprehensive unit tests for all core functionality.

**Testing Philosophy:**
1. Write tests first - Define behavior before implementation
2. Test behavior, not implementation
3. Keep tests simple
4. Make tests readable - Tests are documentation
5. Fast feedback

**Coverage Goals:**
- Core logic: 90%+ (parsers, exporters, services)
- UI components: Basic smoke tests
- Extension code: Integration tests
- Overall: 80%+

## Test-Driven Development Workflow

```
RED (write failing test) → GREEN (minimal implementation) → REFACTOR (improve) → Repeat
```

```typescript
// 1. Write test first
it('exports conversation to markdown', async () => {
  const result = await exporter.export(conversation, pairs, {});
  expect(result.success).toBe(true);
  expect(result.blob?.type).toBe('text/markdown');
});

// 2. Implement to pass
protected async generateContent(conv: Conversation, pairs: QAPair[]): Promise<string> {
  let md = `# ${conv.title}\n\n`;
  for (const pair of pairs) {
    md += `## Q: ${pair.question.content}\n\nA: ${pair.answer.content}\n\n`;
  }
  return md;
}

// 3. Refactor while keeping tests green
protected async generateContent(conv: Conversation, pairs: QAPair[]): Promise<string> {
  const sections = [`# ${conv.title}`, ''];
  sections.push(...pairs.map(p => this.formatPair(p)));
  return sections.join('\n');
}
```

## Testing Tools

**Vitest:** Fast ESM-native testing framework with Jest-compatible API
**jsdom:** DOM implementation for Node.js tests

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    environment: 'jsdom', // Enables DOM APIs
  }
});
```

**Test Utilities:** Custom helpers in `tests/utils/` (e.g., `exporter-helpers.ts`)

## Test Structure

**Directory Organization:**
```
tests/
├── unit/
│   ├── core/
│   │   ├── parsers/
│   │   ├── exporters/
│   │   └── services/
├── integration/
├── fixtures/
│   ├── dom-snapshots/
│   └── expected-outputs/
└── utils/
```

**File Naming:** `{module-name}.test.ts`

## Writing Tests

**Basic Structure:**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('ModuleName', () => {
  beforeEach(() => {
    // Initialize test environment
  });

  describe('methodName', () => {
    it('does something specific', () => {
      // Arrange
      const input = createTestData();

      // Act
      const result = methodUnderTest(input);

      // Assert
      expect(result).toBe(expected);
    });

    it('handles edge case', () => {
      // Test edge cases
    });

    it('throws error for invalid input', () => {
      expect(() => methodUnderTest(invalidInput)).toThrow();
    });
  });
});
```

**Test Naming:**
```typescript
// Good
it('returns true when URL matches platform pattern', () => {});
it('extracts conversation title from header element', () => {});

// Bad
it('test1', () => {});
it('works', () => {});
```

## Test Fixtures

**DOM Snapshots:** Capture real platform HTML for parser tests

```typescript
// Create: captureConversationDOM('chatgpt') in browser console
// Save to: tests/fixtures/dom-snapshots/chatgpt/real-capture.html

// Use in tests
describe('ChatGPTParser', () => {
  beforeEach(() => {
    const html = readFileSync(join(__dirname, '../../fixtures/dom-snapshots/chatgpt/real-capture.html'), 'utf-8');
    document.body.innerHTML = html;
  });

  it('parses real conversation', () => {
    expect(new ChatGPTParser().parse().success).toBe(true);
  });
});
```

**Test Data Factories:**

```typescript
export function createTestConversation(overrides?: Partial<Conversation>): Conversation {
  return {
    id: 'test-conv-1',
    title: 'Test Conversation',
    platform: 'chatgpt',
    pairs: [createTestQAPair(0), createTestQAPair(1)],
    createdAt: new Date('2026-01-02'),
    ...overrides
  };
}

export function createTestQAPair(index: number): QAPair {
  return {
    id: `pair-${index}`,
    index,
    question: { id: `q-${index}`, role: 'user', content: `Question ${index + 1}?`, timestamp: new Date() },
    answer: { id: `a-${index}`, role: 'assistant', content: `Answer ${index + 1}`, timestamp: new Date() },
    selected: true
  };
}
```

## Running Tests

```bash
# Run all tests
pnpm test

# Watch mode (best for development)
pnpm test:watch

# Coverage report
pnpm test:coverage

# Run specific test file
pnpm test -- chatgpt.test.ts

# Run tests matching pattern
pnpm test -- exporters

# Interactive UI mode
pnpm test:ui
```

**CI/CD:** Tests run on pre-commit hook, pull requests, and main branch pushes

## Coverage

```bash
pnpm test:coverage
# View HTML report: open coverage/index.html
```

**Goals:**
- Statements: 90%+
- Branches: 85%+
- Functions: 90%+
- Lines: 90%+

## Best Practices

**1. Test One Thing**
```typescript
// Good: Single behavior
it('sanitizes special characters', () => {
  expect(FilenameService.sanitize('Hello/World?')).toBe('Hello-World-');
});
```

**2. Use Descriptive Assertions**
```typescript
expect(parser.canParse()).toBe(true);
expect(conversation.pairs).toHaveLength(5);
```

**3. Test Edge Cases**
```typescript
describe('parse', () => {
  it('parses normal conversation', () => {});
  it('handles empty conversation', () => {});
  it('handles orphaned user message', () => {});
  it('handles malformed HTML', () => {});
});
```

**4. Isolate Tests**
```typescript
let service: SelectionService;
beforeEach(() => { service = new SelectionService(); }); // Fresh instance
```

**5. Test Error Cases**
```typescript
it('fails gracefully with empty pairs', async () => {
  const result = await exporter.export(conversation, [], options);
  expect(result.success).toBe(false);
  expect(result.error).toBeDefined();
});
```

## Common Patterns

**Async Code:**
```typescript
it('exports asynchronously', async () => {
  const result = await exporter.export(conversation, pairs, options);
  expect(result.success).toBe(true);
});
```

**DOM Manipulation:**
```typescript
it('injects button correctly', () => {
  const injectionPoint = parser.getButtonInjectionPoint();
  expect(injectionPoint).toBeInstanceOf(HTMLElement);
});
```

**Mocking:**
```typescript
import { vi } from 'vitest';

it('downloads file', async () => {
  const mockDownload = vi.fn();
  global.chrome = { downloads: { download: mockDownload } };
  await downloadFile(blob, filename);
  expect(mockDownload).toHaveBeenCalledWith({
    url: expect.stringContaining('blob:'),
    filename: 'test.pdf'
  });
});
```

**Parameterized Tests:**
```typescript
const cases = [
  { input: 'Hello/World', expected: 'Hello-World' },
  { input: 'File:Name?', expected: 'File-Name-' }
];

cases.forEach(({ input, expected }) => {
  it(`sanitizes "${input}" to "${expected}"`, () => {
    expect(FilenameService.sanitize(input)).toBe(expected);
  });
});
```

**Testing Classes:**
```typescript
class TestExporter extends BaseExporter {
  readonly format = 'test' as const;
  readonly mimeType = 'text/test';
  protected async generateContent(): Promise<string> { return 'test'; }
}

it('creates blob with correct mime type', async () => {
  const result = await new TestExporter().export(conversation, pairs, {});
  expect(result.blob?.type).toBe('text/test');
});
```

## Debugging Tests

**Console Logging:**
```typescript
console.log('Parse result:', result);
// Run: pnpm test -- --reporter=verbose
```

**Isolate/Skip Tests:**
```typescript
it.only('this test only', () => {});  // Run only this
it.skip('skip this test', () => {});   // Skip this
```

**Filter Tests:**
```bash
pnpm test -- ChatGPT         # Tests matching "ChatGPT"
pnpm test -- chatgpt.test.ts # Specific file
```

## Troubleshooting

**Tests timing out:** Add timeout parameter
```typescript
it('slow operation', async () => { /* ... */ }, 10000);
```

**Module errors:** Use `.js` extension
```typescript
import { Parser } from './parser.js';  // Correct for ESM
```

**Flaky tests:** Use deterministic values
```typescript
const fixedDate = new Date('2026-01-02');
expect(generateFilename(fixedDate)).toBe('file_2026-01-02T00:00:00.000Z');
```

## Summary

- Write tests first (TDD)
- Test behavior, not implementation
- Use descriptive names and clear assertions
- Test edge cases and error conditions
- Keep tests isolated and independent
- Aim for high coverage (90%+ on core)
- Use fixtures for complex test data
- Run tests frequently in watch mode
