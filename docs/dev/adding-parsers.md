---
name: adding-parsers
description: Guide for implementing parsers for new AI chat platforms
metadata:
  category: development
  audience: developers
---

# Adding New Parsers

Guide for implementing parsers for new AI chat platforms.

## Overview

A parser extracts conversation data from platform-specific DOM and converts it to normalized `Conversation` data model.

**Required Components:**
1. Selectors - CSS selectors for DOM elements
2. Parser class - Extends `BaseParser`
3. Tests - Unit tests with DOM fixtures
4. Theme - Optional CSS
5. URL Configuration - Must update 5 locations (see Step 9)

**Critical Pitfall:** Forgetting to update URLs in all 5 required locations will break the parser.

## Prerequisites

```bash
git clone https://github.com/nuncaeslupus/ai-chat-exporter.git
cd ai-chat-exporter
pnpm install && pnpm test && pnpm dev:chrome
```

Read `src/core/parsers/base-parser.ts` to understand the base class.

## Implementation Steps

### Step 1: Capture Platform DOM

**Using capture script:**
1. Navigate to platform, open console (F12)
2. Load `tmp/capture-chatgpt-dom.js`
3. Run: `captureConversationDOM('platform-name')`
4. Save to `tests/fixtures/dom-snapshots/{platform}/real-capture.html`

**Manual:** Inspect conversation container → Right-click → Copy outerHTML → Save to fixture

### Step 2: Analyze DOM Structure

Identify:
- Conversation container - Main wrapper
- Message elements - Individual containers
- Role identification - User vs assistant (data attrs, classes, structure)
- Message content - Text/markdown
- Metadata - Title, model, timestamps

### Step 3: Create Selectors

Create `src/core/parsers/{platform}/selectors.ts`:

```typescript
import type { SelectorSet } from '../../types';

export const CLAUDE_SELECTORS: SelectorSet = {
  conversationContainer: 'main',
  messageElement: '[data-message-id]',
  userMessage: '[data-role="user"]',
  assistantMessage: '[data-role="assistant"]',
  messageContent: '.message-content',
  conversationTitle: 'header h1',
  modelIndicator: '.model-badge',
  // Anything that isn't one of the fixed SelectorSet fields above
  // (button injection point, timestamps, etc.) goes in `custom`.
  custom: {
    buttonArea: 'header .actions',
    timestamp: '.message-timestamp',
  },
};
```

`SelectorSet` only declares `conversationContainer`, `messageElement`, `userMessage`,
`assistantMessage`, `messageContent`, `conversationTitle?`, `modelIndicator?`, and
`custom?: Record<string, string>` — there is no top-level `buttonContainer` or
`timestamp` field, so platform-specific selectors like those must live under `custom`.

### Step 4: Write Tests

Create `tests/unit/core/parsers/{platform}.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { ClaudeParser } from '../../../src/core/parsers/claude/parser';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('ClaudeParser', () => {
  let parser: ClaudeParser;

  beforeEach(() => {
    const html = readFileSync(
      join(__dirname, '../../fixtures/dom-snapshots/claude/real-capture.html'),
      'utf-8'
    );
    // JSDOM (not the global `document`) so the fixture's own URL drives
    // canParse() — the parser reads it via this.getUrl(), never window.location.
    const dom = new JSDOM(html, { url: 'https://claude.ai/chat/abc123' });
    const document = dom.window.document as unknown as Document;
    parser = new ClaudeParser(document);
  });

  describe('canParse', () => {
    it('returns true for platform URLs', () => {
      // URL is already set to https://claude.ai/chat/abc123 in beforeEach.
      expect(parser.canParse()).toBe(true);
    });
  });

  describe('parse', () => {
    it('parses messages correctly', () => {
      const result = parser.parse();
      expect(result.success).toBe(true);
      expect(result.conversation!.pairs.length).toBeGreaterThan(0);
    });

    it('identifies roles correctly', () => {
      const result = parser.parse();
      const firstPair = result.conversation!.pairs[0];
      expect(firstPair.question.role).toBe('user');
      expect(firstPair.answer.role).toBe('assistant');
    });
  });
});
```

### Step 5: Implement Parser

Create `src/core/parsers/{platform}/parser.ts`:

