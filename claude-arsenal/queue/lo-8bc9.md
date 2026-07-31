# EXP-3: Markdown structural escaping — code-fence breakout, unescaped metacharacters, non-Latin-1 SVG failure

Source: the 13-dimension senior review of 2026-07-31 (26 agents, findings adversarially reviewed).
**5 findings** in this task: 4 high, 1 medium.

A cluster with one root theme: **the Markdown exporter emits structure without escaping content that
collides with that structure.** The fence breakout is the worst — everything after the offending block
stops being a conversation. Orchestrator confirmed `structured-md-exporter.ts:251` emits a fixed
three-backtick fence with no backtick-run check.

Fix the fence by computing its length from the content (longest run + 1), and escape metacharacters
where they would change structure — but **do not over-escape prose**, or every export fills with
backslashes. State your escaping rule.

---

## Findings

### [high] Markdown export breaks out of its own code fence when the code contains ``` — the rest of the conversation is swallowed into one code block

- **Where:** `src/core/exporters/structured-md-exporter.ts`:251
- **Problem:** `renderBlocks` emits a fixed three-backtick fence around `block.code` without checking the content for backtick runs, and `HtmlContentParser.parseCodeBlock` preserves inner fences verbatim. A code block that itself contains ``` therefore terminates the fence early; the trailing ``` then OPENS a new, never-closed code block that absorbs everything after it — including subsequent role labels and Q&A pairs. Same defect on the artifact path (lines 171-173).
- **Failure scenario:** The assistant explains Markdown and its answer contains a ```markdown block whose body has a nested ```js fence (extremely common). Ran the real exporter: the .md contains ```markdown / Example: / ```js / let a = 1; / ``` / done / ```. Rendered with `marked` (the repo's own dependency), the output is `<pre><code class="language-markdown">Example:\n```js\nlet a = 1;</code></pre>`, then `<p>done</p>`, then an unterminated `<pre><code>` that contains the `---` separator, `**User**`, the second question and the second answer. Everything after the first such block stops being a conversation.
- **Suggested fix:** Compute the fence length from the content: `const fence = '`'.repeat(Math.max(3, longestBacktickRun(block.code) + 1))` and use it for both the opening (with the language) and closing line. Apply the same at lines 171-173 (artifact code blocks) and, for consistency of the plain-text look, at txt-exporter.ts:260-262.

### [high] An SVG artifact containing any non-Latin-1 character makes the whole Markdown export fail with no file at all

- **Where:** `src/core/exporters/structured-md-exporter.ts`:151
- **Problem:** `btoa(artifact.content)` throws `InvalidCharacterError` for any codepoint above U+00FF. The throw propagates to the `try/catch` in `export()`, which converts it to `createErrorResult('Invalid character')`; the content script then throws 'Export failed' (content-script.ts:189-190) and the user gets no .md file whatsoever — not a degraded one. Both the Claude and ChatGPT parsers emit `{ type: 'image', language: 'svg' }` artifacts with the raw SVG source (claude/parser.ts:56,82; chatgpt/parser.ts:780), so this path is live.
- **Failure scenario:** Claude renders an SVG chart whose labels contain an en dash, a curly quote, an arrow, a CJK/Cyrillic word or an emoji — e.g. `<text>Ventas – 2026</text>`. Ran the real exporter with exactly that artifact: `EXPORT FAILED: Invalid character`. Nothing is exported, and the other five formats would have worked. Note `café` survives (U+00E9 ≤ 0xFF) so this looks fine in casual testing and fails on the first typographic dash.
- **Suggested fix:** Use a UTF-8-safe base64: `btoa(String.fromCharCode(...new TextEncoder().encode(svg)))`, or drop base64 entirely and emit a percent-encoded data URL (`data:image/svg+xml,${encodeURIComponent(content)}`), which is what the fixtures already use. Either way also wrap the data-URL construction so a failure degrades to the `<details>` SVG-source block that is already emitted below it, instead of failing the export.

### [high] PDF mangles Greek-language prose into Latin transliterations mid-word

- **Where:** `src/core/utils/pdf-characters.ts`:91
- **Problem:** `PDF_CHARACTER_REPLACEMENTS` maps individual Greek letters to English words (α→'alpha', λ→'lambda', …) for use as math symbols, and `sanitizeTextForPDF` applies the map to ALL text unconditionally when the embedded font lacks the glyph. In Greek prose the letters are letters, not symbols, so words are rewritten into English fragments — and the letters that are NOT in the map (κ, ά, έ, ή, ί, ό, ύ, ώ, and most capitals) are silently dropped by the font, producing an unreadable hybrid.
- **Failure scenario:** A Greek user exports a conversation to PDF. Verified with the real function: `sanitizeTextForPDF('Καλημέρα, γάτα')` returns `'Κalphalambdaetamuέrhoalpha, gammaάtaualpha'`. In the PDF the remaining Greek codepoints (Κ, έ, ά) are then dropped by the Latin-only font, so the reader sees `alphalambdaetamurhoalpha, gammataualpha`. The same happens to any prose containing a stray Greek letter (a physics answer, a variable name in text).
- **Suggested fix:** Only transliterate a Greek letter when it is isolated (surrounded by non-letters) — or, simpler and lazier, delete the Greek-letter block (lines 90-113) and let the generic 'uncovered codepoint → visible placeholder' rule from the previous finding handle them, so Greek text is at worst marked as unrenderable rather than silently rewritten into English.

### [high] Markdown export never escapes Markdown metacharacters: a pipe in a table cell shifts/drops columns, and literal user text becomes document structure

- **Where:** `src/core/exporters/structured-md-exporter.ts`:315
- **Problem:** `renderTable` joins cell text with ` | ` and `renderInline` returns `item.text` verbatim (line 366) — there is no escaping of `|`, and none of the line-start block markers (`#`, `-`, `1.`, `>`, `---`, `|`) either. A cell whose content contains a pipe adds phantom columns (GFM then discards the cells past the declared column count), and literal chat text that happens to look like Markdown is re-parsed as structure, including headings that pollute the document outline.
- **Failure scenario:** (1) An answer contains a table whose cell is `<code>ls | wc -l</code>` with a second cell 'counts'. Real exporter output: `| `ls | wc -l` | counts |` under a 2-column header — a GFM renderer keeps `ls` and `wc -l` and DROPS 'counts' entirely. (2) A user pastes a checklist, which ChatGPT renders as one div per line. Real exporter output quotes it as `> # Deploy checklist` / `> 1. drain`; rendered by `marked` this becomes `<h1>Deploy checklist</h1>` and `<ol><li>drain</li></ol>` inside the user's blockquote — a competing H1 in a document whose title is already H1.
- **Suggested fix:** Add one `escapeMd(text)` used by `renderInline`'s `text` case: escape `|` always (as `\|`) and escape a leading `#`, `>`, `-`, `+`, `=`, `|` or `N.`/`N)` at the start of a rendered paragraph/cell line. Keep it off `code`/`math` runs, where the characters are content. Table cells additionally need the newline case handled — inline `code`/`math` text is not whitespace-collapsed by `HtmlContentParser` (html-content-parser.ts:470-473, 434-438), so a cell containing a newline splits the table row.

### [medium] Nested ordered lists collapse and garble in Markdown: 2-space indent is too small for `1. ` parents

- **Where:** `src/core/exporters/structured-md-exporter.ts`:340
- **Problem:** `renderList` indents nested levels by a fixed `'  '.repeat(depth)`. CommonMark/GFM requires a nested list to be indented to the parent item's content column, which is 3 for an ordered marker (`1. `) and 2 for a bullet (`- `). With ordered ancestors the nested list is not recognised as nested, so levels flatten and some markers survive as literal text.
- **Failure scenario:** An answer with a 5-deep `<ol>`. Real exporter output is `1. L1` / `  1. L2` / `    1. L3` / `      1. L4` / `        1. L5`. Rendered with `marked`: `<ol><li>L1</li><li>L2\n1. L3<ol><li>L4</li><li>L5</li></ol></li></ol>` — L2 becomes a sibling of L1, `1. L3` appears as literal text inside L2, and L4/L5 are re-grouped at the wrong depth. The hierarchy of a nested plan/outline is destroyed. Pure `<ul>` nesting happens to work (content indent 2), so this only bites lists with an ordered ancestor — including `ol > ul`.
- **Suggested fix:** Indent by the parent marker's width instead of a constant: pass the parent's `prefix.length + 1` down and use `indent + ' '.repeat(parentPrefixWidth)` for the child list (3 for `1. `, 4 for `10. `, 2 for `- `). txt-exporter.ts:380-403 has the same fixed 2-space step but plain text has no parser, so only the md fix is behavioural.

---

## Working rules for this task

- Treat each finding independently: fix what is real, and if one does not hold up on inspection say
  so in the PR rather than inventing a change. The reviewers were adversarially checked but not
  infallible.
- **Never trade correctness for tidiness.** If a fix would lose content or weaken a guard, stop and
  report instead.
- Every behavioural fix needs a test that FAILS before it and passes after. State that you verified
  this — it will be checked independently.
- Do not restyle or refactor code outside the findings listed here.

## Acceptance gate

Every finding above is either fixed with a proving test, or explicitly explained as not-a-defect.

```bash
pnpm test:run && pnpm lint && pnpm format:check && pnpm typecheck
```
