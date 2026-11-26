# Submitting to the Chrome Web Store and Firefox Add-ons

Prerequisites: Node >= 22 and pnpm 10.27.0 (`npm install -g pnpm@10.27.0`),
a Chrome Web Store developer account (one-off US$5 fee) and an AMO developer account.

Read `listing.md` "Open decisions" first. The Firefox id must be settled before
the first AMO upload.

## 1. Build the three zips

From a clean checkout of `main` at the release commit:

```bash
pnpm install
pnpm package:all          # builds both targets, then writes the three zips
```

Output in `dist/` (sizes measured on v1.3.1):

| File | Size | Goes to |
|---|---|---|
| `ai-chat-exporter-v1.3.1-chrome.zip` | about 0.8 MB | Chrome Web Store |
| `ai-chat-exporter-v1.3.1-firefox.zip` | about 0.8 MB | AMO, "upload add-on" |
| `ai-chat-exporter-v1.3.1-source.zip` | about 1.8 MB | AMO, "source code" |

`pnpm package:all` already runs `pnpm build`; to build only one target use
`pnpm build:chrome` or `pnpm build:firefox`, then `pnpm package:chrome` or
`pnpm package:firefox`. `pnpm validate` is the full gate and is not needed to package.

## 2. Chrome Web Store

1. Open https://chrome.google.com/webstore/devcenter/dashboard, **New item**
   (or open the existing item and **Package > Upload new package**), and upload the chrome zip.
2. **Store listing** tab: description from `listing.md` (Full description),
   category Productivity, language English, summary is taken from the
   manifest (`_locales/en/messages.json`); homepage and support URLs from
   `listing.md`. Upload the icon (128x128, `src/assets/icons/icon-128.png`),
   the screenshots below, and a 440x280 small promo tile.
3. **Privacy** tab: paste the single purpose statement, each permission
   justification, answer "remote code: No", set data usage and certifications as
   in `listing.md`, and enter the privacy policy URL.
4. **Distribution** tab: public, all regions, free.
5. **Submit for review** (typically 1 to 3 business days).

## 3. Firefox Add-ons (AMO)

1. Open https://addons.mozilla.org/developers/, **Submit a New Add-on**, choose
   **On this site** (listed), upload the firefox zip. The linter runs; fix any
   error (warnings about `innerHTML` or the bundled libraries are expected).
2. When asked "Do you need to submit source code?" answer **Yes** and upload the
   source zip. The zip carries `BUILD_INSTRUCTIONS.md`.
3. Listing: name, summary (`listing.md`, 250 characters max), description,
   category, license MIT, homepage, support site, privacy policy URL, screenshots.
4. **Notes to Reviewer**: paste the block from `listing.md`.
5. Submit (typically 1 to 7 days). Requires `strict_min_version` 112, already set.

## 4. Screenshots (Chrome: exactly 1280x800)

Easiest reliable method, no extra tools:

1. Build and load the extension: `pnpm build:chrome`, then `chrome://extensions`,
   Developer mode, **Load unpacked**, select `dist/chrome`.
2. Open a short, non-sensitive conversation on chatgpt.com, claude.ai or
   gemini.google.com. Do not capture anything personal.
3. Set the window to 1280x800: open DevTools, device toolbar (Ctrl+Shift+M),
   choose **Responsive**, type 1280 x 800, DPR 1. For popup shots, open the
   popup, then in DevTools use the command menu (Ctrl+Shift+P) **Capture
   screenshot** on the page behind it, or take an OS screenshot of the window.
4. Save as PNG. Check size with `file shot.png`; resize if needed
   (`magick shot.png -resize 1280x800 -background white -gravity center -extent 1280x800 shot.png`).
   Chrome rejects images with transparency, so flatten (`-background white -alpha remove`).
5. Suggested five shots are listed in `listing.md`. AMO accepts the same files.

## 5. After approval

Tag and release as in `docs/dev/releasing.md` (Post-Release).
