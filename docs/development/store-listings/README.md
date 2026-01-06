# Store Listings

This directory contains the listing information for publishing AI Chat Exporter to browser extension stores.

## Files

- **chrome-web-store-v1.0.0.md** - Listing details for Chrome Web Store (v1.0.0)
- **firefox-addons-v1.0.0.md** - Listing details for Firefox Add-ons (v1.0.0)

**Note**: Store listing files are versioned to track changes across releases.

## Publishing Checklist

### Before Submission

- [ ] Build production versions: `pnpm build`
- [ ] Run tests: `pnpm test:run`
- [ ] Run validation: `pnpm validate`
- [ ] Package extensions:
  - [ ] Chrome: `pnpm package:chrome` (or manually: `cd dist/chrome && zip -r ../ai-chat-exporter-chrome-v1.0.0.zip .`)
  - [ ] Firefox: `pnpm package:firefox` (or manually: `cd dist/firefox && zip -r ../ai-chat-exporter-firefox-v1.0.0.zip .`)
- [ ] **Firefox only:** Package source code: `pnpm package:source` (see Firefox Source Code section below)
- [ ] Prepare screenshots (see screenshot requirements in listing files)
- [ ] Create promotional tile image (440x280px for Chrome, optional for Firefox)

### Chrome Web Store

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devcenter/dashboard)
2. Upload `dist/ai-chat-exporter-chrome-v1.0.0.zip`
3. Fill in details from `chrome-web-store-v1.0.0.md`
4. Upload screenshots
5. Submit for review

**Review time:** Typically 1-3 business days

### Firefox Add-ons (AMO)

Firefox requires **both** the built extension and source code for extensions with bundled/minified code.

#### Step 1: Upload Extension Package

1. Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Upload `dist/ai-chat-exporter-firefox-v1.0.0.zip`
3. Fill in details from `firefox-addons-v1.0.0.md`
4. Upload screenshots

#### Step 2: Upload Source Code

When prompted for source code:

1. Upload `dist/ai-chat-exporter-source-v1.0.0.zip`
2. Add build instructions in the notes field:

```
Build Instructions:

This extension is built using TypeScript and Vite. To build from source:

1. Install Node.js 18+ and pnpm: npm install -g pnpm@10.27.0
2. Install dependencies: pnpm install
3. Build Firefox version: pnpm build:firefox
4. Output will be in dist/firefox/

Complete instructions are in BUILD_INSTRUCTIONS.md in the source package.

Note: This extension does not collect any user data. All processing happens
locally in the browser. The bundled code is the result of TypeScript
compilation with Vite.
```

3. Submit for review

**Review time:** Typically 1-7 days

**Files to upload:**
- **Extension:** `dist/ai-chat-exporter-firefox-v1.0.0.zip` (402KB)
- **Source Code:** `dist/ai-chat-exporter-source-v1.0.0.zip` (304KB)

## Firefox Source Code Package

Firefox requires source code for extensions with minified/bundled code (like ours built with Vite).

### Creating Source Package

**Automatic (recommended):**
```bash
pnpm package:source
```

**Manual:**
```bash
zip -r dist/ai-chat-exporter-source-v1.0.0.zip . \
  -x "node_modules/*" \
  -x "dist/*" \
  -x ".git/*" \
  -x "*.log" \
  -x "*.zip" \
  -x "tmp/*" \
  -x "coverage/*"
```

### What's Included in Source Package

- ✅ All TypeScript source code (`src/`)
- ✅ Build configuration (`build/`, `vite.config.ts`, etc.)
- ✅ Manifest files (`manifests/`)
- ✅ Tests (`tests/`)
- ✅ `BUILD_INSTRUCTIONS.md` - Step-by-step build guide for reviewers
- ✅ `package.json` and lock file
- ✅ Documentation (`docs/`)
- ❌ Excluded: `node_modules/`, `dist/`, `.git/`, temporary files

### Build Instructions Document

The source package includes `BUILD_INSTRUCTIONS.md` which explains:
- Prerequisites (Node.js, pnpm versions)
- Step-by-step build process
- Build output location
- Source code structure
- Dependencies explanation
- Verification steps

Reviewers will use this to rebuild and verify the extension.

## Screenshot Requirements

### Chrome Web Store
- **Minimum:** 1 screenshot
- **Recommended:** 3-5 screenshots
- **Format:** PNG or JPEG
- **Size:** 1280x800 or 640x400
- **Max file size:** 5MB per image

### Firefox Add-ons
- **Minimum:** 1 screenshot
- **Recommended:** 3-5 screenshots
- **Format:** PNG or JPEG
- **Max dimensions:** 2000x2000px
- **Max file size:** 2MB per image

## Suggested Screenshots

1. **Extension Popup** - Show the main UI with format options
2. **In Action** - ChatGPT page with export ready indicator
3. **PDF Output** - Example of exported PDF
4. **Format Menu** - Dropdown showing all available formats

## Updates

When updating the extension:

1. Update version in `manifests/manifest.base.json`
2. Update version in `package.json`
3. Build and package new versions
4. Add release notes to the store listing
5. Upload new package to both stores
