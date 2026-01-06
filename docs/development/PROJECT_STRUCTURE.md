# Project Structure

This document explains the organization of the AI Chat Exporter repository.

## Directory Organization

### Documentation (`docs/`)

All markdown files (except `README.md`) must be in the `docs/` directory:

- **`docs/`** - User-facing documentation
  - `INSTALLATION.md` - How to install the extension
  - `USAGE.md` - How to use the extension features
  - `README.md` - Documentation index
  - `RELEASING.md` - Release process

- **`docs/development/`** - Development documentation
  - `ARCHITECTURE.md` - Code architecture and design
  - `BUILDING.md` - Build instructions and configuration
  - `TESTING_GUIDE.md` - Testing procedures
  - `ADDING_PARSERS.md` - How to add new chat platform parsers
  - `ADDING_EXPORTERS.md` - How to add new export formats
  - `GITHUB_SETUP.md` - GitHub repository setup
  - `DEVELOPMENT_PLAN.md` - Development roadmap
  - `PROJECT_STRUCTURE.md` - This file
  - `store-listings/` - Store submission materials (Chrome Web Store, Firefox Add-ons)

### Working Directory (`tmp/`)

The `tmp/` directory is for temporary files during development:

- **`tmp/docs/`** - Temporary working documentation
  - Session notes (e.g., `NEXT_SESSION.md`, `START_HERE.md`)
  - Work-in-progress planning documents
  - Debug notes and investigation logs
  - Any documentation that won't be needed after work is complete

- **`tmp/scripts/`** - Temporary scripts
  - One-time utility scripts
  - Testing scripts
  - Migration or transformation scripts

**Important**: The `tmp/` directory is gitignored and can be deleted at any time without affecting the project. Never put permanent files here.

### Source Code (`src/`)

```
src/
├── core/              # Core parsing and export logic
│   ├── parsers/       # Platform-specific parsers (ChatGPT, Claude, etc.)
│   ├── exporters/     # Export format generators (PDF, Markdown, etc.)
│   ├── services/      # Shared services
│   └── types/         # TypeScript type definitions
├── extension/         # Browser extension code
│   ├── background/    # Service worker (background script)
│   ├── content/       # Content scripts injected into pages
│   └── popup/         # Extension popup UI
├── shared/            # Shared utilities
│   ├── i18n/          # Internationalization
│   └── utils/         # Common utilities
└── assets/            # Icons and images
```

### Tests (`tests/`)

```
tests/
├── unit/              # Unit tests
├── integration/       # Integration tests
├── fixtures/          # Test data and fixtures
├── setup/             # Test setup and configuration
└── utils/             # Test utilities
```

### Localization (`_locales/`)

Internationalization files for supported languages:
- `_locales/en/` - English (default)
- `_locales/es/` - Spanish
- `_locales/ca/` - Catalan
- `_locales/de/` - German
- `_locales/fr/` - French
- `_locales/it/` - Italian
- `_locales/pt/` - Portuguese

### Configuration and Build

- **`manifests/`** - Browser extension manifests
  - `manifest.base.json` - Base manifest for all browsers
  - `manifest.chrome.json` - Chrome-specific overrides
  - `manifest.firefox.json` - Firefox-specific overrides

- **`build/`** - Build scripts (gitignored)
  - `vite.chrome.ts` - Chrome build configuration
  - `vite.firefox.ts` - Firefox build configuration
  - `vite.content.ts` - Content script configuration

- **Root configuration files:**
  - `package.json` - Project metadata and dependencies
  - `tsconfig.json` - TypeScript configuration
  - `vitest.config.ts` - Test configuration
  - `eslint.config.js` - Linting rules
  - `.prettierrc` - Code formatting rules

### AI Development Files

- **`.claude/`** - Claude Code configuration
  - `skills/` - Custom Claude Code skills
    - `parser-generator/` - Skill for generating new parsers
    - `exporter-generator/` - Skill for generating new exporters
  - `settings.local.json` - Local settings (gitignored)

- **`.CLAUDE`** - Claude Code instructions and context

## What Goes in the Repository

### Included

- Source code (`src/`)
- Tests (`tests/`)
- Documentation (`docs/`, `README.md`)
- Localization files (`_locales/`)
- Manifests (`manifests/`)
- Configuration files (`package.json`, `tsconfig.json`, etc.)
- AI development files (`.CLAUDE`, `.claude/skills/`)
- License (`LICENSE`)

### Excluded (gitignored)

- Build output (`dist/`, `build/`)
- Dependencies (`node_modules/`)
- Temporary files (`tmp/`)
- IDE settings (`.vscode/`, `.idea/`)
- OS files (`.DS_Store`, `Thumbs.db`)
- Package archives (`*.zip`, `*.crx`, `*.xpi`)
- Test output (`coverage/`, `tests/tmp/`, `tests/output/`)
- Local settings (`.claude/settings.local.json`)

## File Naming Conventions

- **Documentation**: `UPPERCASE.md` (e.g., `INSTALLATION.md`, `ARCHITECTURE.md`)
- **Source code**: `camelCase.ts` or `PascalCase.ts` for classes (e.g., `chatParser.ts`, `PDFExporter.ts`)
- **Test files**: Match source file with `.test.ts` suffix (e.g., `chatParser.test.ts`)
- **Configuration**: lowercase with dots (e.g., `tsconfig.json`, `eslint.config.js`)

## Adding New Files

### Adding Documentation

1. **User documentation** → `docs/FILENAME.md`
2. **Developer documentation** → `docs/development/FILENAME.md`
3. **Temporary notes** → `tmp/docs/FILENAME.md`

### Adding Source Code

1. **Parsers** → `src/core/parsers/PLATFORM_NAME.ts`
2. **Exporters** → `src/core/exporters/FORMAT_NAME.ts`
3. **Services** → `src/core/services/SERVICE_NAME.ts`
4. **Extension code** → `src/extension/COMPONENT/FILE_NAME.ts`
5. **Tests** → `tests/unit/PATH/MATCHING/SOURCE.test.ts`

### Adding Dependencies

```bash
pnpm add PACKAGE_NAME          # Production dependency
pnpm add -D PACKAGE_NAME       # Development dependency
```

Always document why a dependency was added in commit messages.

## Repository Maintenance

### Before Committing

1. Run validation: `pnpm validate`
2. Ensure tests pass: `pnpm test:run`
3. Check types: `pnpm typecheck`
4. Format code: `pnpm lint:fix`

### Clean Up

```bash
# Remove build artifacts
rm -rf dist/ build/

# Clean dependencies (if needed)
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

## Questions About Structure?

- For build-related questions: See [BUILDING.md](BUILDING.md)
- For architecture questions: See [ARCHITECTURE.md](ARCHITECTURE.md)
- For adding features: See [ADDING_PARSERS.md](ADDING_PARSERS.md) or [ADDING_EXPORTERS.md](ADDING_EXPORTERS.md)
