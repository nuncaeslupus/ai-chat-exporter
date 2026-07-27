---
name: lsp-setup
description: Use when the user wants to enable, configure, or troubleshoot Claude Code's built-in LSP tool for a project — detects language manifests (pyproject.toml, package.json, go.mod, Cargo.toml, …), asks which languages to enable, then prints the LSP binary and Claude Code plugin install commands to run. Triggers — "set up LSP", "enable language server", "configure pyright / gopls / rust-analyzer", "/plugin install … @claude-code-lsps". Owns scripts — analyze_languages.py. Do NOT use for one-off grep/find lookups, skill authoring (see skill-creator), or unrelated MCP server setup.
---

# lsp-setup

Wire Claude Code's built-in LSP tool to the current project. Detect which languages the project actually uses, let the user pick the ones to enable, then surface the exact install commands — both the language-server binary and the Claude Code plugin — so the user can run them.

CANARY: lsp-setup-loaded-2026-05-19-aeeb5567-ffc71346f9d952eb

## When to load

After activation, confirm the task fits before working:

- The user explicitly asks to set up, enable, or configure LSP for the project.
- The user is troubleshooting a missing, slow, or misconfigured LSP — "pyright isn't running", "find references returns nothing", "the LSP plugin says executable not found".
- The user asks which LSP plugin to install for a stack.

If the LSP is already wired and the request is a navigation query ("find callers of foo"), defer — the built-in LSP tool answers directly; this skill is the *setup* path, not the *use* path.

## Workflow

### Step 1 — analyze the project

Run the analyzer. It scans the working directory for language manifests at the root and prints a JSON list of detected languages to stdout.

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/analyze_languages.py" .
```

Stdlib-only. The script never installs, writes, or modifies anything.

### Step 2 — confirm the language set with the user

Detection is a suggestion, not a decision. Use an `AskUserQuestion` multi-select with the detected languages pre-checked. Let the user remove false positives and add languages the analyzer missed.

A language the analyzer cannot detect (no manifest at the root) is still enableable — accept user-added entries verbatim if they appear in the install table.

### Step 3 — surface install commands explicitly

For every chosen language, print **two** commands the user must run — never run them silently:

1. The language-server binary install (`pip install pyright`, `npm i -g typescript-language-server`, `brew install gopls`, …).
2. The Claude Code plugin install (`/plugin install pyright@claude-code-lsps`).

Format the output as a copy-pastable block grouped by language:

```bash
# Python — install pyright + plugin
pip install pyright
/plugin install pyright@claude-code-lsps

# Go — install gopls + plugin
brew install gopls
/plugin install gopls@claude-code-lsps
```

The exact mapping per language lives in `references/lsp-install-table.md`. Open that reference before writing this block.

If a chosen language has **no row in the install table** (e.g. fsharp, erlang, or another niche language), do not dead-end: tell the user the language has no pre-packaged plugin in the `claude-code-lsps` marketplace, then document the official LSP server for that language (e.g. `fsautocomplete` for F#, `erlang_ls` for Erlang) and the manual install steps — binary install from the project's releases page, followed by a hand-authored `.lsp.json` pointing at the installed binary. Point the user to the [`.lsp.json` schema](https://github.com/piebald-ai/claude-code-lsps) for the field reference.

State, in one sentence, that the user must run these — the skill does not install on the user's behalf.

### Step 4 — set the LSP-vs-grep expectation

State the cold-start cost once, in plain text:

- Pyright: 2–10 s first query; sub-100 ms after.
- TypeScript: 5–15 s first query; sub-100 ms after.
- Rust analyzer: 10–30 s first query; faster on cached `target/`.
- Java (jdtls): 10 s+ always; no useful caching.

Then state the routing rule for the rest of the session: default first lookup remains `rg` / `ast-grep`; escalate to LSP only for cross-file find-references, find-implementations, rename refactors, exact-symbol go-to-def, or type-of-expression queries. Full rationale lives in `references/lsp-vs-grep-routing.md`.

## References — load on demand

- [LSP install table](references/lsp-install-table.md) — load before Step 3. Canonical binary install + Claude Code plugin install command per language; also notes the marketplace each plugin lives in.
- [LSP vs grep routing](references/lsp-vs-grep-routing.md) — load when the user asks why the skill defaults to grep, or when a navigation query is ambiguous between LSP and grep.

## Gotchas

- **Claude Code ≥2.1.50 is required for modern `.lsp.json` fields.** Older builds silently ignore `startupTimeout` and similar. If a plugin fails to load with no visible error, check the CC version before chasing config bugs.
- **The LSP binary is NOT bundled in the plugin.** `/plugin install pyright@claude-code-lsps` succeeds even when pyright is missing from `PATH`; the failure surfaces later as "Executable not found in $PATH" in the `/plugin` Errors tab. Always print both commands together in Step 3.
- **Bundling many `.lsp.json` files in one plugin spawns every server.** Each enabled `.lsp.json` boots its language server on first matching file, regardless of whether the user opened that language. Recommend only the languages the project actually uses.
- **`pyright` and `rust-analyzer` cache between sessions; `jdtls` does not.** The cold-start numbers in Step 4 are first-run estimates. The second cold-start on a cached project is typically 30–50 % faster, except for Java.
- **The skill never auto-installs.** Even when the user says "just do it", the skill prints the commands and lets the user run them. Install side effects (system packages, npm globals, Cargo toolchain) belong to the user, not the agent.
