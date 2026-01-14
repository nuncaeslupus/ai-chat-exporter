# Release Process

This guide documents the complete process for releasing a new version of AI Chat Exporter.

## Automated Release Workflow (For AI Assistants)

When the user says: **"Let's release next version with current changes"**

Follow these steps automatically:

1. **Analyze changes**:
   - Review git status and recent commits
   - Review modified files to understand what changed
   - Determine version bump type (patch for bug fixes/minor features, minor for new features, major for breaking changes)

2. **Update version numbers**:
   - Bump version in `package.json` (e.g., 1.1.1 → 1.1.2 for patch)
   - Bump version in `manifests/manifest.base.json` (must match package.json)

3. **Build and package**:
   - Run `pnpm package:all`
   - This creates 3 zip files with the new version number

4. **Generate store listings**:
   - Create `docs/development/store-listings/chrome-web-store-v{VERSION}.txt`
   - Create `docs/development/store-listings/firefox-addons-v{VERSION}.txt`
   - Use previous version's listings as templates
   - Update the "What's New" section based on the changes found in step 1
   - Keep as plain text format (emojis allowed, no Markdown)

5. **Confirm completion**:
   - List the generated zip files and their sizes
   - List the store listing files created
   - Summarize what changed in this version

## Quick Release Steps

### 1. Update Version Numbers

Update the version in **two files**:

1. **`package.json`** - Change the `"version"` field:
   ```json
   "version": "1.1.2"
   ```

2. **`manifests/manifest.base.json`** - Change the `"version"` field:
   ```json
   "version": "1.1.2"
   ```

### 2. Build and Package Everything

Run a single command that does everything:

```bash
pnpm package:all
```

This command automatically:
- Builds both Chrome and Firefox extensions
- Creates all 3 zip packages
- Adds version numbers to filenames

**Output files in `dist/`:**
- `ai-chat-exporter-chrome-v{VERSION}.zip` - Chrome extension (for Chrome Web Store)
- `ai-chat-exporter-firefox-v{VERSION}.zip` - Firefox extension (for Firefox Add-ons)
- `ai-chat-exporter-source-v{VERSION}.zip` - Source code (required for Firefox Add-ons review)

### 3. Create Store Listing Files

Create new listing files in `docs/development/store-listings/`:

1. **Chrome Web Store listing**: `chrome-web-store-v{VERSION}.txt`
   - Use previous version as template
   - Update the "What's New" section with changes
   - Keep format as plain text (emojis allowed)

2. **Firefox Add-ons listing**: `firefox-addons-v{VERSION}.txt`
   - Use previous version as template
   - Update the "What's New" section with changes
   - Keep format as plain text (emojis allowed)

**Note**: Store listings must be plain text format (.txt), not Markdown (.md)

## Pre-Release Checklist

Before running `pnpm package:all`:

- [ ] All tests passing: `pnpm test:run`
- [ ] Code validated: `pnpm validate`
- [ ] Version bumped in both files:
  - [ ] `package.json`
  - [ ] `manifests/manifest.base.json`
- [ ] All features documented
- [ ] Store listing files created in `docs/development/store-listings/`

## Publishing to Chrome Web Store

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devcenter/dashboard)
2. Click on your extension (or "New Item" for first release)
3. Upload `dist/ai-chat-exporter-chrome-v{VERSION}.zip`
4. Update store listing from `docs/development/store-listings/chrome-web-store-v{VERSION}.txt`
5. Upload screenshots (3-5 recommended)
6. Submit for review

**Review time:** 1-3 business days

## Publishing to Firefox Add-ons

### Step 1: Upload Extension

1. Go to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/)
2. Click "Submit a New Add-on" or update existing
3. Upload `dist/ai-chat-exporter-firefox-v{VERSION}.zip`
4. Fill in metadata from `docs/development/store-listings/firefox-addons-v{VERSION}.txt`
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
- **Store listing files must be plain text (.txt), not Markdown (.md)** - emojis are allowed

## Quick Reference Commands

```bash
# 1. Update version in package.json and manifests/manifest.base.json
# 2. Build and package everything
pnpm package:all

# 3. Optional: Validate before packaging
pnpm validate && pnpm package:all

# Git tag
VERSION=$(node -p "require('./package.json').version")
git tag v${VERSION} && git push origin v${VERSION}
```
