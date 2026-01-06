# Architecture Guide

Technical architecture and design decisions for the AI Chat Exporter extension.

## Overview

Layered architecture with clear separation of concerns:

```
┌─────────────────────────────────────┐
│     Extension Infrastructure        │  Browser APIs, messaging
├─────────────────────────────────────┤
│          UI Layer                   │  Components, themes, injection
├─────────────────────────────────────┤
│         Services Layer              │  Business logic services
├─────────────────────────────────────┤
│          Core Layer                 │  Parsers, exporters, types
└─────────────────────────────────────┘
```

**Key characteristics**: Strict TypeScript, test-driven development, platform-agnostic core logic, minimal dependencies.

## Design Principles

1. **Separation of Concerns**: Core logic has no DOM/browser dependencies, UI handles presentation only, extension manages browser APIs
2. **Dependency Inversion**: Core depends on interfaces, parsers/exporters are pluggable
3. **Single Responsibility**: Each class/module has one clear purpose
4. **Open/Closed**: Extended via new parser/exporter implementations
5. **Type Safety**: Strict TypeScript mode, explicit types on all public APIs

## Architecture Layers

### Layer 1: Core (`src/core/`)

**No DOM or browser dependencies**. Pure TypeScript business logic.

**Types** (`src/core/types/`):
- `conversation.ts` - Message, QAPair, Conversation, Platform
- `parser.ts` - IParser interface, ParseResult, SelectorSet
- `exporter.ts` - IExporter interface, ExportResult, ExportFormat
- `config.ts` - UserPreferences, FilenameVariables

**Parsers** (`src/core/parsers/`):
- `base-parser.ts` - Abstract base with common logic
- `chatgpt/`, `claude/`, `gemini/` - Platform implementations
- `index.ts` - Parser registry

**Exporters** (`src/core/exporters/`):
- `base-exporter.ts` - Abstract base with validation
- `pdf-exporter.ts`, `md-exporter.ts`, `txt-exporter.ts`, `json-exporter.ts`, `docx-exporter.ts`
- `index.ts` - Exporter registry

**Services** (`src/core/services/`):
- `filename-service.ts` - Template-based filename generation
- `selection-service.ts` - Q&A pair selection management

### Layer 2: UI (`src/ui/`)

**Components** (`src/ui/components/`):
Vanilla TypeScript custom elements, self-contained with encapsulated styles:
- `export-button/`, `format-dropdown/`, `print-button/`, `selection-panel/`, `confirmation-modal/`, `toast/`

**Themes** (`src/ui/themes/`):
- `base.css` - Shared variables and base styles
- `chatgpt.css`, `claude.css`, `gemini.css` - Platform-specific styling

**Injection** (`src/ui/injection/`):
- `button-injector.ts` - Injects UI components into platform pages

### Layer 3: Extension (`src/extension/`)

**Content Script** (`src/extension/content/`):
- `content-script.ts` - Detects platform, initializes parser, injects UI, handles export actions

**Background Script** (`src/extension/background/`):
- `service-worker.ts` - Context menus, keyboard shortcuts, tab communication, lifecycle management

**Popup** (`src/extension/popup/`):
- `popup.html`, `popup.ts`, `popup.css` - Display status, quick export, settings access

### Layer 4: Shared (`src/shared/`)

- `constants.ts` - Message types, storage keys, defaults
- `messages.ts` - Message type definitions and type guards
- `storage.ts` - Chrome storage API wrapper

## Core Components

### Parser System

**Abstract Base Class**:
```typescript
abstract class BaseParser implements IParser {
  abstract readonly platformInfo: PlatformInfo;
  abstract readonly selectors: SelectorSet;

  canParse(): boolean {
    // Check URL pattern
  }

  parse(config?: Partial<ParserConfig>): ParseResult {
    // 1. Validate environment
    // 2. Extract messages
    // 3. Group into Q&A pairs
    // 4. Build conversation object
  }

  abstract getTitle(): string;
  abstract getModel(): string | null;
}
```

**Implementation Example**:
```typescript
class ChatGPTParser extends BaseParser {
  readonly platformInfo = {
    name: 'ChatGPT',
    platform: 'chatgpt',
    urlPatterns: [/chat\.openai\.com/]
  };

  readonly selectors: SelectorSet = {
    conversationContainer: 'main',
    messageElement: '[data-message-author-role]',
    // ... platform-specific selectors
  };
}
```

**Registry**:
```typescript
const PARSERS = [new ChatGPTParser(), new ClaudeParser(), new GeminiParser()];

export function detectParser(): IParser | null {
  return PARSERS.find(p => p.canParse()) || null;
}
```

### Exporter System

**Abstract Base Class**:
```typescript
abstract class BaseExporter implements IExporter {
  abstract readonly format: ExportFormat;
  abstract readonly extension: string;
  abstract readonly mimeType: string;

  async export(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<ExportResult> {
    // 1. Validate options
    // 2. Generate content (abstract)
    // 3. Create blob
    // 4. Return result
  }

  protected abstract generateContent(
    conversation: Conversation,
    selectedPairs: QAPair[],
    options: ExportOptions
  ): Promise<string | ArrayBuffer>;
}
```

**Implementation Example**:
```typescript
class MarkdownExporter extends BaseExporter {
  readonly format = 'md' as const;
  readonly extension = 'md';
  readonly mimeType = 'text/markdown';

  protected async generateContent(...): Promise<string> {
    // Generate markdown content
  }
}
```

