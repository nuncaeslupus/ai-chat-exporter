---
name: installation
description: How to install AI Chat Exporter on Chrome and Firefox
metadata:
  category: user
  audience: end-users
---

# Installation Guide

This guide will help you install the AI Chat Exporter extension on Chrome or Firefox.

## Table of Contents

- [Chrome Installation](#chrome-installation)
  - [From Chrome Web Store](#from-chrome-web-store)
  - [Manual Installation (Developer Mode)](#manual-installation-developer-mode)
- [Firefox Installation](#firefox-installation)
  - [From Firefox Add-ons](#from-firefox-add-ons)
  - [Manual Installation (Temporary)](#manual-installation-temporary)
- [Verifying Installation](#verifying-installation)
- [Updating the Extension](#updating-the-extension)
- [Uninstalling](#uninstalling)
- [Troubleshooting](#troubleshooting)

---

## Chrome Installation

### From Chrome Web Store

**Note**: Not yet published to Chrome Web Store. Use manual installation for now.

1. Visit the [Chrome Web Store page](https://chrome.google.com/webstore) (link TBD)
2. Click "Add to Chrome"
3. Confirm by clicking "Add extension" in the popup
4. The extension icon will appear in your toolbar

### Manual Installation (Developer Mode)

For development or if the extension is not yet published:

1. **Download the extension**
   - Download the latest `ai-chat-exporter-chrome-vX.X.X.zip` from the [releases page](https://github.com/nuncaeslupus/ai-chat-exporter/releases)
   - Extract the ZIP file to a folder on your computer

2. **Enable Developer Mode**
   - Open Chrome and navigate to `chrome://extensions/`
   - Toggle "Developer mode" ON (top-right corner)

3. **Load the extension**
   - Click "Load unpacked"
   - Select the extracted folder (the one containing `manifest.json`)
   - The extension should now appear in your extensions list

4. **Pin the extension (optional)**
   - Click the puzzle piece icon in Chrome toolbar
   - Find "AI Chat Exporter"
   - Click the pin icon to keep it visible

---

## Firefox Installation

### From Firefox Add-ons

**Note**: Not yet published to Firefox Add-ons. Use manual installation for now.

1. Visit the [Firefox Add-ons page](https://addons.mozilla.org) (link TBD)
2. Click "Add to Firefox"
3. Confirm by clicking "Add" in the popup
4. The extension icon will appear in your toolbar

### Manual Installation (Temporary)

For development or testing:

1. **Download the extension**
   - Download the latest `ai-chat-exporter-firefox-vX.X.X.zip` from the [releases page](https://github.com/nuncaeslupus/ai-chat-exporter/releases)
   - Keep the ZIP file (do not extract)

2. **Load the extension**
   - Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on"
   - Navigate to and select the ZIP file

3. **Note**: Temporary extensions are removed when Firefox restarts

**For permanent installation**: The extension must be signed by Mozilla. See [Firefox Developer Hub](https://extensionworkshop.com/) for details.

---

## Verifying Installation

After installation, verify the extension is working:

1. **Check the extension icon**
   - You should see the AI Chat Exporter icon in your browser toolbar
   - If not visible, check the extensions menu (puzzle piece icon in Chrome)

2. **Test on a supported platform**
   - Navigate to [ChatGPT](https://chat.openai.com)
   - Open any conversation
   - Look for export buttons in the conversation header
   - If buttons appear, the extension is working correctly

3. **Check extension permissions**
   - Chrome: `chrome://extensions/` → Click "Details" on AI Chat Exporter
   - Firefox: `about:addons` → Click "AI Chat Exporter"
   - Verify that site access permissions are granted

---

## Updating the Extension

### Auto-update (Web Store installation)

Extensions installed from official stores update automatically. You can manually check for updates:

- **Chrome**: `chrome://extensions/` → Click "Update" at the top
- **Firefox**: `about:addons` → Click gear icon → "Check for Updates"

### Manual update (Developer installation)

1. Download the new version
2. Extract to a new folder (or overwrite the old one)
3. **Chrome**: Go to `chrome://extensions/` → Click the reload icon on the extension card
4. **Firefox**: Go to `about:debugging#/runtime/this-firefox` → Click "Reload" next to the extension

---

## Uninstalling

### Chrome

1. Navigate to `chrome://extensions/`
2. Find "AI Chat Exporter"
3. Click "Remove"
4. Confirm the removal

### Firefox

1. Navigate to `about:addons`
2. Find "AI Chat Exporter"
3. Click the three-dot menu
4. Select "Remove"
5. Confirm the removal

**Note**: Uninstalling will remove all extension settings and preferences.

---

## Troubleshooting

### Extension not appearing in toolbar

**Chrome**:
- Click the puzzle piece icon (Extensions menu)
- Find "AI Chat Exporter" and click the pin icon

**Firefox**:
- Right-click toolbar → "Customize Toolbar"
- Drag the extension icon to your toolbar

### "This extension may have been corrupted" (Chrome)

This can happen with manually installed extensions:
1. Remove the extension
2. Re-download the package
3. Make sure you're loading the folder containing `manifest.json`
4. Reload the extension

### Extension not working on target sites

1. Check that you're on a supported platform (ChatGPT, Claude, Gemini)
2. Verify the extension has permission to access the site:
   - Chrome: `chrome://extensions/` → Details → Site access
   - Should be set to "On all sites" or specific allowed sites
3. Try refreshing the page
4. Check browser console for errors (F12 → Console tab)

### Export buttons not appearing

1. Refresh the page
2. Check that JavaScript is enabled
3. Verify the extension is enabled:
   - Chrome: `chrome://extensions/`
   - Firefox: `about:addons`
4. Try disabling other extensions that might conflict
5. Check the browser console for errors

### Firefox: "This add-on is not signed"

For permanent installation in Firefox, extensions must be signed:
- For development: Use `about:debugging` to load temporarily
- For distribution: Submit to Mozilla Add-ons for signing
- Alternative: Use [Firefox Developer Edition or Nightly](https://www.mozilla.org/en-US/firefox/channel/desktop/) with signing checks disabled

### Permission errors

If you see permission-related errors:
1. Check that the extension has necessary permissions
2. Some sites may block extension scripts (rare)
3. Try reinstalling the extension

---

## System Requirements

- **Chrome**: Version 88 or higher (Manifest V3 support)
- **Firefox**: Version 109 or higher (Manifest V3 support)
- **Disk Space**: ~5MB for extension files
- **Internet**: Required only for visiting AI chat platforms

---

## Privacy & Permissions

The extension requires the following permissions:

- **Storage**: To save user preferences and settings
- **Active Tab**: To access the current page and extract conversation data
- **Context Menus**: To add right-click export options
- **Scripting**: To inject export buttons into supported platforms

**What we DON'T do**:
- Collect or transmit your conversation data
- Track your browsing history
- Send data to external servers
- Require account creation

All processing happens locally in your browser.

---

## Next Steps

- Read the [Usage Guide](USAGE.md) to learn how to use the extension
- Check the [README](README.md) for feature overview
- Report issues on [GitHub](https://github.com/nuncaeslupus/ai-chat-exporter/issues)
