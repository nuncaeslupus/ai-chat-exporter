# LSP install table

Load this before Step 3 of the `lsp-setup` workflow.

Two commands per language: the language-server binary, then the Claude
Code plugin that wires the binary to the built-in LSP tool. The plugin
never bundles the binary — installing only the plugin leaves CC with
"Executable not found in $PATH" on first use. Surface both lines to
the user together.

The default marketplace is `claude-code-lsps` (Piebald-AI). When a
language is only carried by another marketplace, the marketplace slug
is noted in the row.

## Mainstream languages

| Language | Binary install | CC plugin install |
|---|---|---|
| python | `pip install pyright`  *or* `uv tool install pyright` | `/plugin install pyright@claude-code-lsps` |
| typescript | `npm i -g typescript typescript-language-server` *or* `npm i -g @vtsls/language-server` | `/plugin install vtsls@claude-code-lsps` |
| javascript | same as typescript | `/plugin install vtsls@claude-code-lsps` |
| go | `brew install gopls` *or* `go install golang.org/x/tools/gopls@latest` | `/plugin install gopls@claude-code-lsps` |
| rust | `rustup component add rust-analyzer` | `/plugin install rust-analyzer@claude-code-lsps` |
| ruby | `gem install ruby-lsp` | `/plugin install ruby-lsp@claude-code-lsps` |
| java | install Eclipse JDT-LS — see [jdtls docs](https://github.com/eclipse-jdtls/eclipse.jdt.ls) | `/plugin install jdtls@claude-code-lsps` |
| c | `brew install llvm` (provides `clangd`); also generate `compile_commands.json` (CMake `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`, or `bear -- make`) | `/plugin install clangd@claude-code-lsps` |
| cpp | same as c | `/plugin install clangd@claude-code-lsps` |
| php | `npm i -g intelephense` | `/plugin install intelephense@claude-code-lsps` |
| csharp | `dotnet tool install -g csharp-ls` | `/plugin install csharp-ls@claude-code-lsps` |

## Less-mainstream / community marketplaces

| Language | Binary install | CC plugin install |
|---|---|---|
| kotlin | `brew install kotlin-language-server` | `/plugin install kotlin-language-server@claude-code-lsps` |
| scala | install Metals — see [metals.dev](https://scalameta.org/metals/) | `/plugin install metals@claude-code-lsps` |
| elixir | install `elixir-ls` or `lexical` (see project READMEs) | `/plugin install elixir-lsp@claude-code-elixir` |
| ocaml | `opam install ocaml-lsp-server` | `/plugin install ocaml-lsp@claude-code-lsps` |
| haskell | `ghcup install hls` | `/plugin install hls@claude-code-lsps` |
| dart | dart-sdk ships `dart` with built-in LSP (`dart language-server`) | `/plugin install dart-lsp@claude-code-lsps` |
| lua | `brew install lua-language-server` | `/plugin install lua-language-server@claude-code-lsps` |
| swift | included with Swift toolchain (`sourcekit-lsp`) | `/plugin install sourcekit-lsp@claude-code-lsps` |
| vue | `npm i -g @vue/language-server` | `/plugin install vue-language-server@claude-code-lsps` |
| svelte | `npm i -g svelte-language-server` | `/plugin install svelte-language-server@claude-code-lsps` |
| html / css | `npm i -g vscode-langservers-extracted` | `/plugin install vscode-langservers@claude-code-lsps` |

## Notes

- The plugin slug above reflects the Piebald marketplace's current naming. If `/plugin install <name>@claude-code-lsps` returns "plugin not found", open `/plugin` and search the Discover tab for the language name — the catalogue evolves.
- Some languages are covered by multiple marketplaces (e.g. `claude-code-lsps` and `zircote/lsp-marketplace`). Either works; the row above picks the larger marketplace by default.
- After install, restart Claude Code so the new plugin's `.lsp.json` is picked up. `/plugin` lists each installed plugin's status; the Errors tab is where missing binaries surface.
- The plugin only describes how to start the language server. Project-level config (mypy strictness, gopls build tags, rust-analyzer features) still lives in the project's normal config files — the plugin does not override them.
