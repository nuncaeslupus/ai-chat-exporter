# Workflow Guide

This document describes the workflow and conventions for working on AI Chat Exporter.

## Documentation Structure

```
docs/
├── README.md                    # Documentation index
├── PRIVACY.md                   # Privacy policy
├── installation.md              # User installation guide
├── usage.md                     # User usage guide
├── release-notes-v{VERSION}.txt # Release notes (plain text)
├── dev/                         # Development documentation
│   ├── architecture.md
│   ├── building.md
│   ├── testing-guide.md
│   ├── adding-parsers.md
│   ├── adding-exporters.md
│   ├── project-structure.md
│   ├── github-setup.md
│   ├── development-plan.md
│   ├── documentation-guide.md
│   ├── parser-gotchas.md
│   └── releasing.md
└── store-listings/              # Store submission files
    ├── chrome-web-store-v{VERSION}.txt
    └── firefox-addons-v{VERSION}.txt
```

## File Naming Conventions

- **Documentation files**: `lowercase-with-dashes.md` (e.g., `adding-parsers.md`)
- **Exception**: `README.md` stays uppercase
- **Store listings**: Plain text `.txt` format (not markdown)
- **Release notes**: Plain text `.txt` format
- **Dist files**: `ai-chat-exporter-v{VERSION}-{browser}.zip`

## Store Listing Guidelines

**IMPORTANT**: Chrome Web Store flags "spammy text" for repetitive format listings.

✅ **DO**:
- Use concise format lists: "PDF, Markdown, Word and other formats"
- Use friendly names: "Word" instead of "DOCX", "Plain text" instead of "TXT"
- Keep descriptions brief and varied

❌ **DON'T**:
- List all 6 formats individually with descriptions
- Repeat format names excessively
- Use technical abbreviations (DOCX, TXT, JSON)

## Release Workflow

See [releasing.md](releasing.md) for detailed release process.

**Quick steps**:
1. Update version in `package.json` and `manifests/manifest.base.json`
2. Run `pnpm build && pnpm package:all` to build and package
3. Create store listing files in `docs/store-listings/`
4. Test the packages
5. Submit to stores

## Git Workflow

### Making Commits

Follow conventional commit format:
- `feat:` - New features
- `feat(scope):` - Scoped features
- `docs:` - Documentation changes
- `chore:` - Version bumps, maintenance
- `fix:` - Bug fixes

### Creating Pull Requests

1. Create a feature/release branch
2. Make commits following conventions
3. Push to remote
4. Create PR with descriptive summary
5. Include test plan in PR description

## Development Commands

```bash
# Install dependencies
pnpm install

# Build for development
pnpm dev              # Alias for dev:chrome (watch mode)
pnpm dev:chrome       # Chrome only
pnpm dev:firefox      # Firefox only

# Build for production
pnpm build            # Both browsers
pnpm build:chrome     # Chrome only
pnpm build:firefox    # Firefox only

# Package for release
pnpm package:all      # Creates versioned zip files

# Testing
pnpm test             # Run tests in watch mode
pnpm test:run         # Run tests once
pnpm test:coverage    # Run with coverage

# Validation
pnpm validate         # lint + format:check + typecheck + coverage + build
```

## Working with AI Assistants

When working with AI assistants (like Claude):

1. **Be specific** about file paths and changes needed
2. **Review changes** before committing
3. **Test thoroughly** after AI-generated changes
4. **Document decisions** in commit messages
5. **Use conventional commits** for clarity

## Key Principles

1. **User docs in `docs/`** - Installation, usage guides
2. **Dev docs in `docs/dev/`** - Architecture, development guides
3. **Lowercase filenames** - Except README.md
4. **Plain text for stores** - No markdown in store listings
5. **Concise store listings** - Avoid "spammy text" flags
6. **Semantic versioning** - MAJOR.MINOR.PATCH
7. **Test before release** - Always validate builds

## Quick Reference

- **Documentation index**: [../README.md](../README.md)
- **Release process**: [releasing.md](releasing.md)
- **Project structure**: [project-structure.md](project-structure.md)
- **Building**: [building.md](building.md)
