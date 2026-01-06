# Release Process

This guide documents the complete process for releasing a new version of AI Chat Exporter.

## Pre-Release Checklist

- [ ] All tests passing: `pnpm test:run`
- [ ] Code validated: `pnpm validate`
- [ ] Version bumped in:
  - [ ] `package.json`
  - [ ] `manifests/manifest.base.json`
- [ ] CHANGELOG.md updated (if exists)
- [ ] All features documented

## Build and Package

### 1. Build Production Versions

```bash
pnpm build
```

This builds both Chrome and Firefox versions.

### 2. Run Final Validation

```bash
pnpm validate
```

### 3. Package Extensions

```bash
# Package all with version numbers
pnpm package:all
```

**Output files in `dist/`:**
- `ai-chat-exporter-chrome-v{VERSION}.zip` - Chrome extension
- `ai-chat-exporter-firefox-v{VERSION}.zip` - Firefox extension
- `ai-chat-exporter-source-v{VERSION}.zip` - Source code for Firefox review

**Note**: The version is automatically read from `package.json` and added to filenames.

## Publishing to Chrome Web Store

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devcenter/dashboard)
2. Click on your extension (or "New Item" for first release)
3. Upload `dist/ai-chat-exporter-chrome-v{VERSION}.zip`
4. Update store listing from `docs/store-listings/chrome-web-store-v{VERSION}.md`
5. Upload screenshots (3-5 recommended)
6. Submit for review

**Review time:** 1-3 business days

## Publishing to Firefox Add-ons

### Step 1: Upload Extension

1. Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Click "Submit a New Add-on" or update existing
3. Upload `dist/ai-chat-exporter-firefox-v{VERSION}.zip`
4. Fill in metadata from `docs/store-listings/firefox-addons-v{VERSION}.md`
5. Upload screenshots (3-5 recommended)

### Step 2: Upload Source Code

Firefox requires source code for extensions with minified/bundled code.

1. When prompted, upload `dist/ai-chat-exporter-source-v{VERSION}.zip`
2. Add build instructions in notes field (copy from `docs/store-listings/README.md`)
3. Submit for review

**Review time:** 1-7 days

**Important:** The source package includes `BUILD_INSTRUCTIONS.md` which guides reviewers through building the extension.

## Post-Release

### 1. Tag Release in Git

```bash
VERSION=$(node -p "require('./package.json').version")
git tag v${VERSION}
git push origin v${VERSION}
```

### 2. Create GitHub Release

1. Go to https://github.com/nuncaeslupus/ai-chat-exporter/releases
2. Click "Draft a new release"
3. Select the tag you just created
4. Title: `v{VERSION}`
5. Describe changes (copy from CHANGELOG if exists)
6. Attach the three packages:
   - `ai-chat-exporter-chrome-v{VERSION}.zip`
   - `ai-chat-exporter-firefox-v{VERSION}.zip`
   - `ai-chat-exporter-source-v{VERSION}.zip`
7. Publish release

### 3. Update Documentation

- [ ] Update `docs/INSTALLATION.md` with new version number
- [ ] Update `README.md` badges if needed
- [ ] Create new store listing files for next version (if major changes expected)

## Version Numbering

Follow semantic versioning (MAJOR.MINOR.PATCH):

- **MAJOR** - Breaking changes, new platform support
- **MINOR** - New features, non-breaking changes
- **PATCH** - Bug fixes, minor improvements

Examples:
- `1.0.0` - Initial release with ChatGPT support
- `1.1.0` - Add Claude support
- `1.1.1` - Fix export bug

## Troubleshooting

### Firefox Source Code Validation Fails

If Firefox rejects source code:
1. Verify `BUILD_INSTRUCTIONS.md` is clear and complete
2. Ensure all build dependencies are in `package.json`
3. Test build on clean machine to verify instructions work
4. Check exclusions in `package:source` script match actual unused files

### Store Listing Issues

- Chrome Web Store listing must be under 132 characters for short description
- Firefox requires `data_collection_permissions` in manifest
- Both stores require clear privacy policy if data is collected

## Quick Reference Commands

```bash
# Complete release flow
pnpm validate && pnpm build && pnpm package:all

# Git tag
VERSION=$(node -p "require('./package.json').version")
git tag v${VERSION} && git push origin v${VERSION}
```
