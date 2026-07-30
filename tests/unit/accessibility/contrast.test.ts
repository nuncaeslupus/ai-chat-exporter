/**
 * WCAG AA contrast regression check.
 *
 * Reads the actual color declarations out of popup.css and html-exporter.ts
 * (resolving CSS custom properties) and asserts every text/background pair
 * meets WCAG AA (4.5:1 normal text, 3:1 large text), so a future palette
 * edit that reintroduces a low-contrast pair fails this test instead of
 * shipping silently.
 *
 * Both palettes are checked. The pair lists are built once and evaluated
 * per mode: the popup's dark mode swaps only the `:root` token table, so the
 * same selector/property pairs resolve against the dark values; the exported
 * document's dark mode overrides whole rules, so each pair falls back to its
 * light declaration when dark does not restate it. A dark value that fails AA
 * therefore fails here exactly like a light one — no half-covered palette.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { CODE_TOKEN_COLOR, COLOR } from '../../../src/core/exporters/style-tokens';

const popupCss = readFileSync(
  resolve(__dirname, '../../../src/extension/popup/popup.css'),
  'utf-8'
);
const exporterTs = readFileSync(
  resolve(__dirname, '../../../src/core/exporters/html-exporter.ts'),
  'utf-8'
);

// --- WCAG contrast math ---
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function toLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(hexToRgb(fg));
  const l2 = relativeLuminance(hexToRgb(bg));
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

// --- tiny CSS lookups against the real source text ---
function normalizeColor(value: string): string {
  const trimmed = value.trim();
  if (trimmed === 'white') return '#ffffff';
  if (trimmed === 'black') return '#000000';
  return trimmed;
}

/**
 * Index of the `}` that closes the `{` at `braceStart`, counting brace depth
 * so a `${...}` template expression's own `}` (as used by html-exporter.ts's
 * style-tokens interpolations) doesn't get mistaken for the rule's closer.
 */
