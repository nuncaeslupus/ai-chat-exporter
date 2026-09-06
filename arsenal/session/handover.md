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
