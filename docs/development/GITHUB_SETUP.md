# GitHub Setup Guide

## Quick Setup Steps

1. **Create GitHub Repository**
   - Go to https://github.com/new
   - Repository name: `ai-chat-exporter`
   - Description: "Browser extension to export AI chatbot conversations to PDF, Markdown, DOCX, and more"
   - Choose: Public
   - Do NOT initialize with README (we already have one)

2. **Initialize Git (if not already done)**
   ```bash
   git init
   git add .
   git commit -m "Initial commit: ChatGPT parser with images, canvas, and deep research support"
   ```

3. **Link to GitHub**
   ```bash
   git remote add origin https://github.com/nuncaeslupus/ai-chat-exporter.git
   git branch -M main
   git push -u origin main
   ```

4. **Create .gitignore (if needed)**
   The repository should already have a `.gitignore` file. Make sure it includes:
   ```
   node_modules/
   dist/
   build/
   *.log
   .DS_Store
   ```

5. **Update Remaining Placeholders**

   In `README.md`, you may want to update:
   - Email address: Currently `your.email@example.com` (line 252)
   - Chrome Web Store link (once published)
   - Firefox Add-ons link (once published)

## What Was Completed

### ✅ ChatGPT Parser Improvements
- **Images**: Extracts user-uploaded and AI-generated images
- **Canvas Content**: Captures ChatGPT canvas/document content
- **Deep Research**: Preserves research metadata (duration, sources, searches)
- **Better Content Extraction**: Improved handling of all message types

### ✅ Repository Preparation
- Created comprehensive `README.md` with:
  - Feature list and installation instructions
  - Development setup guide
  - Architecture documentation
  - Contributing guidelines
- Created `LICENSE` file (MIT)
- Updated GitHub links in popup to: `https://github.com/nuncaeslupus/ai-chat-exporter`

### ✅ Documentation
- `DEVELOPMENT_PLAN.md` - Detailed development progress
- `README.md` - User-facing documentation
- Code is well-documented with TypeScript types

## Next Steps (Optional)

### 1. Add Screenshots
Create a `screenshots/` folder with:
- Extension popup
- Export example
- Different export formats
- Add to README for better visibility

### 2. Prepare for Web Stores

**Chrome Web Store:**
```bash
pnpm build:chrome
pnpm package:chrome
# Upload dist/ai-chat-exporter-chrome.zip to Chrome Web Store Developer Dashboard
```

**Firefox Add-ons:**
```bash
pnpm build:firefox
pnpm package:firefox
# Upload dist/ai-chat-exporter-firefox.zip to Firefox Add-on Developer Hub
```

### 3. Add GitHub Topics
On GitHub, add topics to make your repo more discoverable:
- `browser-extension`
- `chatgpt`
- `claude`
- `gemini`
- `export`
- `pdf`
- `markdown`
- `typescript`
- `chrome-extension`
- `firefox-addon`

### 4. Future Parser Implementations
The Claude and Gemini parsers are currently placeholders. To implement them:
1. Visit Claude.ai or Gemini with a conversation
2. Use browser DevTools to inspect the DOM
3. Find the selectors for messages, title, etc.
4. Update the respective parser files
5. Follow the same pattern as ChatGPT parser

## Claude and Gemini Parser Status

### Claude Parser (`src/core/parsers/claude/parser.ts`)
- ⚠️ Placeholder - returns empty pairs
- Needs DOM inspection and selector implementation
- You can provide HTML examples like you did for ChatGPT

### Gemini Parser (`src/core/parsers/gemini/parser.ts`)
- ⚠️ Placeholder - returns empty pairs
- Needs DOM inspection and selector implementation
- You can provide HTML examples like you did for ChatGPT

## Testing Your Changes

Before pushing to GitHub:
```bash
# Type check
pnpm typecheck

# Run tests
pnpm test

# Lint
pnpm lint

# Build
pnpm build
```

## Questions?

If you need help implementing Claude or Gemini parsers, just provide me with:
1. An HTML snippet of a conversation (like you did for ChatGPT)
2. Any specific features you want to capture (images, code blocks, etc.)

I can then implement the parser with the same quality as the ChatGPT one!
