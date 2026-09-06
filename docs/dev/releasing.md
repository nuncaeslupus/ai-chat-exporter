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

### Keyword density — the #1 reason this extension gets rejected

Read this before touching a word of a listing. It is the most common rejection
we get, it has cost multiple review rounds, and it is now enforced:

```bash
node build/check-release.cjs keywords
```

CI runs it too. It fails on the two shapes that have actually been rejected.

**v1.3.0 was refused on 2026-09-06** — violation "Yellow Argon", *Spam and
Placement in the Store*, "excessive keywords in the item's description" — and
the reviewer quoted this back verbatim:

```
• PDF - Paginated documents with page numbers, code highlighting and embedded images
• Markdown - Clean, readable text with full formatting support
• Word - Microsoft Word documents with proper structure
• HTML, JSON, Plain text
```

Nothing about that is unusual prose, which is the trap: it reads as a feature
list to us and as a keyword list to the reviewer. The rules:

- **Never open a bullet with a format name and then describe it.** That
  enumerate-and-expand shape is the one that gets quoted back. Describe the
  capability instead: "Six formats to choose from, including PDF, Markdown and
  Word".
- **No format name more than four times in the whole description.** The store
  counts the file as a whole, not per section, so a mention added in one place
  can tip a listing that was fine.

Measured across every listing this project has shipped — which is where those
rules come from, rather than taste:

| listing | total format mentions | most-used name | enumerate bullets | outcome |
|---|---|---|---|---|
| v1.0.0 | 7 | 3× | 0 | accepted |
| v1.1.0 | 14 | — | 3 | |
| v1.1.1 | 16 | — | 3 | |
| v1.2.0 | 17 | 5× | 3 | |
| v1.3.0 | (carried v1.2.0's block) | | | **rejected** |

The per-format bullet list entered in v1.1.0 and grew from there. **v1.0.0 is
the shape known to pass**: one inline phrase, "Export to PDF, Markdown, Word and
other formats" — naming three and saying "and other formats" for the rest,
rather than enumerating all six. Copy that shape.
- **Use friendly names** — "Word", not "DOCX".
- **Never add format keywords while editing a listing for other reasons.**

A rejection on description text does **not** need a new package: fix the
listing, resubmit the same version.

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
