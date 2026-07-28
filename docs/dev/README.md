---
name: development-guide
description: Comprehensive development guide for AI Chat Exporter
metadata:
  category: development
  audience: developers
---

# Development Guide

Quick reference for developing AI Chat Exporter.

## Quick Start

```bash
pnpm install          # Install dependencies
pnpm dev:chrome       # Development mode (watch)
pnpm build            # Build for production
pnpm test             # Run tests
pnpm validate         # Lint + typecheck + test
```

A `Makefile` also wraps these as `make install|dev|build|test|lint|typecheck|validate|package|release-check` — see [building.md](building.md#makefile).

## Project Structure

```
src/core/             # Parsers, exporters, services
src/extension/        # Background, content, popup
docs/dev/             # Development documentation
.claude/skills/       # Agent Skills for code generation
```

## Common Tasks

### Add New Platform Parser
1. Read: [adding-parsers.md](adding-parsers.md)
2. Use: `.claude/skills/parser-generator/SKILL.md`
3. Test: `pnpm test -- [platform]`

### Add New Export Format
1. Read: [adding-exporters.md](adding-exporters.md)
2. Use: `.claude/skills/exporter-generator/SKILL.md`
3. Test: `pnpm test -- [format]`

### Build & Release
- Build: [building.md](building.md)
- Release: [releasing.md](releasing.md)
- Workflow: [workflow.md](workflow.md)

## Documentation

- [Architecture](architecture.md) - System design
- [Testing](testing-guide.md) - Testing strategies
- [Project Structure](project-structure.md) - Code organization
- [GitHub Setup](github-setup.md) - Repository config
- [Development Plan](development-plan.md) - Roadmap

## Key Concepts

**Parser**: Extracts conversation from platform DOM
**Exporter**: Converts conversation to file format
**Structured Content**: Normalized content representation

## Resources

- User docs: `../installation.md`, `../usage.md`
- Full index: `../README.md`
- GitHub: https://github.com/ivansaul/ai-chat-exporter
