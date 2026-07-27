# LSP vs grep routing

Load this when the user asks why the skill defaults to grep, when a
navigation query is ambiguous between LSP and grep, or when the cold-
start cost of LSP needs to be explained.

## Default: grep / ast-grep first

Default the first lookup for any navigation question to `rg` (ripgrep)
or `ast-grep`. Reasons:

- No cold-start. LSP servers index on first tool use (Python: 2–10 s;
  TypeScript: 5–15 s; Rust: 10–30 s; Java: 10 s+). For a one-shot
  query, the warmup alone exceeds the total grep cost.
- Markdown, comments, plain-text content, config files — LSPs do not
  index these. Grep is the only correct tool.
- Cross-language search ("find anything that mentions FOO_BAR") needs
  text search, not a per-language symbol table.

## Escalate to LSP only when symbol semantics matter

Use the built-in LSP tool when the answer requires *language-aware*
resolution that grep cannot give:

| Query shape | Why LSP wins |
|---|---|
| "Find all callers of `parse()`" | grep returns every text match, including unrelated `urllib.parse`. LSP resolves the symbol and returns only true call sites. |
| "Go to definition of `Foo.bar`" | LSP follows imports, re-exports, and inheritance; grep cannot. |
| "Rename `OldName` everywhere" | LSP rename touches references and respects scope; grep + sed silently breaks shadowed names. |
| "What is the type of this expression?" | Only LSP carries the type system. |
| "Find implementations of interface `Reader`" | Cross-file resolution; grep cannot find structural matches. |
| "Show diagnostics for the file I just edited" | LSP runs the language's analyzer; grep cannot. |

## Cold-start is paid once per session

Once the LSP server warms up, subsequent queries are sub-100 ms. So
the rule changes over a long session:

- **Early in a session, for a single navigation query**: grep.
- **Mid-session, after warmup paid by a prior query**: LSP freely.
- **For a refactor (≥3 navigation queries on the same file/symbol)**:
  pay the warmup once and use LSP throughout.

`pyright` and `rust-analyzer` persist caches to disk between sessions,
so the *second* cold-start in a given project is typically 30–50 %
faster than the first. `jdtls` does not benefit from caching;
TypeScript caching depends on `tsserver` mode.

## When LSP is not configured

If the user asks a symbol-precise query and no LSP is wired for the
target language, do not fall back to a noisy grep silently. State the
gap explicitly: "no LSP configured for that language, the result below
is text-match only and may include false positives — to set one up,
run the `lsp-setup` skill". Then run the grep.

## When LSP is configured but expensive

For massive monorepos (kubernetes, Chromium scale), even warmed LSPs
can take seconds per query. In that case:

- Prefer `documentSymbol` over `workspaceSymbol` — file-scoped queries
  skip the project-wide index walk.
- Prefer `references` to `implementations` — implementations is
  typically the slower call.
- Fall back to grep when the user's tolerance is low and the query is
  approximate ("anything that mentions FOO").
