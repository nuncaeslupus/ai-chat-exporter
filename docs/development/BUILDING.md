# Building the Extension

This guide explains how to build AI Chat Exporter for development and production.

## Prerequisites

- **Node.js**: Version 18.0.0 or higher
- **pnpm**: Version 10.27.0

Install pnpm if you don't have it:
```bash
npm install -g pnpm@10.27.0
```

## Quick Start

### Install Dependencies

```bash
pnpm install
```

### Development Build (with watch mode)

```bash
# Build both Chrome and Firefox, watch for changes
pnpm dev

# Or build specific browser
pnpm dev:chrome
pnpm dev:firefox
```

### Production Build

```bash
# Build both browsers for production
pnpm build

# Or build specific browser
pnpm build:chrome
pnpm build:firefox
```

## Testing a Build

When you need to test changes in the browser:

### Quick Test Build

```bash
# Build and package everything for testing
pnpm build:test
```

This creates:
- `dist/ai-chat-exporter-chrome-v{VERSION}.zip` - Chrome extension
- `dist/ai-chat-exporter-firefox-v{VERSION}.zip` - Firefox extension
- `dist/ai-chat-exporter-source-v{VERSION}.zip` - Source code (for Firefox review)

### Load in Browser

**Chrome:**
1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select `dist/chrome/` directory (or upload the .zip)

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select any file in `dist/firefox/` directory (or the .zip)

## Build Output

### Directory Structure

```
dist/
├── chrome/              # Chrome extension (unpacked)
│   ├── manifest.json
│   ├── background/
│   ├── content/
│   ├── popup/
│   └── assets/
├── firefox/             # Firefox extension (unpacked)
│   ├── manifest.json    # (with Firefox-specific overrides)
│   ├── background/
│   ├── content/
│   ├── popup/
│   └── assets/
└── *.zip                # Packaged extensions
```

### Package Versions

Packages are named with version numbers from `package.json`:
- `ai-chat-exporter-chrome-v1.0.0.zip`
- `ai-chat-exporter-firefox-v1.0.0.zip`
- `ai-chat-exporter-source-v1.0.0.zip`

## Available Scripts

### Development

```bash
pnpm dev              # Watch mode: build both browsers on file changes
pnpm dev:chrome       # Watch mode: Chrome only
pnpm dev:firefox      # Watch mode: Firefox only
```

### Production

```bash
pnpm build            # Build both browsers for production
pnpm build:chrome     # Build Chrome only
pnpm build:firefox    # Build Firefox only
```

### Testing

```bash
pnpm test             # Run tests in watch mode
pnpm test:run         # Run tests once
pnpm test:coverage    # Run tests with coverage report
```

### Quality Checks

```bash
pnpm lint             # Check code style
pnpm lint:fix         # Fix code style issues
pnpm typecheck        # Check TypeScript types
pnpm validate         # Run lint + typecheck + tests
```

### Packaging

```bash
pnpm package:chrome   # Package Chrome extension (no version in filename)
pnpm package:firefox  # Package Firefox extension (no version in filename)
pnpm package:source   # Package source code (no version in filename)
pnpm build:test       # Build + package all with versioned filenames
```

## Build Process Details

### What Happens During Build

1. **TypeScript Compilation**:
   - Source files in `src/` are compiled to JavaScript
   - Type checking is performed

2. **Bundling**:
   - Vite bundles the code and dependencies
   - Code is minified for production builds
   - Source maps are generated (dev builds only)

3. **Manifest Processing**:
   - Base manifest (`manifests/manifest.base.json`) is merged with browser-specific overrides
   - Chrome: Uses `manifests/manifest.chrome.json`
   - Firefox: Uses `manifests/manifest.firefox.json` (includes name override)

4. **Asset Copying**:
   - Localization files from `_locales/`
   - Icons and images from `src/assets/`
   - Static files (popup.html, styles.css)

### Build Configuration

Build is configured in:
- `build/vite.chrome.ts` - Chrome-specific Vite config
- `build/vite.firefox.ts` - Firefox-specific Vite config
- `build/vite.content.ts` - Content script config (shared)
- `vitest.config.ts` - Test configuration

## Troubleshooting

### Build Fails with "Module not found"

```bash
# Clean install dependencies
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Extension Doesn't Load in Browser

1. Check manifest.json in dist folder is valid JSON
2. Ensure all referenced files exist
3. Check browser console for errors
4. Try rebuilding: `pnpm build`

### Changes Not Appearing

1. If using watch mode, check the terminal for build errors
2. Reload the extension in browser:
   - **Chrome**: Go to `chrome://extensions/` and click reload icon
   - **Firefox**: Go to `about:debugging` and click "Reload"
3. Hard refresh the page where you're testing (Ctrl+Shift+R)

### Build is Slow

Development builds are faster but larger. For testing performance:
```bash
pnpm build:chrome  # Production build
```

## Version Management

**Important**: Version numbers are managed manually and should only be changed when explicitly releasing a new version.

### Current Version

The version is stored in two places:
- `package.json` - Main version source
- `manifests/manifest.base.json` - Extension manifest version

**Both must match!**

### Changing Version

**Only change version when explicitly told to start a new release.**

```bash
# Update version in both files:
# 1. package.json: "version": "1.1.0"
# 2. manifests/manifest.base.json: "version": "1.1.0"
```

Follow semantic versioning (MAJOR.MINOR.PATCH):
- **MAJOR** (1.0.0 → 2.0.0): Breaking changes, new platform support
- **MINOR** (1.0.0 → 1.1.0): New features, non-breaking changes
- **PATCH** (1.0.0 → 1.0.1): Bug fixes only

## Clean Build

To ensure a completely clean build:

```bash
# Remove all build artifacts
rm -rf dist/

# Rebuild
pnpm build
```

## Testing Before Release

Before releasing a new version:

```bash
# Run full validation
pnpm validate

# Build for production
pnpm build

# Package for testing
pnpm build:test

# Test both packages in their respective browsers
```

## For Extension Store Reviewers

If you're reviewing this extension for Chrome Web Store or Firefox Add-ons:

### Quick Build Verification

1. Install Node.js 18+ and pnpm 10.27.0:
   ```bash
   npm install -g pnpm@10.27.0
   ```

2. Install dependencies and build:
   ```bash
   pnpm install
   pnpm build:firefox  # or pnpm build:chrome
   ```

3. The built extension will be in `dist/firefox/` (or `dist/chrome/`)

### What Gets Built

The build process:
1. Compiles TypeScript files from `src/`
2. Bundles code with Vite (includes jspdf, docx, turndown dependencies)
3. Merges `manifests/manifest.base.json` with browser-specific overrides
4. Copies localization files from `_locales/`
5. Copies assets from `src/assets/`

### Privacy & Security

- **No data collection**: This extension does NOT collect or transmit any user data
- **Local processing**: All chat export processing happens locally in the browser
- **No external connections**: The extension makes no network requests
- **Open source**: All source code is available for review

### Verification

To verify the submitted extension matches the source:
1. Build using steps above
2. Compare files in `dist/firefox/` (or `dist/chrome/`) with submitted extension
3. File contents should match (timestamps may differ)

## Next Steps

- For development workflow: See [ARCHITECTURE.md](ARCHITECTURE.md)
- For releasing: See [../RELEASING.md](../RELEASING.md)
- For adding parsers: See [ADDING_PARSERS.md](ADDING_PARSERS.md)
