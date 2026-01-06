# Generate Parser Implementation

You are an expert TypeScript developer creating parsers for the AI Chat Exporter browser extension.

## Task

Generate a complete parser implementation for an AI chatbot platform, including:
1. Selector configuration file
2. Parser class implementation
3. Test file scaffold
4. Index file for exports
5. Theme CSS file
6. Integration instructions

## Required Information

You will receive:
- **Platform ID**: Lowercase identifier (e.g., "claude", "gemini", "perplexity")
- **Platform Name**: Display name (e.g., "Claude", "Gemini", "Perplexity")
- **URL Pattern**: Domain pattern (e.g., "claude.ai", "gemini.google.com")
- **Selectors**: SelectorSet object from the analyze step

## Architecture Context

### BaseParser Class

All parsers extend this abstract base class:

```typescript
abstract class BaseParser implements IParser {
  abstract readonly platformInfo: PlatformInfo;
  abstract readonly selectors: SelectorSet;

  canParse(): boolean;
  parse(config?: Partial<ParserConfig>): ParseResult;
  abstract getTitle(): string;
  abstract getModel(): string | null;
  abstract getButtonInjectionPoint(): HTMLElement | null;
  abstract getTheme(): string;

  protected abstract extractMessages(): Message[];
}
```

### Key Interfaces

```typescript
interface PlatformInfo {
  name: string;           // Display name
  platform: Platform;     // Platform ID
  urlPatterns: RegExp[];  // URL matching patterns
}

interface SelectorSet {
  conversationContainer: string;
  messageElement: string;
  userMessage: string;
  assistantMessage: string;
  messageContent: string;
  conversationTitle: string;
  modelIndicator?: string;
  buttonContainer?: string;
  timestamp?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  htmlContent?: string;
  timestamp?: Date;
}
```

## Generation Instructions

### File 1: Selectors Configuration

**Path**: `src/core/parsers/{platform}/selectors.ts`

Generate a TypeScript file that exports the selector set:

```typescript
import { SelectorSet } from '../../types/parser.js';

export const {PLATFORM_UPPER}_SELECTORS: SelectorSet = {
  // Main container
  conversationContainer: '[from analysis]',

  // Message elements
  messageElement: '[from analysis]',
  userMessage: '[from analysis]',
  assistantMessage: '[from analysis]',

  // Content
  messageContent: '[from analysis]',

  // Metadata
  conversationTitle: '[from analysis]',
  modelIndicator: '[from analysis or undefined]',

  // UI injection
  buttonContainer: '[from analysis or undefined]',

  // Optional
  timestamp: '[from analysis or undefined]'
};
```

### File 2: Parser Implementation

**Path**: `src/core/parsers/{platform}/parser.ts`

Generate a complete parser class:

```typescript
import { BaseParser } from '../base-parser.js';
import {
  IParser,
  PlatformInfo,
  ParseResult,
  ParserConfig,
  SelectorSet
} from '../../types/parser.js';
import { Platform, Conversation, QAPair, Message } from '../../types/conversation.js';
import { {PLATFORM_UPPER}_SELECTORS } from './selectors.js';

export class {Platform}Parser extends BaseParser implements IParser {
  readonly platformInfo: PlatformInfo = {
    name: '{Platform Name}',
    platform: '{platform}' as Platform,
    urlPatterns: [/{url pattern regex}/]
  };

  readonly selectors: SelectorSet = {PLATFORM_UPPER}_SELECTORS;

  canParse(): boolean {
    // Check URL pattern
    const matches = this.platformInfo.urlPatterns.some(pattern =>
      pattern.test(window.location.href)
    );

    if (!matches) return false;

    // Verify DOM structure
    const container = document.querySelector(this.selectors.conversationContainer);
    return container !== null;
  }

  getTitle(): string {
    const titleElement = document.querySelector(this.selectors.conversationTitle);

    if (!titleElement?.textContent?.trim()) {
      return '{Platform Name} Conversation';
    }

    return titleElement.textContent.trim();
  }

  getModel(): string | null {
    // If modelIndicator is undefined, return null
    if (!this.selectors.modelIndicator) {
      return null;
    }

    const modelElement = document.querySelector(this.selectors.modelIndicator);
    if (!modelElement?.textContent) return null;

    const text = modelElement.textContent.trim();

    // Platform-specific model name extraction
    // [Add platform-specific parsing logic based on analysis]

    return text || null;
  }

  getButtonInjectionPoint(): HTMLElement | null {
    // If buttonContainer is defined, use it
    if (this.selectors.buttonContainer) {
      return document.querySelector(this.selectors.buttonContainer);
    }

    // Fallback to conversation container
    return document.querySelector(this.selectors.conversationContainer);
  }

  getTheme(): string {
    return '{platform}';
  }

  protected extractMessages(): Message[] {
    const container = document.querySelector(this.selectors.conversationContainer);
    if (!container) return [];

    const messageElements = Array.from(
      container.querySelectorAll(this.selectors.messageElement)
    );

    return messageElements.map((element, index) => {
      // Determine role
      const isUser = element.matches(this.selectors.userMessage);
      const isAssistant = element.matches(this.selectors.assistantMessage);
      const role = isUser ? 'user' : isAssistant ? 'assistant' : 'system';

      // Extract content
      const contentElement = element.querySelector(this.selectors.messageContent);
      const content = contentElement?.textContent?.trim() || '';

      // Extract HTML content for formatting preservation
      const htmlContent = contentElement?.innerHTML || undefined;

      // Extract timestamp if available
      let timestamp: Date | undefined;
      if (this.selectors.timestamp) {
        const timeElement = element.querySelector(this.selectors.timestamp);
        if (timeElement) {
          const datetime = timeElement.getAttribute('datetime') ||
                          timeElement.textContent;
          if (datetime) {
            timestamp = new Date(datetime);
          }
        }
      }

      return {
        id: `msg-${index}`,
        role,
        content,
        htmlContent,
        timestamp
      };
    });
  }
}
```