```typescript
import type { PlatformInfo, ParserConfig, QAPair, Message } from '../../types';
import { BaseParser } from '../base-parser';
import { CLAUDE_SELECTORS } from './selectors';

export class ClaudeParser extends BaseParser {
  readonly platformInfo: PlatformInfo = {
    id: 'claude',
    name: 'Claude',
    urlPatterns: [/^https?:\/\/(www\.)?claude\.ai/],
  };

  readonly selectors = CLAUDE_SELECTORS;

  canParse(): boolean {
    const matches = this.platformInfo.urlPatterns.some(pattern =>
      pattern.test(this.getUrl())
    );
    if (!matches) return false;
    return this.document.querySelector(this.selectors.conversationContainer) !== null;
  }

  getTitle(): string {
    const elem = this.document.querySelector(this.selectors.conversationTitle ?? '');
    return elem?.textContent?.trim() || 'Claude Conversation';
  }

  getModel(): string | null {
    const elem = this.document.querySelector(this.selectors.modelIndicator ?? '');
    if (!elem?.textContent) return null;
    const match = elem.textContent.trim().match(/claude[- ]?3?[- ]?(opus|sonnet|haiku)/i);
    return match ? match[0].toLowerCase().replace(/\s+/g, '-') : null;
  }

  getButtonInjectionPoint(): HTMLElement | null {
    const selector = this.selectors.custom?.buttonArea;
    return selector ? this.document.querySelector(selector) : null;
  }

  /**
   * Extract Q&A pairs from the DOM. `platformInfo`, `canParse()`,
   * `getTitle()`/`getModel()`/`getButtonInjectionPoint()`, and `parse()` are
   * either abstract members BaseParser requires or public API it already
   * implements for you (`getTheme()`, `getUrl()`, `parse()`) — the one piece
   * every parser must supply itself is `extractQAPairs()`.
   */
  protected extractQAPairs(config: ParserConfig): QAPair[] {
    const container = this.document.querySelector(this.selectors.conversationContainer);
    if (!container) return [];

    const messageElements = Array.from(
      container.querySelectorAll(this.selectors.messageElement)
    );

    const messages: Message[] = messageElements.map((element, index) => {
      const role = element.matches(this.selectors.userMessage)
        ? 'user'
        : element.matches(this.selectors.assistantMessage)
          ? 'assistant'
          : 'system';

      const contentElement = element.querySelector(this.selectors.messageContent);
      const { content, htmlContent } = this.extractContent(
        contentElement ?? element,
        config.preserveHtml
      );

      return this.createMessage(role, content, htmlContent, `msg-${index}`);
    });

    // Pair up consecutive user/assistant messages using the base class's
    // createQAPair() helper (it also stamps a generated id).
    const pairs: QAPair[] = [];
    for (let i = 0; i + 1 < messages.length; i += 2) {
      const question = messages[i];
      const answer = messages[i + 1];
      if (question && answer) {
        pairs.push(this.createQAPair(pairs.length, question, answer));
      }
    }

    return pairs;
  }
}
```

Note what is **not** in this class: there is no custom constructor (the
`BaseParser` constructor already accepts `(document: Document, config?)` and
stores both), and `getTheme()` is not overridden (the base implementation
returns `this.platformInfo.id`, which is exactly `'claude'` here) — only
override it if a platform's theme name needs to differ from its platform id.

### Step 6: Create Index

Create `src/core/parsers/{platform}/index.ts`:

```typescript
export { ClaudeParser } from './parser';
export { CLAUDE_SELECTORS } from './selectors';
```

### Step 7: Register Parser

Update `src/core/parsers/index.ts` in two places — the registry map and the
`createParserForDocument()` switch:

```typescript
import type { Platform, ParserFactory, ParserRegistry } from '../types';
import { ChatGPTParser } from './chatgpt';
import { ClaudeParser } from './claude'; // Add
import { GeminiParser } from './gemini';

export const parserRegistry: ParserRegistry = new Map<Platform, ParserFactory>([
  ['chatgpt', () => new ChatGPTParser(document)],
  ['claude', () => new ClaudeParser(document)], // Add
  ['gemini', () => new GeminiParser(document)],
]);

export function getParser(platform: Platform): ReturnType<ParserFactory> | null {
  const factory = parserRegistry.get(platform);
  return factory ? factory() : null;
}

export function detectParser(doc: Document = document): ReturnType<ParserFactory> | null {
  for (const [platform] of parserRegistry) {
    const parser = createParserForDocument(platform, doc);
    if (parser?.canParse()) {
      return parser;
    }
  }
  return null;
}

export function createParserForDocument(
  platform: Platform,
  doc: Document
): ReturnType<ParserFactory> | null {
  switch (platform) {
    case 'chatgpt':
      return new ChatGPTParser(doc);
    case 'claude':
      return new ClaudeParser(doc); // Add
    case 'gemini':
      return new GeminiParser(doc);
    default:
      return null;
  }
}
```

