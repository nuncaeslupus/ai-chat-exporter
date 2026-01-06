# Adding New Parsers

Guide for implementing parsers for new AI chat platforms.

## Overview

A parser extracts conversation data from platform-specific DOM and converts it to normalized `Conversation` data model.

**Required Components:**
1. Selectors - CSS selectors for DOM elements
2. Parser class - Extends `BaseParser`
3. Tests - Unit tests with DOM fixtures
4. Theme - Optional CSS
5. URL Configuration - Must update 6 locations (see Step 9)

**Critical Pitfall:** Forgetting to update URLs in all 6 required locations will break the parser.

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
import { SelectorSet } from '../../types/parser.js';

export const CLAUDE_SELECTORS: SelectorSet = {
  conversationContainer: 'main',
  messageElement: '[data-message-id]',
  userMessage: '[data-role="user"]',
  assistantMessage: '[data-role="assistant"]',
  messageContent: '.message-content',
  conversationTitle: 'header h1',
  modelIndicator: '.model-badge',
  buttonContainer: 'header .actions',
  timestamp: '.message-timestamp'
};
```

### Step 4: Write Tests

Create `tests/unit/core/parsers/{platform}.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeParser } from '../../../src/core/parsers/claude/parser.js';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('ClaudeParser', () => {
  let parser: ClaudeParser;

  beforeEach(() => {
    const html = readFileSync(
      join(__dirname, '../../fixtures/dom-snapshots/claude/real-capture.html'),
      'utf-8'
    );
    document.body.innerHTML = html;
    parser = new ClaudeParser();
  });

  describe('canParse', () => {
    it('returns true for platform URLs', () => {
      Object.defineProperty(window, 'location', {
        value: { href: 'https://claude.ai/chat/abc123' },
        writable: true
      });
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
import { BaseParser } from '../base-parser.js';
import { IParser, PlatformInfo, SelectorSet } from '../../types/parser.js';
import { Platform, Message } from '../../types/conversation.js';
import { CLAUDE_SELECTORS } from './selectors.js';

export class ClaudeParser extends BaseParser implements IParser {
  readonly platformInfo: PlatformInfo = {
    name: 'Claude',
    platform: 'claude' as Platform,
    urlPatterns: [/claude\.ai/]
  };

  readonly selectors: SelectorSet = CLAUDE_SELECTORS;

  canParse(): boolean {
    const matches = this.platformInfo.urlPatterns.some(pattern =>
      pattern.test(window.location.href)
    );
    if (!matches) return false;
    return document.querySelector(this.selectors.conversationContainer) !== null;
  }

  getTitle(): string {
    const elem = document.querySelector(this.selectors.conversationTitle);
    return elem?.textContent?.trim() || 'Claude Conversation';
  }

  getModel(): string | null {
    const elem = document.querySelector(this.selectors.modelIndicator);
    if (!elem?.textContent) return null;
    const match = elem.textContent.trim().match(/claude[- ]?3?[- ]?(opus|sonnet|haiku)/i);
    return match ? match[0].toLowerCase().replace(/\s+/g, '-') : null;
  }

  getButtonInjectionPoint(): HTMLElement | null {
    return document.querySelector(this.selectors.buttonContainer);
  }

  getTheme(): string {
    return 'claude';
  }

  protected extractMessages(): Message[] {
    const container = document.querySelector(this.selectors.conversationContainer);
    if (!container) return [];

    const messageElements = Array.from(
      container.querySelectorAll(this.selectors.messageElement)
    );

    return messageElements.map((element, index) => {
      const role = element.matches(this.selectors.userMessage) ? 'user' :
                   element.matches(this.selectors.assistantMessage) ? 'assistant' : 'system';

      const contentElement = element.querySelector(this.selectors.messageContent);
      const content = contentElement?.textContent?.trim() || '';
      const htmlContent = contentElement?.innerHTML || undefined;

      const timestampElement = element.querySelector(this.selectors.timestamp);
      const timestamp = timestampElement
        ? new Date(timestampElement.getAttribute('datetime') || '')
        : undefined;

      return { id: `msg-${index}`, role, content, htmlContent, timestamp };
    });
  }
}
```

### Step 6: Create Index

Create `src/core/parsers/{platform}/index.ts`:

```typescript
export { ClaudeParser } from './parser.js';
export { CLAUDE_SELECTORS } from './selectors.js';
```

### Step 7: Register Parser

Update `src/core/parsers/index.ts`:

```typescript
import { ChatGPTParser } from './chatgpt/index.js';
import { ClaudeParser } from './claude/index.js'; // Add
import { IParser } from '../types/parser.js';

const PARSERS: IParser[] = [
  new ChatGPTParser(),
  new ClaudeParser() // Add
];

export function detectParser(): IParser | null {
  return PARSERS.find(p => p.canParse()) || null;
}

export function getParserByPlatform(platform: string): IParser | null {
  return PARSERS.find(p => p.platformInfo.platform === platform) || null;
}
```

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

**CRITICAL:** Update URLs in 6 locations:

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

#### 9.4: src/extension/popup/popup.ts (2 places)

```typescript
// supportedDomains array (around line 172)
const supportedDomains = [
  'chat.openai.com',
  'chatgpt.com',
  'claude.ai',
];

// getUrlsForPlatform function (around line 27)
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
    const element = document.querySelector(this.selectors.conversationTitle);
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
    this._container = document.querySelector(this.selectors.conversationContainer);
  }
  return this._container;
}
```

## Troubleshooting

**Parser not detected:**
1. Check URL pattern in `platformInfo.urlPatterns`
2. Verify `conversationContainer` selector
3. Verify ALL 6 URL configuration locations updated
4. Rebuild: `pnpm build`
5. Reload extension and refresh page

**Extension not in popup:**
1. Verify parser registered in `src/core/parsers/index.ts`
2. Check `supportedDomains` and `getUrlsForPlatform` in popup.ts
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
- [ ] Parser registered in `src/core/parsers/index.ts`
- [ ] URLs updated in ALL 6 locations:
  - [ ] `manifests/manifest.base.json` (host_permissions)
  - [ ] `manifests/manifest.base.json` (content_scripts matches)
  - [ ] `manifests/manifest.chrome.json` (web_accessible_resources)
  - [ ] `manifests/manifest.firefox.json` (web_accessible_resources)
  - [ ] `src/extension/popup/popup.ts` (supportedDomains)
  - [ ] `src/extension/popup/popup.ts` (getUrlsForPlatform)
- [ ] Theme CSS created (optional)
- [ ] Manual testing completed

## Reference

See ChatGPT parser implementation:
- `src/core/parsers/chatgpt/selectors.ts`
- `src/core/parsers/chatgpt/parser.ts`
- `tests/unit/core/parsers/chatgpt.test.ts`