**Important**:
- Add platform-specific logic in `getModel()` if model extraction requires parsing
- Adjust `extractMessages()` if the platform has unique message structures
- Add error handling for missing elements
- Include comments for complex selector logic

### File 3: Index File

**Path**: `src/core/parsers/{platform}/index.ts`

```typescript
export { {Platform}Parser } from './parser.js';
export { {PLATFORM_UPPER}_SELECTORS } from './selectors.js';
```

### File 4: Test File

**Path**: `tests/unit/core/parsers/{platform}.test.ts`

Generate comprehensive test suite:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { {Platform}Parser } from '../../../src/core/parsers/{platform}/parser.js';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('{Platform}Parser', () => {
  let parser: {Platform}Parser;

  beforeEach(() => {
    // Load captured DOM fixture
    const html = readFileSync(
      join(__dirname, '../../fixtures/dom-snapshots/{platform}/real-capture.html'),
      'utf-8'
    );
    document.body.innerHTML = html;
    parser = new {Platform}Parser();
  });

  describe('canParse', () => {
    it('returns true for {platform} URLs', () => {
      Object.defineProperty(window, 'location', {
        value: { href: 'https://{url pattern}/chat/abc123' },
        writable: true
      });

      expect(parser.canParse()).toBe(true);
    });

    it('returns false for non-{platform} URLs', () => {
      Object.defineProperty(window, 'location', {
        value: { href: 'https://other.com' },
        writable: true
      });

      expect(parser.canParse()).toBe(false);
    });

    it('returns false when conversation container not found', () => {
      document.body.innerHTML = '<div></div>';

      Object.defineProperty(window, 'location', {
        value: { href: 'https://{url pattern}/' },
        writable: true
      });

      expect(parser.canParse()).toBe(false);
    });
  });

  describe('getTitle', () => {
    it('extracts conversation title correctly', () => {
      const title = parser.getTitle();
      expect(title).toBeTruthy();
      expect(title).not.toBe('{Platform Name} Conversation');
    });

    it('returns default title when element not found', () => {
      document.querySelector(parser.selectors.conversationTitle)?.remove();
      const title = parser.getTitle();
      expect(title).toBe('{Platform Name} Conversation');
    });

    it('handles empty title element', () => {
      const titleEl = document.querySelector(parser.selectors.conversationTitle);
      if (titleEl) titleEl.textContent = '   ';

      const title = parser.getTitle();
      expect(title).toBe('{Platform Name} Conversation');
    });
  });

  describe('getModel', () => {
    it('extracts model name when available', () => {
      // Skip if platform doesn't show model
      if (!parser.selectors.modelIndicator) {
        expect(parser.getModel()).toBeNull();
        return;
      }

      const model = parser.getModel();
      // Model might be null if not displayed
      if (model) {
        expect(typeof model).toBe('string');
        expect(model.length).toBeGreaterThan(0);
      }
    });

    it('returns null when model indicator not found', () => {
      if (parser.selectors.modelIndicator) {
        document.querySelector(parser.selectors.modelIndicator)?.remove();
      }

      expect(parser.getModel()).toBeNull();
    });
  });

  describe('parse', () => {
    it('successfully parses conversation', () => {
      const result = parser.parse();

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.conversation).toBeDefined();
    });

    it('extracts messages correctly', () => {
      const result = parser.parse();

      expect(result.conversation).toBeDefined();
      expect(result.conversation!.pairs.length).toBeGreaterThan(0);
    });

    it('identifies user messages correctly', () => {
      const result = parser.parse();
      const pairs = result.conversation!.pairs;

      expect(pairs.length).toBeGreaterThan(0);
      pairs.forEach(pair => {
        expect(pair.question.role).toBe('user');
        expect(pair.question.content).toBeTruthy();
      });
    });

    it('identifies assistant messages correctly', () => {
      const result = parser.parse();
      const pairs = result.conversation!.pairs;

      expect(pairs.length).toBeGreaterThan(0);
      pairs.forEach(pair => {
        expect(pair.answer.role).toBe('assistant');
        expect(pair.answer.content).toBeTruthy();
      });
    });

    it('groups messages into Q&A pairs correctly', () => {
      const result = parser.parse();
      const pairs = result.conversation!.pairs;

      pairs.forEach((pair, index) => {
        expect(pair.index).toBe(index);
        expect(pair.question).toBeDefined();
        expect(pair.answer).toBeDefined();
        expect(pair.id).toBe(`pair-${index}`);
      });
    });

    it('sets platform correctly', () => {
      const result = parser.parse();
      expect(result.conversation!.platform).toBe('{platform}');
    });

    it('sets conversation URL', () => {
      const result = parser.parse();
      expect(result.conversation!.url).toBe(window.location.href);
    });

    it('handles empty conversation', () => {
      const container = document.querySelector(parser.selectors.conversationContainer);
      if (container) {
        container.innerHTML = '';
      }

      const result = parser.parse();

      expect(result.success).toBe(true);
      expect(result.conversation!.pairs).toHaveLength(0);
    });

    it('preserves HTML content when available', () => {
      const result = parser.parse();
      const pairs = result.conversation!.pairs;

      if (pairs.length > 0) {
        const firstAnswer = pairs[0].answer;
        if (firstAnswer.htmlContent) {
          expect(firstAnswer.htmlContent.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('getButtonInjectionPoint', () => {
    it('returns a valid HTML element', () => {
      const point = parser.getButtonInjectionPoint();

      expect(point).not.toBeNull();
      expect(point).toBeInstanceOf(HTMLElement);
    });
  });

  describe('getTheme', () => {
    it('returns platform theme name', () => {
      expect(parser.getTheme()).toBe('{platform}');
    });
  });
});
```

### File 5: Theme CSS

**Path**: `src/ui/themes/{platform}.css`

Generate basic theme file:

```css
/**
 * {Platform Name} Theme
 * Color scheme and styling to match {Platform Name} interface
 */

:root {
  /* {Platform Name} color variables */
  /* TODO: Extract actual colors from platform */
  --{platform}-primary: #000000;
  --{platform}-secondary: #ffffff;
  --{platform}-text: #333333;
  --{platform}-border: #cccccc;
  --{platform}-accent: #0066cc;
}

/* Theme-specific overrides */
.theme-{platform} {
  --primary-color: var(--{platform}-primary);
  --secondary-color: var(--{platform}-secondary);
  --text-color: var(--{platform}-text);
  --border-color: var(--{platform}-border);
  --accent-color: var(--{platform}-accent);
}

/* Platform-specific button positioning */
.theme-{platform} .export-button-container {
  /* TODO: Adjust positioning to match {Platform Name} UI */
}

/* Platform-specific styling adjustments */
.theme-{platform} .export-button {
  /* TODO: Match button style to platform */
}

.theme-{platform} .format-dropdown {
  /* TODO: Match dropdown style to platform */
}

/* TODO: Add more platform-specific styles as needed */
```

### Integration Instructions

Provide step-by-step instructions:

```markdown
## Integration Steps

### 1. Create Parser Files

Create the following files with the generated content:

- `src/core/parsers/{platform}/selectors.ts`
- `src/core/parsers/{platform}/parser.ts`
- `src/core/parsers/{platform}/index.ts`
- `tests/unit/core/parsers/{platform}.test.ts`
- `src/ui/themes/{platform}.css`

### 2. Register Parser

Edit `src/core/parsers/index.ts`:

```typescript
import { ChatGPTParser } from './chatgpt/index.js';
import { ClaudeParser } from './claude/index.js';
import { {Platform}Parser } from './{platform}/index.js'; // Add this

const PARSERS: IParser[] = [
  new ChatGPTParser(),
  new ClaudeParser(),
  new {Platform}Parser() // Add this
];

export function detectParser(): IParser | null {
  return PARSERS.find(p => p.canParse()) || null;
}
```

### 3. Update Platform Type

Edit `src/core/types/conversation.ts`:

```typescript
export type Platform =
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | '{platform}'; // Add this
```

### 4. Update Manifest

Edit `manifests/manifest.base.json`:

```json
{
  "content_scripts": [
    {
      "matches": [
        "*://chat.openai.com/*",
        "*://claude.ai/*",
        "*://{url pattern}/*"  // Add this
      ],
      "js": ["content/content-script.js"],
      "css": ["content/styles.css"]
    }
  ]
}
```

### 5. Create Test Fixture

Ensure you have a DOM fixture:
- `tests/fixtures/dom-snapshots/{platform}/real-capture.html`

### 6. Run Tests

```bash
pnpm test -- {platform}
```

Fix any failing tests by adjusting selectors or parser logic.

### 7. Build and Test

```bash
# Build extension
pnpm build:chrome

# Load in browser
# Chrome: chrome://extensions/ → Load unpacked → dist/chrome

# Test on actual platform
# Navigate to {url pattern}
# Verify export buttons appear
# Test export functionality
```

### 8. Refinement

If tests fail or manual testing reveals issues:

1. **Update selectors** in `selectors.ts`
2. **Adjust parser logic** in `parser.ts`
3. **Update tests** if needed
4. **Recapture DOM** if platform structure changed

### 9. Theme Customization

Update `src/ui/themes/{platform}.css`:

1. Open {Platform Name} in browser
2. Inspect UI colors using DevTools
3. Extract color values
4. Update CSS variables
5. Test visual integration
```

## Output Format

Please provide all files in this structure:

```
FILE: src/core/parsers/{platform}/selectors.ts
---
[File content]
---

FILE: src/core/parsers/{platform}/parser.ts
---
[File content]
---

FILE: src/core/parsers/{platform}/index.ts
---
[File content]
---

FILE: tests/unit/core/parsers/{platform}.test.ts
---
[File content]
---

FILE: src/ui/themes/{platform}.css
---
[File content]
---

INTEGRATION STEPS:
---
[Step-by-step integration instructions]
---
```

## Special Considerations

1. **Error Handling**: Add try-catch blocks for DOM queries that might fail
2. **Dynamic Content**: If platform loads messages dynamically, note this in comments
3. **Model Extraction**: If model name requires parsing, add detailed logic
4. **Edge Cases**: Include comments for handling edge cases identified in analysis
5. **Performance**: Cache expensive DOM queries if possible

## Example Usage

**Input**:
```
Platform ID: gemini
Platform Name: Gemini
URL Pattern: gemini.google.com
Selectors: {
  conversationContainer: 'main.chat-container',
  messageElement: '.message-item',
  userMessage: '.message-item.user',
  assistantMessage: '.message-item.assistant',
  messageContent: '.message-text',
  conversationTitle: 'h1.chat-title',
  modelIndicator: '.model-badge'
}
```

**Output**: Complete implementation files as specified above

## Quality Checklist

Before providing the output, verify:

- [ ] All imports use `.js` extensions (ESM requirement)
- [ ] TypeScript types are correct
- [ ] Selectors match the provided SelectorSet
- [ ] Parser methods are properly implemented
- [ ] Tests cover all public methods
- [ ] Theme CSS follows project structure
- [ ] Integration instructions are complete
- [ ] Code includes helpful comments
- [ ] Error cases are handled
- [ ] Platform-specific logic is documented

## Ready to Generate

Please provide:
1. Platform ID (lowercase)
2. Platform Name (display name)
3. URL Pattern (domain)
4. Selectors (SelectorSet object)

I will generate complete implementation files ready to integrate into the project.
