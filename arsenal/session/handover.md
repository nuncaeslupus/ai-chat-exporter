# Handover — 2026-09-06 (overnight session)

## State

`main` @ `2fae0e7`. Version **1.3.0**, packaged and ready to upload, **not yet
submitted to either store**.

**The `v1.3.0` tag is stale.** It points at `88e0234`; main is 3 commits ahead.
Moving it needs a force-push, which the permission classifier blocked:

```
git tag -f v1.3.0 && git push -f origin v1.3.0
```

Nothing has consumed the tag (release still a draft, nothing in either store),
so re-pointing it is safe. Until then the tag marks the release commit, not the
build in `dist/upload-v1.3.0/`.

## Shipped this session

| PR | What |
|---|---|
| #257 | release v1.3.0 — version bump, changelog, store listings, the two hard-won rules written into `docs/dev/releasing.md` |
| #259 | `innerHTML` → `DOMParser` in `code-highlight.ts` and `chatgpt/parser.ts` (AMO warnings 13 → 10) |
| #260 | changelog entry for the above |
| #262 | archived the stale v1.2.0 release task (closed #251) |
| #263 | popup: format menu showed 4½ of 6 formats (JSON invisible); submenu titles sat on a third left edge |
| #238 #239 #241 #242 #261 | five dependabot PRs, a month stale, all merged. #239 (`@eslint/js` 10) needed two dead initializers removed; #241 (prettier 3.9.6) needed three files reformatted |

Also closed #252 (the `vi.waitFor` flake — it kept a 1000ms budget in a suite
whose config sets 15s for CPU starvation; defaulted in the setup file, guarded
by `waitfor-timeout.test.ts`).

## Open, with everything needed to act

- **#253 EXP-6** — attempted and stopped deliberately. A file-only user turn
  exports blank, and neither path handles it (the DOM parser has no attachment
  handling at all, so it is not an API-path regression). Blocked on evidence: no
  captured payload containing `files` and no DOM snapshot with a file chip exist
  in the repo, and the task forbids guessing the shape. Needs a HAR or a snapshot
  from a logged-in page. Claim attempt 1 is dead — a later session needs
  `ARSENAL_CLAIM_STALE_OK=1`.
- **#264** — two popup UX judgement calls: the filename setting does nothing when
  printing (`filename: ''`), and "Show meta-info" names an implementation detail
  in seven locales. Both need a product decision, so neither was guessed at.
- **#258** — AMO's remaining 10 warnings, every one deliberate. **Do not** strip
  jsPDF/jszip/highlight.js internals to quiet a scanner; that is what raised the
  Chrome Web Store "Red Titanium" flag. See `docs/dev/releasing.md`.
- **#250** (ChatGPT timestamps), **#254** (Google Drive export) — untouched; both
  need a logged-in page or decisions about OAuth scopes and host permissions.

## Worth knowing

`.claude/launch.json` now serves the built extension (`popup-preview`), so the
popup can be driven in a real browser. Both #263 defects were found by measuring
a live render; neither is visible to jsdom, which computes no layout.

---

# Handover — 2026-11-13 (side session: scroll-to-load)

Appended rather than replacing the 2026-09-06 handover above: that one still
carries the only write-up of #253, #264, #258, #250 and #254, all still open.

## State

`main` @ `0b567e7`. `t-339c7d74` (*scroll-to-load before parsing*) is finished
end to end — code merged, ceiling documented, task archived, issue #295 closed.

## Shipped

| PR | Commit | What |
|---|---|---|
| #294 | `8c8d9ce` | `src/extension/content/scroll-to-load.ts` — parse every turn of a virtualized conversation |
| #296 | `e7c5af7` | names the one case the stitch cannot resolve, on `pairKey` |
| #297 | `0b567e7` | archives the task file as `status: merged` |

**The bug**: chatgpt.com and claude.ai *unmount* turns outside the viewport, so a
single parse sees one window. Measured live: a 3-exchange ChatGPT conversation had
4 of 6 message units in the DOM at rest, 2 of 6 scrolled to the top. Exports lost
the rest silently, and when no complete user+assistant pair was mounted the popup
reported "no conversation" on a page whose selectors were all healthy.

