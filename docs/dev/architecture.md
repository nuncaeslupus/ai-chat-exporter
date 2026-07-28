---
name: architecture
description: Technical architecture and design decisions
metadata:
  category: development
  audience: developers
---

# Architecture Guide

## Overview

Layered architecture with clear separation:

```
Extension Infrastructure → Services → Core (Parsers/Exporters)
```

**Key principles**: Strict TypeScript, platform-agnostic core, dependency inversion, pluggable parsers/exporters.

## Architecture Layers

### Core (`src/core/`)
Platform-agnostic business logic:
- **Types**: Conversation, Message, QAPair, Parser/Exporter interfaces
- **Parsers**: BaseParser + platform implementations (ChatGPT, Claude, Gemini)
- **Exporters**: BaseExporter + format implementations (PDF, MD, TXT, JSON, DOCX, HTML)
- **Services**: FilenameService, SelectionService, ConversationStructureService

### Extension (`src/extension/`)
- **Content**: Platform detection, parser initialization, export handling
- **Background**: Context menus, shortcuts, message routing
- **Popup**: Status display, quick export, settings

### Shared (`src/shared/`)
- Constants, message types, storage wrapper

## Core Patterns

**Parser System**: BaseParser with abstract methods for platform-specific selectors and extraction. Registered parsers detect platform by URL pattern.

**Exporter System**: BaseExporter with format-specific content generation. All exporters work from structured content (paragraphs, code blocks, lists, headings, etc.).

**Structured Content Pipeline**:
```
HTML DOM → Parser → Conversation → StructuredConversation → Exporters → File
```

## Data Flows

**Export**: UI → SelectionService → FilenameService → Parser → Exporter → Download

**Parse**: Content script loads → Detect platform → Parse DOM → Build Conversation → Inject UI

**Messages**: Content ↔ Background ↔ Popup (CONVERSATION_PARSED, EXPORT_REQUEST, etc.)

## Extension Architecture

**Content Script Lifecycle**: Script injected → Wait DOM → Detect platform → Parse → Inject UI → Listen for commands

**Background Script**: Context menus, keyboard shortcuts, message routing, tab tracking

## Type System

See `src/core/types/` for full definitions:
- **Conversation**: Message, QAPair, Conversation, Platform
- **Parser**: IParser interface, PlatformInfo, SelectorSet
- **Exporter**: IExporter interface, ExportFormat, ExportOptions
- **Structured Content**: Rich content types (paragraphs, code, lists, headings, etc.)

## Build & Testing

**Build**: Vite multi-browser builds (Chrome MV3, Firefox MV3), IIFE format for content scripts

**Tests**: Vitest with jsdom, fixtures in `tests/fixtures/`, TDD approach

**Output**: `dist/chrome/` and `dist/firefox/` with merged manifests

## Design Patterns

- **Template Method**: BaseParser/BaseExporter define algorithms
- **Strategy**: Interchangeable parsers/exporters selected at runtime
- **Registry**: `parserRegistry`/`exporterRegistry` `Map`s of factory functions (`src/core/parsers/index.ts`, `src/core/exporters/index.ts`)
- **Factory**: detectParser(), getExporter(format)

## Security & Performance

**Security**: No eval(), no external requests, minimal permissions, local processing only

**Performance**: Lazy parsing, blob URLs, cached selectors, minimal content script size

**Browser Compatibility**: Chrome/Firefox MV3, webextension-polyfill for API differences

For implementation details, see source files in `src/`.