There is no `PARSERS` array and no `getParserByPlatform()` — the registry is a
`Map<Platform, ParserFactory>` (`parserRegistry`), platform detection goes
through `detectParser(doc?)`, and a specific platform's parser is fetched with
`getParser(platform)` (bound to the live `document`) or
`createParserForDocument(platform, doc)` (for an arbitrary `Document`, e.g. in
tests).

### Step 8: Create Theme (Optional)

Create `src/ui/themes/{platform}.css`:

```css
:root {
  --claude-primary: #c17a5f;
  --claude-secondary: #f4f0e8;
  --claude-text: #2d2d2d;
  --claude-border: #d4c5b9;
}

.theme-claude {
  --primary-color: var(--claude-primary);
  --secondary-color: var(--claude-secondary);
  --text-color: var(--claude-text);
  --border-color: var(--claude-border);
}
```

### Step 9: Update URL Configuration

**CRITICAL:** Update URLs in 5 locations:

#### 9.1: manifests/manifest.base.json (2 places)

```json
{
  "host_permissions": [
    "https://chat.openai.com/*",
    "https://claude.ai/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://chat.openai.com/*",
        "https://claude.ai/*"
      ],
      "js": ["content/content-script.js"],
      "css": ["content/styles.css"]
    }
  ]
}
```

#### 9.2: manifests/manifest.chrome.json

```json
{
  "web_accessible_resources": [
    {
      "resources": ["assets/*"],
      "matches": ["https://chat.openai.com/*", "https://claude.ai/*"]
    }
  ]
}
```

#### 9.3: manifests/manifest.firefox.json

```json
{
  "web_accessible_resources": [
    {
      "resources": ["assets/*"],
      "matches": ["https://chat.openai.com/*", "https://claude.ai/*"]
    }
  ]
}
```

#### 9.4: src/extension/popup/popup.ts

There is a single spot to touch here — the `getUrlsForPlatform()` switch
(around line 22). It is the only per-platform domain list in the file: the
popup's "supported platforms" display and its `supportedDomains` activeTab
check both derive their domains from `parserRegistry` at runtime
(`[...parserRegistry.keys()].flatMap(getUrlsForPlatform)`), so registering the
parser in Step 7 is what makes the new platform show up in both places —
`getUrlsForPlatform` just needs to know which domains that platform's id maps to:

```typescript
function getUrlsForPlatform(platform: string): string[] {
  switch (platform) {
    case 'chatgpt':
      return ['chat.openai.com', 'chatgpt.com'];
    case 'claude':
      return ['claude.ai'];
    default:
      return [];
  }
}
```

### Step 10: Run Tests

```bash
pnpm test
pnpm test -- claude
```

### Step 11: Manual Testing

```bash
pnpm build:chrome
```

Load in browser: `chrome://extensions/` → Load unpacked → `dist/chrome`

## Common Challenges

### 1. Role Identification

Try multiple signals:
```typescript
private getMessageRole(element: Element): 'user' | 'assistant' {
  // Data attribute
  const dataRole = element.getAttribute('data-role');
  if (dataRole) return dataRole as 'user' | 'assistant';

  // Class names
  if (element.classList.contains('user-message')) return 'user';
  if (element.classList.contains('assistant-message')) return 'assistant';

  // Avatar position
  const avatar = element.querySelector('.avatar');
  if (avatar?.classList.contains('avatar-left')) return 'assistant';
  if (avatar?.classList.contains('avatar-right')) return 'user';

  return 'user';
}
```

### 2. Code Block Preservation

```typescript
private extractHtmlContent(element: Element): string | undefined {
  const contentEl = element.querySelector(this.selectors.messageContent);
  if (!contentEl) return undefined;

  const clone = contentEl.cloneNode(true) as Element;
  clone.querySelectorAll('button, .ui-element').forEach(el => el.remove());
  return clone.innerHTML;
}
```

### 3. Special Turn Types (Canvas/Images/Artifacts)

