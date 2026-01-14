---
name: releasing
description: Complete process for releasing new versions
metadata:
  category: development
  audience: developers
---

# Release Process

## Quick Release Steps

### 1. Update Version Numbers

Update version in **both** files (must match):
- `package.json` - `"version": "1.1.2"`
- `manifests/manifest.base.json` - `"version": "1.1.2"`

Follow semantic versioning (MAJOR.MINOR.PATCH):
- **MAJOR**: Breaking changes, new platform support
- **MINOR**: New features, non-breaking changes
- **PATCH**: Bug fixes

### 2. Build and Package

```bash
pnpm package:all
```

Creates in `dist/`:
- `ai-chat-exporter-v{VERSION}-chrome.zip` - Chrome extension
- `ai-chat-exporter-v{VERSION}-firefox.zip` - Firefox extension
- `ai-chat-exporter-v{VERSION}-source.zip` - Source code (for Firefox review)

### 3. Create Store Listings

Create in `docs/store-listings/`:
- `chrome-web-store-v{VERSION}.txt` (plain text, no markdown)
- `firefox-addons-v{VERSION}.txt` (plain text, no markdown)

Use previous version as template, update "What's New" section.

**Important**: Keep format lists concise ("PDF, Markdown, Word and other formats") to avoid Chrome Web Store "spammy text" flags.

## Pre-Release Checklist

- [ ] All tests passing: `pnpm test:run`
- [ ] Code validated: `pnpm validate`
- [ ] Version bumped in both files
- [ ] Store listing files created
- [ ] Tested both packages in browsers

## Publishing

### Chrome Web Store
1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devcenter/dashboard)
2. Upload `dist/ai-chat-exporter-v{VERSION}-chrome.zip`
3. Update listing from `docs/store-listings/chrome-web-store-v{VERSION}.txt`
4. Submit for review (1-3 business days)

### Firefox Add-ons
1. Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Upload `dist/ai-chat-exporter-v{VERSION}-firefox.zip`
3. Upload `dist/ai-chat-exporter-v{VERSION}-source.zip` when prompted
4. Fill in metadata from `docs/store-listings/firefox-addons-v{VERSION}.txt`
5. Submit for review (1-7 days)

**Note**: Source package includes `BUILD_INSTRUCTIONS.md` for reviewers.

## Post-Release

### Tag Release in Git
```bash
VERSION=$(node -p "require('./package.json').version")
git tag v${VERSION}
git push origin v${VERSION}
```

### Create GitHub Release
1. Go to https://github.com/nuncaeslupus/ai-chat-exporter/releases
2. Draft new release with tag `v{VERSION}`
3. Describe changes
4. Attach three packages
5. Publish

## Troubleshooting

**Firefox source validation fails**: Verify `BUILD_INSTRUCTIONS.md` is clear, test build on clean machine

**Store listing rejected**: Use concise format lists, friendly names ("Word" not "DOCX")