function matchingBraceEnd(css: string, braceStart: number): number {
  let depth = 1;
  for (let i = braceStart + 1; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced braces starting at ${String(braceStart)}`);
}

/** Text of the first `{...}` block whose opening brace follows `selector`, if present. */
function findBlock(css: string, selector: string): string | undefined {
  const idx = css.indexOf(selector);
  if (idx === -1) return undefined;
  const braceStart = css.indexOf('{', idx);
  return css.slice(braceStart, matchingBraceEnd(css, braceStart));
}

function blockOf(css: string, selector: string): string {
  const block = findBlock(css, selector);
  if (block === undefined) throw new Error(`selector not found: ${selector}`);
  return block;
}

/**
 * Value of `prop` inside `selector`'s block, or undefined when either the
 * selector or the declaration is absent — the "dark mode does not restate this
 * rule" case, which the dark resolver below turns into a light-value fallback.
 */
function findDecl(css: string, selector: string, prop: string): string | undefined {
  const block = findBlock(css, selector);
  if (block === undefined) return undefined;
  // Negative lookbehind avoids matching "color:" inside "background-color:"
  // (or any other `-color:`) when `prop` is the bare "color" property.
  const match = new RegExp(`(?<![\\w-])${prop}:\\s*([^;]+);`).exec(block);
  const value = match?.[1];
  return value === undefined ? undefined : normalizeColor(value);
}

/** Value of `prop` inside the first `{...}` block whose text starts with `selector`. */
function declValue(css: string, selector: string, prop: string): string {
  // blockOf first, so a renamed selector still fails loudly rather than
  // silently dropping the assertion.
  blockOf(css, selector);
  const value = findDecl(css, selector, prop);
  if (value === undefined) throw new Error(`no ${prop} declaration in ${selector}`);
  return value;
}

/**
 * Custom properties declared in one block.
 *
 * Scoped deliberately: popup.css now declares the same token names twice, once
 * in `:root` and once in the `prefers-color-scheme: dark` block. A file-wide
 * scan would let the dark values silently overwrite the light ones and quietly
 * stop testing the light palette at all, so each table is read from its own
 * block and the pairs are evaluated against one table at a time.
 */
function varsIn(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    const name = m[1];
    const value = m[2];
    if (name && value) vars[name] = value;
  }
  return vars;
}

const popupLightVars = varsIn(blockOf(popupCss, ':root {'));
const popupDarkVars = {
  ...popupLightVars,
  ...varsIn(blockOf(popupCss, '@media (prefers-color-scheme: dark)')),
};

/** Resolves `var(--x)` against the given popup token table. */
function popupColorIn(vars: Record<string, string>, selector: string, prop: string): string {
  const raw = declValue(popupCss, selector, prop);
  const varMatch = /^var\((--[\w-]+)\)$/.exec(raw);
  const varName = varMatch?.[1];
  if (!varName) return raw;
  const resolved = vars[varName];
  if (!resolved) throw new Error(`unresolved custom property ${varName}`);
  return resolved;
}
/**
 * html-exporter.ts now sources its palette from style-tokens.ts's `COLOR`
 * object via `${COLOR.foo.bar}` template interpolations rather than literal
 * hex strings. Resolve those expressions against the real, imported module
 * so this test keeps checking the actual rendered colour, not a template
 * placeholder.
 */
function resolveColorExpr(raw: string): string {
  const match = /^\$\{COLOR\.([\w.]+)\}$/.exec(raw.trim());
  const capture = match?.[1];
  if (!capture) return raw;

  let value: unknown = COLOR;
  for (const key of capture.split('.')) {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`could not resolve token expression: ${raw}`);
    }
    value = (value as Record<string, unknown>)[key];
  }
  if (typeof value !== 'string') {
    throw new Error(`could not resolve token expression: ${raw}`);
  }
  return value;
}

function exporterColor(selector: string, prop: string): string {
  return resolveColorExpr(declValue(exporterTs, selector, prop));
}

/**
 * The exported document's dark mode overrides whole rules rather than a token
 * table, and only overrides what has to change — a rule it leaves alone (the
 * already-dark `pre` block, say) keeps its light declaration in both modes.
 * So resolve against the dark block first and fall back to the light rule.
 */
const exporterDarkCss = blockOf(exporterTs, '@media screen and (prefers-color-scheme: dark)');
function exporterDarkColor(selector: string, prop: string): string {
  const dark = findDecl(exporterDarkCss, selector, prop);
  return dark === undefined ? exporterColor(selector, prop) : resolveColorExpr(dark);
}

interface Pair {
  label: string;
  fg: string;
  bg: string;
  threshold: 4.5 | 3;
}

/** Resolves a colour declaration for one palette. */
type Resolve = (selector: string, prop: string) => string;

function makePopupPairs(popupColor: Resolve): Pair[] {
  return [
    {
      label: 'popup body text',
      fg: popupColor('body {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'popup-version',
      fg: popupColor('.popup-version {', 'color'),
      bg: popupColor('.popup-header {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'status-text',
      fg: popupColor('.status-text {', 'color'),
      bg: popupColor('.popup-header {', 'background'),
      threshold: 4.5,
    },
    // P-4: the gear icon button, beside the status pill.
    {
      label: 'header gear icon',
      fg: popupColor('.header-gear {', 'color'),
      bg: popupColor('.popup-header {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'conversation-title',
      fg: popupColor('.conversation-title {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'conversation-meta',
      fg: popupColor('.conversation-meta-text {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'setting-row label',
      fg: popupColor('.setting-row-label {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'setting-row label (hover bg)',
      fg: popupColor('.setting-row-label {', 'color'),
      bg: popupColor('.setting-row:hover {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'setting-row value',
      fg: popupColor('.setting-row-value {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'setting-row value (hover bg)',
      fg: popupColor('.setting-row-value {', 'color'),
      bg: popupColor('.setting-row:hover {', 'background'),
      threshold: 4.5,
    },
    // Chevrons are decorative marks, not text, so they answer to 3:1 — but they
    // were unasserted entirely until lo-78c0, which is how --color-text-muted sat
    // at 2.54:1 (under even that bar) through the whole redesign.
    {
      label: 'setting-row chevron',
      fg: popupColor('.setting-row-chevron {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 3,
    },
    {
      label: 'setting-row chevron (hover bg)',
      fg: popupColor('.setting-row-chevron {', 'color'),
      bg: popupColor('.setting-row:hover {', 'background'),
      threshold: 3,
    },
    {
      label: 'split export label',
      fg: popupColor('.split-button {', 'color'),
      bg: popupColor('.split-button {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'split export label (hover bg)',
      fg: popupColor('.split-button {', 'color'),
      bg: popupColor('.split-export:hover:not(:disabled) {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'print button icon',
      fg: popupColor('.print-button {', 'color'),
      bg: popupColor('.print-button {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'print button icon (hover bg)',
      fg: popupColor('.print-button {', 'color'),
      bg: popupColor('.print-button:hover:not(:disabled) {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'privacy line',
      fg: popupColor('.privacy-line {', 'color'),
      bg: popupColor('.action-bar {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'kbd text',
      fg: popupColor('kbd {', 'color'),
      bg: popupColor('kbd {', 'background-color'),
      threshold: 4.5,
    },
    // Secondary states (R7). The spec's amber palette is only partly AA-safe,
    // so these pairs are the gate that keeps the darkened values in place.
    {
      label: 'state-title',
      fg: popupColor('.state-title {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'state-help',
      fg: popupColor('.state-help {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'state-button label',
      fg: popupColor('.state-button {', 'color'),
      bg: popupColor('.state-button {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'state-button label (hover bg)',
      fg: popupColor('.state-button {', 'color'),
      bg: popupColor('.state-button:hover {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'platform-link name',
      fg: popupColor('.platform-link-name {', 'color'),
      bg: popupColor('.platform-link {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'platform-link name (hover bg)',
      fg: popupColor('.platform-link-name {', 'color'),
      bg: popupColor('.platform-link:hover {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'warning-card title',
      fg: popupColor('.warning-card-title {', 'color'),
      bg: popupColor('.warning-card {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'warning-card detail',
      fg: popupColor('.warning-card-detail {', 'color'),
      bg: popupColor('.warning-card {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'warning-card retry link',
      fg: popupColor('.warning-card-retry {', 'color'),
      bg: popupColor('.warning-card {', 'background'),
      threshold: 4.5,
    },
    // Drift row. It currently borrows the warning tokens, so it passes by
    // inheritance -- which is exactly why it needs its own rows here: nothing
    // would catch a later change that gave it bespoke colours.
    //
    // The 1px border is not listed: `popupColor` resolves a bare `var(--x)`,
    // not the `border` shorthand, and no other pair in this suite checks a
    // border either. Measured by hand at 3.42:1 (light, #b07a0f on #fdf4e7)
    // and 7.47:1 (dark, #e0a93c on #2a2114) -- both clear the 3:1 non-text
    // bar. The row's icon is `currentColor`, so the title pair covers it.
    {
      label: 'drift-row title',
      fg: popupColor('.drift-row {', 'color'),
      bg: popupColor('.drift-row {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'drift report preview text',
      fg: popupColor('.drift-report-preview {', 'color'),
      bg: popupColor('.drift-report-preview {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'drift report intro',
      fg: popupColor('.drift-report-intro {', 'color'),
      bg: popupColor('.popup-body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'drift report Copy button (text on footer)',
      fg: popupColor('.drift-report-secondary {', 'color'),
      bg: popupColor('.submenu-footer {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'no-selection row label',
      fg: popupColor(
        ".popup-body[data-ui-state='noSelection'] .setting-row[data-nav='content'] .setting-row-label {",
        'color'
      ),
      bg: popupColor(
        ".popup-body[data-ui-state='noSelection'] .setting-row[data-nav='content'] {",
        'background'
      ),
      threshold: 4.5,
    },
    {
      label: 'no-selection row action',
      fg: popupColor(
        ".popup-body[data-ui-state='noSelection'] .setting-row[data-nav='content'] .setting-row-value {",
        'color'
      ),
      bg: popupColor(
        ".popup-body[data-ui-state='noSelection'] .setting-row[data-nav='content'] {",
        'background'
      ),
      threshold: 4.5,
    },
    {
      label: 'no-selection row chevron',
      fg: popupColor(
        ".popup-body[data-ui-state='noSelection'] .setting-row[data-nav='content'] .setting-row-chevron {",
        'color'
      ),
      bg: popupColor(
        ".popup-body[data-ui-state='noSelection'] .setting-row[data-nav='content'] {",
        'background'
      ),
      threshold: 3,
    },
    // Format menu (R3). Its surface is the menu card, not the page background.
    {
      label: 'format-menu label',
      fg: popupColor('.format-menu-label {', 'color'),
      bg: popupColor('.format-menu {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'format-row name',
      fg: popupColor('.format-row-name {', 'color'),
      bg: popupColor('.format-menu {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'format-row name (hover bg)',
      fg: popupColor('.format-row-name {', 'color'),
      bg: popupColor('.format-row:hover {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'format-row name (selected)',
      fg: popupColor(".format-row[aria-checked='true'] .format-row-name {", 'color'),
      bg: popupColor(".format-row[aria-checked='true'] {", 'background'),
      threshold: 4.5,
    },
    {
      label: 'format-row check mark (selected)',
      fg: popupColor('.format-row-check {', 'color'),
      bg: popupColor(".format-row[aria-checked='true'] {", 'background'),
      threshold: 3,
    },
    // Pair chooser (R4). Rows sit on the page background until expanded, when
    // they gain the bar tint — every text colour has to clear both.
    {
      label: 'submenu title',
      fg: popupColor('.submenu-title {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'submenu back chevron',
      fg: popupColor('.submenu-back {', 'color'),
      bg: popupColor('.submenu-back {', 'background'),
      threshold: 3,
    },
    {
      label: 'pair chooser All/None link',
      fg: popupColor('.pair-chooser-toggle-all {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'pair number',
      fg: popupColor('.pair-row-number {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'pair number (expanded tint)',
      fg: popupColor('.pair-row-number {', 'color'),
      bg: popupColor(".pair-row[data-expanded='true'] {", 'background'),
      threshold: 4.5,
    },
    {
      label: 'pair question',
      fg: popupColor('.pair-row-text {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'pair question (expanded tint)',
      fg: popupColor('.pair-row-text {', 'color'),
      bg: popupColor(".pair-row[data-expanded='true'] {", 'background'),
      threshold: 4.5,
    },
    {
      label: 'pair question (deselected)',
      fg: popupColor(".pair-row[data-selected='false'] .pair-row-text {", 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'pair more/less link',
      fg: popupColor('.pair-row-toggle {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'pair more/less link (expanded tint)',
      fg: popupColor('.pair-row-toggle {', 'color'),
      bg: popupColor(".pair-row[data-expanded='true'] {", 'background'),
      threshold: 4.5,
    },
    {
      label: 'day separator date',
      fg: popupColor('.pair-day-label {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'pair chooser summary',
      fg: popupColor('.pair-chooser-summary {', 'color'),
      bg: popupColor('.submenu-footer {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'submenu Done label',
      fg: popupColor('.submenu-done {', 'color'),
      bg: popupColor('.submenu-done {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'submenu Done label (hover bg)',
      fg: popupColor('.submenu-done {', 'color'),
      bg: popupColor('.submenu-done:hover {', 'background'),
      threshold: 4.5,
    },
    // Options submenu (R5). Rows sit on the page background, the footer on the bar.
    {
      label: 'option-row label',
      fg: popupColor('.option-row-label {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'option-row filename preview',
      fg: popupColor('.option-row-filename {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'option-row nav chevron',
      fg: popupColor('.option-row-chevron {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 3,
    },
    {
      label: 'option-row nav chevron (hover)',
      fg: popupColor('.option-row--nav:hover .option-row-chevron {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 3,
    },
    {
      label: 'options footer text',
      fg: popupColor('.options-footer {', 'color'),
      bg: popupColor('.submenu-footer {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'options footer link',
      fg: popupColor('.options-footer-link {', 'color'),
      bg: popupColor('.submenu-footer {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'options footer link (hover)',
      fg: popupColor('.options-footer-link:hover {', 'color'),
      bg: popupColor('.submenu-footer {', 'background'),
      threshold: 4.5,
    },
    // The separator dots are the other half of --color-text-muted's remit, and
    // decorative like the chevrons — same 3:1 bar, painted as a background.
    {
      label: 'options footer separator dot',
      fg: popupColor('.options-footer-dot {', 'background'),
      bg: popupColor('.submenu-footer {', 'background'),
      threshold: 3,
    },
    // File name builder (R6). The chips sit on the sunken field, the resulting
    // name on the footer bar — every one of them reuses an existing token.
    {
      label: 'filename Default link',
      fg: popupColor('.filename-default {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'filename Default link (hover)',
      fg: popupColor('.filename-default:hover {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'filename piece chip',
      fg: popupColor('.filename-chip {', 'color'),
      bg: popupColor('.filename-chip {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'filename piece remove button',
      fg: popupColor('.filename-chip-remove {', 'color'),
      bg: popupColor('.filename-chip-remove {', 'background'),
      threshold: 3,
    },
    {
      label: 'filename piece remove button (hover bg)',
      fg: popupColor('.filename-chip-remove {', 'color'),
      bg: popupColor('.filename-chip-remove:hover {', 'background'),
      threshold: 3,
    },
    {
      label: 'filename `_` separator',
      fg: popupColor('.filename-separator {', 'color'),
      bg: popupColor('.filename-field {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'filename add chip',
      fg: popupColor('.filename-add-chip {', 'color'),
      bg: popupColor('.filename-add-chip {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'filename add chip (hover)',
      fg: popupColor('.filename-add-chip:hover {', 'color'),
      bg: popupColor('.filename-add-chip {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'filename drag hint',
      fg: popupColor('.filename-hint {', 'color'),
      bg: popupColor('body {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'filename resulting name',
      fg: popupColor('.filename-footer-name {', 'color'),
      bg: popupColor('.submenu-footer {', 'background'),
      threshold: 4.5,
    },
    {
      label: 'filename footer icon',
      fg: popupColor('.filename-footer-icon {', 'color'),
      bg: popupColor('.submenu-footer {', 'background'),
      threshold: 3,
    },
    // Unsupported page dims the header; the same text tokens ride on it.
    {
      label: 'popup-version (dimmed header)',
      fg: popupColor('.popup-version {', 'color'),
      bg: popupColor("body[data-ui-state='unsupported'] .popup-header {", 'background'),
      threshold: 4.5,
    },
    {
      label: 'status-text (dimmed header)',
      fg: popupColor('.status-text {', 'color'),
      bg: popupColor("body[data-ui-state='unsupported'] .popup-header {", 'background'),
      threshold: 4.5,
    },
    {
      label: 'popup-title (dimmed header)',
      fg: popupColor('.popup-title {', 'color'),
      bg: popupColor("body[data-ui-state='unsupported'] .popup-header {", 'background'),
      threshold: 4.5,
    },
  ];
}

/**
 * The colour an assistant message actually shows. R-6 made it transparent, so
 * the visible background is the page's.
 */
function bodyBgBehindAssistant(exporterColor: Resolve): string {
  const declared = exporterColor('.assistant-message {', 'background');
  return /^(transparent|none)$/i.test(declared.trim())
    ? exporterColor('body {', 'background-color')
    : declared;
}

function makeExporterPairs(exporterColor: Resolve): Pair[] {
  // Ambient container backgrounds used by several exported-HTML text rules.
  const headerBg = exporterColor('.header {', 'background');
  const userMsgBg = exporterColor('.user-message {', 'background');
  /**
   * R-6 moved the turn fill onto the QUESTION, so `.assistant-message` now
   * declares `background: transparent` — it shows whatever is behind it, which
   * is the page. Contrast against the literal keyword is meaningless, so resolve
   * it to the body background it actually reveals.
   */
  const assistantMsgBg = bodyBgBehindAssistant(exporterColor);
  const bodyBg = exporterColor('body {', 'background-color');
  const artifactBg = exporterColor('.artifact {', 'background');
  const artifactUserBg = exporterColor('.user-message .artifact {', 'background');
  const searchResultBg = exporterColor('.search-result {', 'background');
  const searchResultUserBg = exporterColor('.user-message .search-result {', 'background');
  /**
   * R-6 dropped `th`'s own fill (horizontal rules only), so header text sits on
   * whichever message contains it. The tinted question fill is the darker of the
   * two containers, so checking against it is the strict case.
   */
  const thBg = userMsgBg;
  const preBg = exporterColor('.message-content pre {', 'background');

  return [
    { label: 'export body text', fg: exporterColor('body {', 'color'), bg: bodyBg, threshold: 4.5 },
    {
      label: 'export .title (32px/700, large text)',
      fg: exporterColor('.title {', 'color'),
      bg: headerBg,
      threshold: 3,
    },
    {
      label: 'export .metadata',
      fg: exporterColor('.metadata {', 'color'),
      bg: headerBg,
      threshold: 4.5,
    },
    {
      label: 'export .metadata-value',
      fg: exporterColor('.metadata-value {', 'color'),
      bg: headerBg,
      threshold: 4.5,
    },
    {
      label: 'export .metadata-value a',
      fg: exporterColor('.metadata-value a {', 'color'),
      bg: headerBg,
      threshold: 4.5,
    },
    {
      label: 'user-message .message-role',
      fg: exporterColor('.user-message .message-role {', 'color'),
      bg: userMsgBg,
      threshold: 4.5,
    },
    {
      label: 'assistant-message .message-role (default)',
      fg: exporterColor('.assistant-message .message-role {', 'color'),
      bg: assistantMsgBg,
      threshold: 4.5,
    },
    {
      label: 'assistant-message .message-role (chatgpt)',
      fg: exporterColor('.assistant-message[data-platform="chatgpt"] .message-role {', 'color'),
      bg: assistantMsgBg,
      threshold: 4.5,
    },
    {
      label: 'assistant-message .message-role (claude)',
      fg: exporterColor('.assistant-message[data-platform="claude"] .message-role {', 'color'),
      bg: assistantMsgBg,
      threshold: 4.5,
    },
    {
      label: 'assistant-message .message-role (gemini)',
      fg: exporterColor('.assistant-message[data-platform="gemini"] .message-role {', 'color'),
      bg: assistantMsgBg,
      threshold: 4.5,
    },
    {
      label: 'pre code text',
      fg: exporterColor('.message-content pre {', 'color'),
      bg: preBg,
      threshold: 4.5,
    },
    {
      label: 'blockquote on user (tinted) bg',
      fg: exporterColor('.message-content blockquote {', 'color'),
      bg: userMsgBg,
      threshold: 4.5,
    },
    {
      label: 'blockquote on assistant (page) bg',
      fg: exporterColor('.message-content blockquote {', 'color'),
      bg: assistantMsgBg,
      threshold: 4.5,
    },
    {
      label: 'message-content a on user (tinted) bg',
      fg: exporterColor('.message-content a {', 'color'),
      bg: userMsgBg,
      threshold: 4.5,
    },
    {
      label: 'message-content a on assistant (page) bg',
      fg: exporterColor('.message-content a {', 'color'),
      bg: assistantMsgBg,
      threshold: 4.5,
    },
    {
      label: 'message-content th text',
      fg: exporterColor('body {', 'color'),
      bg: thBg,
      threshold: 4.5,
    },
    {
      label: 'artifacts-section h3 on user (tinted) bg',
      fg: exporterColor('.artifacts-section h3 {', 'color'),
      bg: userMsgBg,
      threshold: 4.5,
    },
    {
      label: 'artifacts-section h3 on assistant (page) bg',
      fg: exporterColor('.artifacts-section h3 {', 'color'),
      bg: assistantMsgBg,
      threshold: 4.5,
    },
    {
      label: 'web-searches-section h3 on user (tinted) bg',
      fg: exporterColor('.web-searches-section h3 {', 'color'),
      bg: userMsgBg,
      threshold: 4.5,
    },
    {
      label: 'web-searches-section h3 on assistant (page) bg',
      fg: exporterColor('.web-searches-section h3 {', 'color'),
      bg: assistantMsgBg,
      threshold: 4.5,
    },
    {
      label: 'artifact h4 (default bg)',
      fg: exporterColor('.artifact h4 {', 'color'),
      bg: artifactBg,
      threshold: 4.5,
    },
    {
      label: 'artifact h4 (user-message bg)',
      fg: exporterColor('.artifact h4 {', 'color'),
      bg: artifactUserBg,
      threshold: 4.5,
    },
    {
      label: 'artifact-type (default bg)',
      fg: exporterColor('.artifact-type {', 'color'),
      bg: artifactBg,
      threshold: 4.5,
    },
    {
      label: 'artifact-type (user-message bg)',
      fg: exporterColor('.artifact-type {', 'color'),
      bg: artifactUserBg,
      threshold: 4.5,
    },
    {
      label: 'web-search h4 on user (tinted) bg',
      fg: exporterColor('.web-search h4 {', 'color'),
      bg: userMsgBg,
      threshold: 4.5,
    },
    {
      label: 'web-search h4 on assistant (page) bg',
      fg: exporterColor('.web-search h4 {', 'color'),
      bg: assistantMsgBg,
      threshold: 4.5,
    },
    {
      label: 'search-count on user (tinted) bg',
      fg: exporterColor('.search-count {', 'color'),
      bg: userMsgBg,
      threshold: 4.5,
    },
    {
      label: 'search-count on assistant (page) bg',
      fg: exporterColor('.search-count {', 'color'),
      bg: assistantMsgBg,
      threshold: 4.5,
    },
    {
      label: 'result-title (default bg)',
      fg: exporterColor('.result-title {', 'color'),
      bg: searchResultBg,
      threshold: 4.5,
    },
    {
      label: 'result-title (user-message bg)',
      fg: exporterColor('.result-title {', 'color'),
      bg: searchResultUserBg,
      threshold: 4.5,
    },
    {
      label: 'result-domain (default bg)',
      fg: exporterColor('.result-domain {', 'color'),
      bg: searchResultBg,
      threshold: 4.5,
    },
    {
      label: 'result-domain (user-message bg)',
      fg: exporterColor('.result-domain {', 'color'),
      bg: searchResultUserBg,
      threshold: 4.5,
    },
    {
      label: 'export .footer text',
      fg: exporterColor('.footer {', 'color'),
      bg: bodyBg,
      threshold: 4.5,
    },
  ];
}

/**
 * R-8/R-9: the five code-token colours on the code background.
 *
 * This replaced the GitHub-Dark hljs theme, which was a dark block dropped onto
 * a light page and unrelated to the document's own palette. The five tokens are
 * checked two ways: WCAG AA against the block background, and pairwise greyscale
 * separation — the design claims they stay distinguishable printed in black and
 * white, and that claim is worth asserting rather than trusting.
 */
const codeBg = exporterColor('.message-content pre {', 'background');

const codeTokenPairs: Pair[] = [
  {
    label: 'code block base text',
    fg: exporterColor('.message-content pre {', 'color'),
    bg: codeBg,
    threshold: 4.5,
  },
  ...(Object.keys(CODE_TOKEN_COLOR) as (keyof typeof CODE_TOKEN_COLOR)[]).map((token) => ({
    label: `code token ${token}`,
    fg: CODE_TOKEN_COLOR[token],
    bg: codeBg,
    threshold: 4.5 as const,
  })),
];

// The code tokens are one palette in both modes (the block keeps a light
// background), so they are checked once, with the light palette.
const palettes: { mode: string; pairs: Pair[] }[] = [
  {
    mode: 'light',
    pairs: [
      ...makePopupPairs((s, p) => popupColorIn(popupLightVars, s, p)),
      ...makeExporterPairs(exporterColor),
      ...codeTokenPairs,
    ],
  },
  {
    mode: 'dark',
    pairs: [
      ...makePopupPairs((s, p) => popupColorIn(popupDarkVars, s, p)),
      ...makeExporterPairs(exporterDarkColor),
    ],
  },
];

describe.each(palettes)('WCAG AA contrast — $mode palette', ({ mode, pairs }) => {
  it('resolves a full pair list', () => {
    expect(pairs.length).toBeGreaterThan(80);
  });

  it.each(pairs)('$label meets its WCAG AA threshold ($fg on $bg)', ({ fg, bg, threshold }) => {
    const ratio = contrastRatio(fg, bg);
    expect(ratio).toBeGreaterThanOrEqual(threshold);
  });

  it('actually swaps palettes between modes', () => {
    const bodyBg = pairs.find((p) => p.label === 'popup body text')?.bg;
    expect(bodyBg).toBe(mode === 'dark' ? '#141e1b' : '#ffffff');
  });
});

/**
 * R-9: the five code tokens stay distinguishable printed in greyscale.
 *
 * They did not, originally. The design's values differed almost entirely in
 * HUE, which greyscale discards: `function` and `number` measured 0.0024 apart
 * — the same grey — and four of ten pairs were under 0.02. The palette was
 * retuned to spread relative luminance while holding each hue family, solved
 * against two constraints at once: WCAG AA on the code background (which caps
 * foreground luminance at 0.1520) and a minimum pairwise gap.
 *
 * Both halves are asserted here, because satisfying one alone is easy and
 * satisfying both is what took the solve.
 */
describe('R-9: code tokens survive greyscale printing', () => {
  const tokens = Object.entries(CODE_TOKEN_COLOR) as [string, string][];

  const gap = (a: string, b: string): number =>
    Math.abs(relativeLuminance(hexToRgb(a)) - relativeLuminance(hexToRgb(b)));

  it('declares exactly five tokens, so the set stays checkable by eye', () => {
    expect(tokens).toHaveLength(5);
  });

  it('separates every pair by at least 0.02 relative luminance', () => {
    // 0.02 is about the smallest step that stays distinguishable side by side in
    // print. Listing the offenders rather than asserting a bare minimum makes a
    // regression name the two colours that collapsed.
    const tooClose: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const [nameA, hexA] = tokens[i]!;
        const [nameB, hexB] = tokens[j]!;
        const d = gap(hexA, hexB);
        if (d < 0.02) tooClose.push(`${nameA} (${hexA}) vs ${nameB} (${hexB}): ${d.toFixed(4)}`);
      }
    }
    expect(tooClose).toEqual([]);
  });

  it('orders the tokens by lightness with no ties, so greyscale reads as a ramp', () => {
    const byLuminance = tokens
      .map(([name, hex]) => ({ name, l: relativeLuminance(hexToRgb(hex)) }))
      .sort((a, b) => a.l - b.l);
    for (let i = 1; i < byLuminance.length; i++) {
      expect(byLuminance[i]!.l).toBeGreaterThan(byLuminance[i - 1]!.l);
    }
  });
});