Handle special content types (ChatGPT Canvas, DALL-E images, Claude Artifacts):

```typescript
private extractAssistantMessages(config: ParserConfig): Message[] {
  const messages: Message[] = [];
  const assistantTurns = this.document.querySelectorAll('article[data-turn="assistant"]');

  assistantTurns.forEach((turn) => {
    const messageElement = turn.querySelector('[data-message-author-role="assistant"]');

    if (messageElement) {
      // Normal text response
      const message = this.extractAssistantMessage(messageElement, config);
      if (message) messages.push(message);
    } else {
      // Special turn type (canvas/image-gen)
      const message = this.extractAssistantMessage(turn, config);
      if (message) messages.push(message);
    }
  });

  return messages;
}

private extractCanvasContent(element: Element): { text: string; html: string } | null {
  const canvasElement = element.querySelector('[id^="textdoc-message-"]');
  if (!canvasElement) return null;

  const proseMirrorContent = canvasElement.querySelector('.ProseMirror, .prose');
  if (!proseMirrorContent) return null;

  const text = proseMirrorContent.textContent?.trim() || '';
  const html = proseMirrorContent.innerHTML || '';

  return text ? {
    text: `[Canvas Content]\n${text}`,
    html: `<div class="canvas-content">${html}</div>`
  } : null;
}

private extractGeneratedImage(element: Element): { src: string; alt?: string } | null {
  const imageGenContainer = element.querySelector('.group\\/imagegen-image, [class*="imagegen"]');
  if (!imageGenContainer) return null;

  const img = imageGenContainer.querySelector('img');
  if (!img?.getAttribute('src')) return null;

  return {
    src: img.getAttribute('src')!,
    alt: img.getAttribute('alt') || 'Generated image',
  };
}
```

**Key principles:**
1. Use turn-level selectors, not just message selectors
2. Check for special content first before extracting normal text
3. Store images in `message.metadata.images` array
4. Use descriptive placeholders like `[Canvas Content]` or `[Image: Title]`

## Best Practices

### Selector Robustness
```typescript
conversationContainer: 'main, #conversation, [role="main"]'
```

### Error Handling
```typescript
getTitle(): string {
  try {
    const element = this.document.querySelector(this.selectors.conversationTitle ?? '');
    return element?.textContent?.trim() || 'Untitled Conversation';
  } catch (error) {
    console.error('Error extracting title:', error);
    return 'Untitled Conversation';
  }
}
```

### Performance Caching
```typescript
private _container: HTMLElement | null = null;

private getContainer(): HTMLElement | null {
  if (!this._container) {
    this._container = this.document.querySelector(this.selectors.conversationContainer);
  }
  return this._container;
}
```

## Troubleshooting

**Parser not detected:**
1. Check URL pattern in `platformInfo.urlPatterns`
2. Verify `conversationContainer` selector
3. Verify ALL 5 URL configuration locations updated
4. Rebuild: `pnpm build`
5. Reload extension and refresh page

**Extension not in popup:**
1. Verify parser registered in `src/core/parsers/index.ts` (`parserRegistry` + `createParserForDocument()`)
2. Check `getUrlsForPlatform` in popup.ts
3. Rebuild and reload

**Messages not extracted:**
1. Verify `messageElement` selector matches
2. Check console for errors
3. Inspect actual DOM structure
4. Update selectors

## Checklist

- [ ] DOM capture saved to `tests/fixtures/dom-snapshots/{platform}/`
- [ ] Selectors file created
- [ ] Parser class implemented
- [ ] Tests written and passing
- [ ] Parser registered in `src/core/parsers/index.ts` (registry map + `createParserForDocument()` switch)
- [ ] URLs updated in ALL 5 locations:
  - [ ] `manifests/manifest.base.json` (host_permissions)
  - [ ] `manifests/manifest.base.json` (content_scripts matches)
  - [ ] `manifests/manifest.chrome.json` (web_accessible_resources)
  - [ ] `manifests/manifest.firefox.json` (web_accessible_resources)
  - [ ] `src/extension/popup/popup.ts` (`getUrlsForPlatform`)
- [ ] Theme CSS created (optional)
- [ ] Manual testing completed

## Reference

See ChatGPT parser implementation:
- `src/core/parsers/chatgpt/selectors.ts`
- `src/core/parsers/chatgpt/parser.ts`
- `tests/unit/core/parsers/chatgpt.test.ts`
