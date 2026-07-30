# D-29: a single `~` is parsed as strikethrough, corrupting exported prose

**Reported by the repo owner on a real conversation, 2026-07-30. Reproduced
exactly.**

## The defect

Source text in a conversation:

```
Some numbers vary by source and colony. Emperor incubation is quoted as anywhere
from ~64 to ~75 days depending on colony; male mass loss (~20 kg) and total fast
(~110–115 days) are typical figures, not universal constants.
```

What `marked` produces with this repo's current options:

```html
<p>... anywhere from <del>64 to ~75 days depending on colony; male mass loss (</del>20 kg) ...</p>
```

Confirmed by running `marked.parse()` directly against the repo's installed
version: with default/GFM options the `<del>` appears; with `{gfm:false}` the
text is untouched. **GFM permits a SINGLE tilde to open/close strikethrough**, so
`~` written to mean "approximately" is consumed as a delimiter. The first `~`
pairs with a later `~`, striking out everything between and **deleting both
tilde characters**.

Owner-observed symptoms, all consistent with the above:
- **md, docx, html** — visible strikethrough across
  `64 to ~75 days depending on colony; male mass loss (`
- **pdf** — no strikethrough styling, but the tildes are **silently gone**:
  `anywhere from 64 to ~75 days ... male mass loss (20 kg)`. Same parse; pdf just
  does not render `<del>`, so the corruption is invisible and therefore worse.
- **txt, json** — correct. They never run `marked`.

## Why this is unambiguously a bug, not markdown working as designed

**The chat page itself rendered the tildes literally** — the owner read the text
with the tildes intact on screen. Our export therefore renders content
*differently from the source it claims to be exporting*, and silently drops
characters that carry meaning ("~20 kg" is not "20 kg"). Numeric approximation
markers are exactly the content where dropping a character changes the meaning.

## Fix

Both call sites set `gfm: true`:

- `src/core/exporters/code-highlight.ts:278` — inside `loadMarkdownRenderer`,
  which is what **pdf, docx and html** use.
- `src/extension/content/content-script.ts:459`

**Do NOT simply set `gfm: false`.** That would also lose tables, autolinks and
task lists, which the redesign deliberately relies on. Instead keep GFM but make
strikethrough require **two** tildes (`~~struck~~` stays working, `~approx~`
becomes literal) — a `marked` extension/tokenizer override for `del`. Apply it
**once**, in a shared place both call sites use, not twice.

Prefer overriding the tokenizer over pre-escaping the text: escaping `~` before
parsing would also defeat legitimate `~~strikethrough~~`, and a
find-and-replace on user content is the kind of fix that creates the next bug.

**Check the same class of failure while you are here** and report what you find:
other single-character markdown delimiters in prose that the source page renders
literally — `_underscores_` inside identifiers (`my_var_name`), `*asterisks*`,
and stray backticks are the realistic candidates. Do not silently expand scope;
report them and, if any reproduce, say so plainly so they can be seeded.

## Acceptance gate

The owner's exact sentence survives a round trip through **all six** formats with
both tildes intact and no `<del>`; `~~real strikethrough~~` still renders as
strikethrough.

```bash
pnpm test:run tests/unit/core/exporters/ tests/integration/fixture-to-parser-to-exporter.test.ts && pnpm lint && pnpm format:check && pnpm typecheck
```

## Tests
Add the owner's sentence verbatim as a fixture case driven through every format —
assert the literal substrings `~64`, `~75`, `~20`, `~110–115` all survive and that
no `<del>`/strikethrough run appears. Add a second case asserting `~~struck~~`
DOES still produce strikethrough, so the fix cannot pass by disabling the feature
outright. `tests/unit/core/exporters/` is the right home; the integration fixture
test is the end-to-end proof.

## Location
`src/core/exporters/code-highlight.ts` (`loadMarkdownRenderer`),
`src/extension/content/content-script.ts`
