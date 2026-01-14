---
name: github-setup
description: GitHub repository configuration and setup
metadata:
  category: development
  audience: developers
---

# GitHub Setup Guide

## Repository Info

- **Repository**: https://github.com/nuncaeslupus/ai-chat-exporter
- **Description**: Browser extension to export AI chatbot conversations to PDF, Markdown, DOCX, and more
- **License**: MIT

## What's Completed

- ✅ ChatGPT parser with images, canvas, deep research
- ✅ Repository preparation (README, LICENSE)
- ✅ Documentation structure
- ✅ GitHub links updated in extension
- ✅ Multi-language support (8 languages)

## Next Steps

### Add GitHub Topics
- `browser-extension`, `chatgpt`, `claude`, `gemini`, `export`, `pdf`, `markdown`, `typescript`, `chrome-extension`, `firefox-addon`

### Prepare for Web Stores
```bash
pnpm package:all  # Creates versioned packages
```

### Future Parsers
To implement Claude/Gemini parsers:
1. Visit platform with a conversation
2. Inspect DOM with DevTools
3. Find message selectors
4. Update parser files following ChatGPT pattern

For details, see [adding-parsers.md](adding-parsers.md).
