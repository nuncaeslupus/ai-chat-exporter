# Payload: lo-9ddf — D-5: Integration suite pins behaviour that PR #14 changes

**Gate**: with PR #14 and PR #24 both merged, `pnpm test` is green and no
assertion in `tests/integration/fixture-to-parser-to-exporter.test.ts` asserts
behaviour that the merged code no longer has.

**This is a merge-ordering hazard, not a code defect.** Act on it when the two
PRs land, not before.

## The collision

`lo-c393` (PR #24) wrote the integration suite against `main`, so it recorded
then-current behaviour. One of the things it recorded as
"documented-wrong, asserted as-is" is:

> headings/links/bold/lists are silently dropped from any assistant message that
> also carries artifact or web-search metadata — `ConversationStructureService.toStructured()`
> skips `HtmlContentParser` and falls back to a single plain-text paragraph.

That is exactly the defect `lo-3005` (PR #14) **fixes**. When #14 merges, those
assertions become wrong in the opposite direction and the suite goes red — a
correct fix looking like a regression.

## Work

After both PRs are on the default branch, invert the affected assertions in
`tests/integration/fixture-to-parser-to-exporter.test.ts` so they assert the
*correct* post-#14 behaviour (headings stay headings, lists stay lists, through
every exporter). Remove the "documented-wrong" comments on those specific cases.

Leave the other documented-wrong assertions alone — `lo-23fb` (web-search
titles/URLs absent from md/txt/docx) is still an open defect and its assertions
should keep pinning current behaviour until that task lands.

## Also check while you are here

PR #24 added `jszip` as a devDependency to unzip real `.docx` output. PR #15
(`lo-64a6`) hand-rolled a minimal ZIP reader in `tests/utils/docx-helpers.ts`
*specifically* to avoid touching `package.json` while it was contended. With
`jszip` now present, that hand-rolled reader is redundant — delete it and point
`tests/unit/core/exporters/docx-exporter.test.ts` at `jszip`.

Note PRs #13, #20 and #24 all modify `package.json`; expect to resolve that.