## Data Flow

### Export Flow

```
User clicks Export → UI Component → Format selected
  → SelectionService (get selected pairs)
  → FilenameService (generate filename)
  → Parser (parsed conversation)
  → Exporter (generate file blob)
  → Browser Downloads API
  → File saved
```

### Parse Flow

```
Content Script loads → Detect platform (URL)
  → Initialize parser
  → Parse DOM (find container, extract messages, group Q&A pairs, extract metadata)
  → Build Conversation object
  → Inject UI components
  → Ready for export
```

### Message Passing Flow

```
Content Script ←→ Background Script ←→ Popup

Content → Background:
  - CONVERSATION_PARSED, EXPORT_STARTED, EXPORT_COMPLETED

Background → Content:
  - EXPORT_CONVERSATION, QUICK_EXPORT

Popup ←→ Background:
  - GET_CONVERSATION_STATUS, EXPORT_REQUEST, CONVERSATION_STATUS
```

## Extension Architecture

### Content Script Lifecycle

```
1. Script injected (URL pattern match)
2. Wait for DOM ready
3. Detect platform via parser registry
4. Parse conversation
5. Inject UI components
6. Set up event listeners
7. Send CONVERSATION_PARSED to background
8. Listen for export commands
```

### Background Script Responsibilities

- Context menus for right-click export
- Keyboard shortcut handlers
- Message routing between content/popup
- Track active conversations across tabs

## Type System

**Conversation Model**:
```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  htmlContent?: string;
  timestamp?: Date;
}

interface QAPair {
  id: string;
  index: number;
  question: Message;
  answer: Message;
  selected: boolean;
}

interface Conversation {
  id: string;
  title: string;
  platform: Platform;
  model?: string;
  pairs: QAPair[];
  url: string;
  createdAt?: Date;
}
```

**Parser Interface**:
```typescript
interface IParser {
  readonly platformInfo: PlatformInfo;
  readonly selectors: SelectorSet;
  canParse(): boolean;
  parse(config?: Partial<ParserConfig>): ParseResult;
  getTitle(): string;
  getModel(): string | null;
  getButtonInjectionPoint(): HTMLElement | null;
  getTheme(): string;
}
```

**Exporter Interface**:
```typescript
interface IExporter {
  readonly format: ExportFormat;
  readonly extension: string;
  readonly mimeType: string;
  export(conversation: Conversation, selectedPairs: QAPair[], options: ExportOptions): Promise<ExportResult>;
  validateOptions(options: ExportOptions): boolean;
}
```

## Testing Strategy

**Unit Tests**: `tests/unit/` - All core logic, Vitest with jsdom, TDD approach

**Fixtures**:
- DOM Snapshots: `tests/fixtures/dom-snapshots/` - Real captures from platforms
- Expected Outputs: `tests/fixtures/expected-outputs/`

**Organization**:
```
tests/
├── unit/
│   ├── core/
│   │   ├── parsers/
│   │   ├── exporters/
│   │   └── services/
├── fixtures/
│   ├── dom-snapshots/
│   └── expected-outputs/
└── utils/
```

## Build System

**Vite Configuration**: Multi-browser builds via `build/vite.chrome.ts` and `build/vite.firefox.ts`

**Build Process**:
```typescript
{
  build: {
    rollupOptions: {
      input: {
        'content-script': 'src/extension/content/content-script.ts',
        'service-worker': 'src/extension/background/service-worker.ts',
        'popup': 'src/extension/popup/popup.ts'
      },
      output: {
        entryFileNames: '[name].js',
        format: 'iife'
      }
    }
  }
}
```

**Output Structure**:
```
dist/
├── chrome/
│   ├── manifest.json
│   ├── content/
│   ├── background/
│   ├── popup/
│   └── icons/
└── firefox/
```

## Design Patterns

1. **Template Method**: `BaseParser.parse()` defines algorithm, subclasses implement steps
2. **Strategy**: Exporters are interchangeable, chosen at runtime
3. **Registry**: Dynamic discovery via `PARSERS` and `EXPORTERS`
4. **Factory**: `detectParser()`, `getExporter(format)` encapsulate creation
5. **Dependency Injection**: Services injected for testing and loose coupling

## Performance Considerations

**Parsing**: Lazy parsing on export request, cache selectors, incremental selection updates

**Export**: Blob URLs for downloads, future: streaming for large files, worker threads

**Memory**: Clean up listeners on navigation, release blob URLs after download

**Startup**: Minimal content script size, defer UI injection until needed

## Browser Compatibility

**Chrome (MV3)**: Full support - service workers, storage, content scripts, action popup

**Firefox (MV3)**: Firefox 109+ support with some API differences handled in code

**Cross-browser**: Avoid browser-specific APIs, use webextension-polyfill where needed

## Security

**CSP**: No `eval()`, no inline scripts, npm dependencies only

**Privacy**: No external requests, no telemetry, all processing local

**Permissions**: Minimal required - activeTab, storage for preferences

## Development Workflow

1. Create feature branch
2. Write tests first (TDD)
3. Implement feature
4. Run linter: `pnpm lint`
5. Run tests: `pnpm test`
6. Build: `pnpm build:chrome` / `pnpm build:firefox`
7. Manual browser test
8. Submit PR