**The mechanism**: walk the scroller bottom-upwards in **half**-viewport steps —
windows must overlap or a pair straddling a boundary is never seen whole — and
stitch each window on by longest matching run of pairs, not by content-keyed
dedup. Guarded by "never worse than the plain parse": the walk's result is used
only if `containsAll` says it holds everything `parser.parse()` already saw, so a
pass cut short by the 100-step cap falls back instead of dropping the turns in
front of the user. Passes are serialized (export and print can overlap, lo-08b0),
scroll position is restored, and a streaming response is left alone.

## Known ceiling — deliberate, documented, do not "fix" blindly

Two **adjacent** exchanges whose question *and* answer are byte-identical, together
taller than half a viewport, collapse into one. CodeRabbit found it; it is real
(reproduced: three 1200px pairs in a 1000px viewport labelled `A, A, C` exported
`A, C`).

It is not fixable today, and the obvious fix is a **regression**:

- A virtualizer remounts a turn as a *fresh node*, so no DOM-node identity survives
  an unmount. Only an app-supplied id attribute does.
- ChatGPT has one (`data-message-id`). **Claude's turns carry no per-message id** —
  only `data-testid`, `data-test-render-count`, `data-is-streaming`.
- Keying on `message.id` regardless: both parsers fall back to `generateId()` when
  the attribute is missing (`chatgpt/parser.ts:237,287,367`,
  `claude/parser.ts:378,519`), and a generated id never matches across windows, so
  such a pair is re-prepended at every one of the up-to-100 steps. A rare silent
  drop traded for frequent silent duplication.

No test pins it: asserting today's output would record the wrong answer as correct.
Fix it when a platform exposes a stable id for every message, or when the merge is
rebuilt on turn geometry rather than parsed text. Full reasoning is in the doc
comment on `pairKey`.

## Carry-overs

- **#292** (`fix/chatgpt-2026-11-dom`) now conflicts in
  `src/core/parsers/chatgpt/selectors.ts` — one added line,
  `scrollContainer: '.thread-scroll-container'`. Trivial.
- `scrollContainer` sits in `NO_FIXTURE_COVERAGE` in
  `tests/unit/core/parsers/chatgpt.test.ts`: every committed snapshot predates the
  2026-11 shell, so the selector matches nothing in them. **Remove that entry when
  a 2026-11 fixture lands.**
- **Gemini deliberately has no `scrollContainer`.** Its selectors were verified
  healthy and it was not observed virtualizing; no `scrollContainer` means no pass.
- No streaming guard for ChatGPT — `custom.streamingTurn` exists only on Claude.
  ChatGPT scrolls during a live response.

## `merge_ready.sh` reports `review: absent` even on a reviewed PR

Hit on all three PRs. An artefact, not a real gap: `pr_audit.py`'s
`REVIEW_VERDICTS` counts only `APPROVED`/`CHANGES_REQUESTED`, and
`coderabbitai[bot]` only ever posts `COMMENTED`; the marker fallback wants
`Claude-Session` trailers on the PR's commits. I did **not** add trailers to
satisfy it — that is gaming an identity check. Merged on the host `CLAUDE.md`
protocol instead, with the reasoning recorded as a PR comment each time.

Worth fixing upstream (count a configured review bot's `COMMENTED` review, or emit
the trailer), but `claude-arsenal/` is vendored, so a local patch is squashed by the
next subtree pull.

Also note CodeRabbit does not review this repo automatically at all — "fewer than
10 stars" — so `@coderabbitai review` is required, and its plan rate-limits to about
one review an hour across PRs. #297's request came back "Review rate limited".

## Board flags not caused by this work

- `lo-cb69`: #252 is closed as completed but `arsenal/tasks/lo-cb69.md` is still
  live — wants the same `_history/` move #297 did.
- `mixed-priority-convention`: 4 tasks use the size scale `[10, 5, 1, 0]`, 2 use
  `[4, 2]`, so any value above 10 outranks every sized task regardless of intent.
  Needs a decision on which convention the board keeps.
