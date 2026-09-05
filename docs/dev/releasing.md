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
pnpm build && pnpm package:all
```

Creates in `dist/`:
- `ai-chat-exporter-v{VERSION}-chrome.zip` - Chrome extension
- `ai-chat-exporter-v{VERSION}-firefox.zip` - Firefox extension
- `ai-chat-exporter-v{VERSION}-source.zip` - Source code (for Firefox review)

### 3. Create Store Listings

Create in `docs/store-listings/`:
- `chrome-web-store-v{VERSION}.txt` (plain text, no markdown)
- `firefox-addons-v{VERSION}.txt` (plain text, no markdown)

**Copy the previous version's file verbatim and change only three things**: the
version on line 1, the "What's New" block, and the "Version History" list. The
shipped texts are a reviewed baseline — do not reword, expand or "improve" the
rest of them.

**Important**: Keep format lists concise ("PDF, Markdown, Word and other
formats") to avoid Chrome Web Store "spammy text" flags. A listing that repeats
DOCX / PDF / MD / TXT across sections reads as keyword stuffing and has cost us
a review round. Use friendly names ("Word", not "DOCX"), name each format once,
and never add format keywords to a listing while editing it — the running total
across the whole file is what gets flagged.

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

**Note**: Firefox reviewers need build instructions to reproduce
`dist/chrome`/`dist/firefox` from source. `BUILD_INSTRUCTIONS.md` at the repo
root ships in the source zip and covers this (see also
[building.md](building.md) for the full development workflow).

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

**Firefox source validation fails**: Test the build steps in [building.md](building.md) on a clean machine (`pnpm install && pnpm build`)

**Store listing rejected**: Use concise format lists, friendly names ("Word" not "DOCX")

**Chrome Web Store flags obfuscated code ("Red Titanium")**: this was jsPDF's
optional dependencies (canvg, html2canvas, dompurify), which it lazily imports
from code paths we never use. The bundler still emitted them, and canvg's
inlined core-js builds the string `"java" + "script" + ":"`, which the review
scanner flags. `build/jspdf-optional-stub.js` aliases all three away at build
time. **Do not remove that alias or restore the full jsPDF dependency set** to
"fix" a bundling error — the ~380 KB it drops is dead weight, and bringing it
back re-triggers the flag. If a future code path genuinely needs one of them,
the stub throws a named error rather than failing silently.
