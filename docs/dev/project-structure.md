---
name: project-structure
description: Organization of the AI Chat Exporter repository
metadata:
  category: development
  audience: developers
---

# Project Structure

## Directory Organization

### Documentation (`docs/`)
- **`docs/`** - User documentation (installation.md, usage.md, README.md)
- **`docs/dev/`** - Development documentation (architecture, building, etc.)
- **`docs/store-listings/`** - Store submission materials (plain text .txt files)

### Source Code (`src/`)
```
src/
├── core/              # Parsers, exporters, services, types
├── extension/         # Background, content, popup
├── ui/                # Components, themes, injection
├── shared/            # Constants, messages, storage
└── assets/            # Icons and images
```

### Tests (`tests/`)
```
tests/
├── unit/              # Unit tests
├── integration/       # Integration tests
├── fixtures/          # Test data
└── utils/             # Test utilities
```

### Localization (`_locales/`)
Supported languages: en, es, ca, de, fr, it, pt

### Configuration
- **`manifests/`** - Browser extension manifests (base, chrome, firefox)
- **`build/`** - Build scripts (gitignored)
- **Root**: package.json, tsconfig.json, vitest.config.ts, eslint.config.js

### AI Development
- **`.agents/`** - Agent skills (parser-generator, exporter-generator)
- **`CLAUDE.md`** - Claude Code instructions

## File Naming

- **Documentation**: lowercase-with-dashes.md (except README.md, CLAUDE.md)
- **Source code**: camelCase.ts or PascalCase.ts for classes
- **Tests**: Match source file with .test.ts suffix
- **Store listings**: Plain text .txt format

## What's Included/Excluded

**Included**: src/, tests/, docs/, _locales/, manifests/, config files, AI files, LICENSE

**Excluded (gitignored)**: dist/, build/, node_modules/, tmp/, IDE settings, test output

## Quick Actions

**Add documentation**:
- User docs → `docs/filename.md`
- Dev docs → `docs/dev/filename.md`

**Add source code**:
- Parsers → `src/core/parsers/PLATFORM/`
- Exporters → `src/core/exporters/`
- Tests → `tests/unit/PATH/MATCHING/SOURCE.test.ts`

**Before committing**: `pnpm validate`

See [architecture.md](architecture.md), [building.md](building.md), [adding-parsers.md](adding-parsers.md), [adding-exporters.md](adding-exporters.md) for details.
