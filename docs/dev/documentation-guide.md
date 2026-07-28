---
name: documentation-guide
description: Guide for maintaining and writing documentation
metadata:
  category: development
  audience: developers
---

# Documentation Guide

Guide for maintaining documentation in AI Chat Exporter.

## Documentation Structure

```
docs/
├── README.md              # Documentation index
├── installation.md        # User: Installation guide
├── usage.md               # User: Usage guide
├── release-notes-*.txt    # Release notes (plain text)
├── dev/                   # Development documentation
│   ├── README.md          # Dev index (start here)
│   ├── architecture.md
│   ├── building.md
│   ├── testing-guide.md
│   ├── adding-parsers.md
│   ├── adding-exporters.md
│   ├── releasing.md
│   ├── workflow.md
│   ├── project-structure.md
│   ├── github-setup.md
│   └── development-plan.md
└── store-listings/        # Store submission files (plain text)
```

## YAML Frontmatter

All documentation files use YAML frontmatter for metadata:

```yaml
---
name: filename-without-extension
description: Brief description of the document
metadata:
  category: user|development
  audience: end-users|developers
---
```

**Required fields:**
- `name`: Lowercase with hyphens (matches filename)
- `description`: One-line description

**Optional fields:**
- `metadata.category`: Document category
- `metadata.audience`: Target audience

## File Naming Conventions

- **Documentation**: `lowercase-with-dashes.md`
- **Exceptions**: `README.md`, `CLAUDE.md` (uppercase)
- **Store listings**: Plain text `.txt` format
- **Release notes**: Plain text `.txt` format

## Agent Skills

Skills are stored in `.claude/skills/` directory:

```
.claude/skills/
├── parser-generator/
│   └── SKILL.md
└── exporter-generator/
    └── SKILL.md
```

**SKILL.md format** follows [Agent Skills specification](https://agentskills.io/specification):

```yaml
---
name: skill-name
description: What the skill does
license: MIT
metadata:
  author: project-name
  version: "1.0"
---

# Skill content here
```

## Writing Guidelines

**Keep it concise:**
- Focus on essential information
- Link to detailed docs instead of duplicating
- Use bullet points and short paragraphs

**Structure:**
- Start with YAML frontmatter
- Use clear headings
- Include code examples where helpful
- Link to related documentation

**Documentation is a living system:**
- Update documentation with new learnings from each development session
- Add insights about what worked and what didn't
- Document workarounds and solutions to problems encountered
- Keep documentation evolving as the project grows

**Maintenance:**
- Update frontmatter when changing files
- Keep descriptions accurate
- Remove outdated information
- Update cross-references when moving files

## Store Listings

**Important:** Chrome Web Store flags "spammy text"

**Guidelines:**
- Use plain text `.txt` format (not markdown)
- Keep format lists concise: "PDF, Markdown, Word and other formats"
- Use friendly names: "Word" not "DOCX", "Plain text" not "TXT"
- Avoid repetitive descriptions
- Emojis are allowed

## Quick Reference

**Add new doc:**
1. Create file in appropriate directory
2. Add YAML frontmatter
3. Write concise content
4. Update index (docs/README.md or docs/dev/README.md)

**Move/rename doc:**
1. Update filename (lowercase-with-dashes.md)
2. Update YAML frontmatter `name` field
3. Search and update all references
4. Update indexes

**Add Agent Skill:**
1. Create directory in `.claude/skills/`
2. Add `SKILL.md` with proper frontmatter
3. Follow Agent Skills specification
4. Reference from development docs
