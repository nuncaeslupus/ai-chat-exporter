---
name: building
description: Build instructions for development and production
metadata:
  category: development
  audience: developers
---

# Building the Extension

## Prerequisites

- Node.js >= 22.0.0
- **pnpm**: Version 10.27.0

```bash
npm install -g pnpm@10.27.0
```

## Quick Commands

```bash
pnpm install          # Install dependencies

# Development (watch mode)
pnpm dev              # Alias for dev:chrome
pnpm dev:chrome       # Chrome only
pnpm dev:firefox      # Firefox only

# Production build
pnpm build            # Both browsers
pnpm build:chrome     # Chrome only
pnpm build:firefox    # Firefox only

# Package for release
pnpm package:all      # Creates versioned .zip files in dist/

# Testing
pnpm test             # Watch mode
pnpm test:run         # Run once
pnpm test:coverage    # With coverage

# Quality
pnpm lint             # Check style
pnpm lint:fix         # Fix style
pnpm typecheck        # Check types
pnpm validate         # lint + format:check + typecheck + coverage + build
```

## Makefile

A `Makefile` wraps the common commands above (`make install`, `make dev`,
`make build`, `make test`, `make lint`, `make typecheck`, `make package`,
`make clean`). Two targets are not 1:1 aliases:

- `make dev` runs `pnpm dev:chrome` (not the `pnpm dev` alias).
- `make validate` runs `pnpm lint`, `pnpm format:check`, the `check-release`
  version/node/pipeline/permissions checks, `pnpm typecheck`,
  `pnpm test:coverage`, and the `check-release` manifest check — it mirrors
  what CI's `validate` job actually runs.

`make release-check` runs `validate` + `package` — everything a release needs
to be green.

## Load in Browser

**Chrome**: `chrome://extensions/` → Enable Developer mode → Load unpacked → Select `dist/chrome/`

**Firefox**: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → Select any file in `dist/firefox/`

## Build Output

```
dist/
├── chrome/           # Unpacked Chrome extension
├── firefox/          # Unpacked Firefox extension
└── *.zip             # Packaged extensions (versioned filenames)
```

## Version Management

**Important**: Only change version for releases.

Version must match in **both** files:
- `package.json`
- `manifests/manifest.base.json`

Follow semantic versioning (MAJOR.MINOR.PATCH).

## Troubleshooting

**Build fails**: `rm -rf node_modules pnpm-lock.yaml && pnpm install`

**Extension doesn't load**: Check manifest.json validity, browser console

**Changes not appearing**: Reload extension in browser, hard refresh page (Ctrl+Shift+R)

See [architecture.md](architecture.md) for architecture details and [releasing.md](releasing.md) for release process.
