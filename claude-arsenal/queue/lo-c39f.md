# Payload: lo-c39f — R1: popup shell (fixed box, tokens, view router)

**Spec: `docs/design/popup-redesign.md`** — read it first. It is the approved
direction (5a), hifi, with every colour, size and height measured. This task
builds the frame every other R-task paints inside.

## Acceptance gate

**Gate**: the popup is a 360 × 310 box (48 px header + 260 px body + 2 px border)
in **every** state — ready, submenu, warning, unsupported, reload — and never
changes height. All four host gates pass.

```bash
pnpm lint && pnpm typecheck && pnpm test:run && pnpm build
```

## Work

1. `* { box-sizing: border-box }` in the `popup.css` reset — it is missing today
   and several heights in the spec depend on it (spec note 1 and 3).
2. Header: fixed 48 px, `#06342A`, padding `12px 16px`, logo 24 px, name, version
   from the manifest (keep `renderVersion()`), status pill on the right.
3. Body: **fixed 260 px**, `box-sizing:border-box; overflow:hidden; min-height:0`.
   Every state renders inside it. Anything that grows scrolls in a
   `flex:1; overflow-y:auto; min-height:0` child, with headers/footers `flex:none`
   and list rows `flex:none` (spec note 2 — without it the rows shrink).
4. Design tokens as CSS custom properties on `:root`, named for their role, from
   the token table in the spec. Do not inline hex values in component rules —
   `lo-934c` (dark mode) swaps this table and nothing else.
5. View router: `view: 'main' | 'content' | 'options' | 'filename'` plus
   `formatMenuOpen: boolean`, and the UI state
   `'detecting' | 'ready' | 'noSelection' | 'warning' | 'unsupported' | 'reload' | 'error'`.
   Only the router and the empty view containers here — the views themselves are
   R2/R4/R5/R6/R7. `Esc` returns to `main`.

Port the **existing** popup behaviour into the new shell unchanged; this task
changes structure, not features. Nothing may regress.

## Tests

`tests/unit/extension/popup/` — jsdom tests for the router: each `view` shows
exactly one view container; `Esc` from any submenu returns to `main`; the body
container keeps its height class across every UI state. Assert the state
machine, not pixel values.

## Location

`src/extension/popup/popup.html`, `popup.css`, `popup.ts`.

## Note

This task **blocks the whole redesign**. Keep it structural and boring; resist
implementing any view here.
