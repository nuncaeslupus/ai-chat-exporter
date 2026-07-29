/**
 * WCAG AA contrast regression check.
 *
 * Reads the actual color declarations out of popup.css and html-exporter.ts
 * (resolving CSS custom properties) and asserts every text/background pair
 * meets WCAG AA (4.5:1 normal text, 3:1 large text), so a future palette
 * edit that reintroduces a low-contrast pair fails this test instead of
 * shipping silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { COLOR } from '../../../src/core/exporters/style-tokens';

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
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
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

/** Value of `prop` inside the first `{...}` block whose text starts with `selector`. */
function declValue(css: string, selector: string, prop: string): string {
  const idx = css.indexOf(selector);
  if (idx === -1) throw new Error(`selector not found: ${selector}`);
  const braceStart = css.indexOf('{', idx);
  const braceEnd = matchingBraceEnd(css, braceStart);
  const block = css.slice(braceStart, braceEnd);
  // Negative lookbehind avoids matching "color:" inside "background-color:"
  // (or any other `-color:`) when `prop` is the bare "color" property.
  const match = new RegExp(`(?<![\\w-])${prop}:\\s*([^;]+);`).exec(block);
  const value = match?.[1];
  if (value === undefined) throw new Error(`no ${prop} declaration in ${selector}`);
  return normalizeColor(value);
}

/** Resolves `var(--x)` against popup.css's :root custom properties. */
const popupVars: Record<string, string> = {};
for (const m of popupCss.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
  const name = m[1];
  const value = m[2];
  if (name && value) popupVars[name] = value;
}
function popupColor(selector: string, prop: string): string {
  const raw = declValue(popupCss, selector, prop);
  const varMatch = /^var\((--[\w-]+)\)$/.exec(raw);
  const varName = varMatch?.[1];
  if (!varName) return raw;
  const resolved = popupVars[varName];
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

// Ambient container backgrounds used by several exported-HTML text rules.
const headerBg = exporterColor('.header {', 'background');
const userMsgBg = exporterColor('.user-message {', 'background');
const assistantMsgBg = exporterColor('.assistant-message {', 'background');
const bodyBg = exporterColor('body {', 'background-color');
const artifactBg = exporterColor('.artifact {', 'background');
const artifactUserBg = exporterColor('.user-message .artifact {', 'background');
const searchResultBg = exporterColor('.search-result {', 'background');
const searchResultUserBg = exporterColor('.user-message .search-result {', 'background');
const thBg = exporterColor('.message-content th {', 'background');
const preBg = exporterColor('.message-content pre {', 'background');
const hljsBg = exporterColor('pre code.hljs {', 'background');

interface Pair {
  label: string;
  fg: string;
  bg: string;
  threshold: 4.5 | 3;
}

const popupPairs: Pair[] = [
  { label: 'popup body text', fg: popupColor('body {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'popup-version', fg: popupColor('.popup-version {', 'color'), bg: popupColor('.popup-header {', 'background'), threshold: 4.5 },
  { label: 'status-text', fg: popupColor('.status-text {', 'color'), bg: popupColor('.popup-header {', 'background'), threshold: 4.5 },
  { label: 'conversation-title', fg: popupColor('.conversation-title {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'conversation-meta', fg: popupColor('.conversation-meta-text {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'setting-row label', fg: popupColor('.setting-row-label {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'setting-row label (hover bg)', fg: popupColor('.setting-row-label {', 'color'), bg: popupColor('.setting-row:hover {', 'background'), threshold: 4.5 },
  { label: 'setting-row value', fg: popupColor('.setting-row-value {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'setting-row value (hover bg)', fg: popupColor('.setting-row-value {', 'color'), bg: popupColor('.setting-row:hover {', 'background'), threshold: 4.5 },
  { label: 'split export label', fg: popupColor('.split-button {', 'color'), bg: popupColor('.split-button {', 'background'), threshold: 4.5 },
  { label: 'split export label (hover bg)', fg: popupColor('.split-button {', 'color'), bg: popupColor('.split-export:hover:not(:disabled) {', 'background'), threshold: 4.5 },
  { label: 'print button icon', fg: popupColor('.print-button {', 'color'), bg: popupColor('.print-button {', 'background'), threshold: 4.5 },
  { label: 'print button icon (hover bg)', fg: popupColor('.print-button {', 'color'), bg: popupColor('.print-button:hover:not(:disabled) {', 'background'), threshold: 4.5 },
  { label: 'privacy line', fg: popupColor('.privacy-line {', 'color'), bg: popupColor('.action-bar {', 'background'), threshold: 4.5 },
  { label: 'kbd text', fg: popupColor('kbd {', 'color'), bg: popupColor('kbd {', 'background-color'), threshold: 4.5 },
  // Secondary states (R7). The spec's amber palette is only partly AA-safe,
  // so these pairs are the gate that keeps the darkened values in place.
  { label: 'state-title', fg: popupColor('.state-title {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'state-help', fg: popupColor('.state-help {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'state-button label', fg: popupColor('.state-button {', 'color'), bg: popupColor('.state-button {', 'background'), threshold: 4.5 },
  { label: 'state-button label (hover bg)', fg: popupColor('.state-button {', 'color'), bg: popupColor('.state-button:hover {', 'background'), threshold: 4.5 },
  { label: 'platform-link name', fg: popupColor('.platform-link-name {', 'color'), bg: popupColor('.platform-link {', 'background'), threshold: 4.5 },
  { label: 'platform-link name (hover bg)', fg: popupColor('.platform-link-name {', 'color'), bg: popupColor('.platform-link:hover {', 'background'), threshold: 4.5 },
  { label: 'warning-card title', fg: popupColor('.warning-card-title {', 'color'), bg: popupColor('.warning-card {', 'background'), threshold: 4.5 },
  { label: 'warning-card detail', fg: popupColor('.warning-card-detail {', 'color'), bg: popupColor('.warning-card {', 'background'), threshold: 4.5 },
  { label: 'warning-card retry link', fg: popupColor('.warning-card-retry {', 'color'), bg: popupColor('.warning-card {', 'background'), threshold: 4.5 },
  {
    label: 'no-selection row label',
    fg: popupColor(".popup-body[data-ui-state='noSelection'] .setting-row[data-nav='content'] .setting-row-label {", 'color'),
    bg: popupColor(".popup-body[data-ui-state='noSelection'] .setting-row[data-nav='content'] {", 'background'),
    threshold: 4.5,
  },
  {
    label: 'no-selection row action',
    fg: popupColor(".popup-body[data-ui-state='noSelection'] .setting-row[data-nav='content'] .setting-row-value {", 'color'),
    bg: popupColor(".popup-body[data-ui-state='noSelection'] .setting-row[data-nav='content'] {", 'background'),
    threshold: 4.5,
  },
  // Format menu (R3). Its surface is the menu card, not the page background.
  { label: 'format-menu label', fg: popupColor('.format-menu-label {', 'color'), bg: popupColor('.format-menu {', 'background'), threshold: 4.5 },
  { label: 'format-row name', fg: popupColor('.format-row-name {', 'color'), bg: popupColor('.format-menu {', 'background'), threshold: 4.5 },
  { label: 'format-row name (hover bg)', fg: popupColor('.format-row-name {', 'color'), bg: popupColor('.format-row:hover {', 'background'), threshold: 4.5 },
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
  { label: 'submenu title', fg: popupColor('.submenu-title {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'submenu back chevron', fg: popupColor('.submenu-back {', 'color'), bg: popupColor('.submenu-back {', 'background'), threshold: 3 },
  { label: 'pair chooser All/None link', fg: popupColor('.pair-chooser-toggle-all {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'pair number', fg: popupColor('.pair-row-number {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'pair number (expanded tint)', fg: popupColor('.pair-row-number {', 'color'), bg: popupColor(".pair-row[data-expanded='true'] {", 'background'), threshold: 4.5 },
  { label: 'pair question', fg: popupColor('.pair-row-text {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'pair question (expanded tint)', fg: popupColor('.pair-row-text {', 'color'), bg: popupColor(".pair-row[data-expanded='true'] {", 'background'), threshold: 4.5 },
  {
    label: 'pair question (deselected)',
    fg: popupColor(".pair-row[data-selected='false'] .pair-row-text {", 'color'),
    bg: popupColor('body {', 'background'),
    threshold: 4.5,
  },
  { label: 'pair more/less link', fg: popupColor('.pair-row-toggle {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'pair more/less link (expanded tint)', fg: popupColor('.pair-row-toggle {', 'color'), bg: popupColor(".pair-row[data-expanded='true'] {", 'background'), threshold: 4.5 },
  { label: 'day separator date', fg: popupColor('.pair-day-label {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'pair chooser summary', fg: popupColor('.pair-chooser-summary {', 'color'), bg: popupColor('.submenu-footer {', 'background'), threshold: 4.5 },
  { label: 'submenu Done label', fg: popupColor('.submenu-done {', 'color'), bg: popupColor('.submenu-done {', 'background'), threshold: 4.5 },
  { label: 'submenu Done label (hover bg)', fg: popupColor('.submenu-done {', 'color'), bg: popupColor('.submenu-done:hover {', 'background'), threshold: 4.5 },
  // Options submenu (R5). Rows sit on the page background, the footer on the bar.
  { label: 'option-row label', fg: popupColor('.option-row-label {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'option-row filename preview', fg: popupColor('.option-row-filename {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'options footer text', fg: popupColor('.options-footer {', 'color'), bg: popupColor('.submenu-footer {', 'background'), threshold: 4.5 },
  { label: 'options footer link', fg: popupColor('.options-footer-link {', 'color'), bg: popupColor('.submenu-footer {', 'background'), threshold: 4.5 },
  { label: 'options footer link (hover)', fg: popupColor('.options-footer-link:hover {', 'color'), bg: popupColor('.submenu-footer {', 'background'), threshold: 4.5 },
  // File name builder (R6). The chips sit on the sunken field, the resulting
  // name on the footer bar — every one of them reuses an existing token.
  { label: 'filename Default link', fg: popupColor('.filename-default {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'filename Default link (hover)', fg: popupColor('.filename-default:hover {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'filename piece chip', fg: popupColor('.filename-chip {', 'color'), bg: popupColor('.filename-chip {', 'background'), threshold: 4.5 },
  { label: 'filename piece remove button', fg: popupColor('.filename-chip-remove {', 'color'), bg: popupColor('.filename-chip-remove {', 'background'), threshold: 3 },
  { label: 'filename piece remove button (hover bg)', fg: popupColor('.filename-chip-remove {', 'color'), bg: popupColor('.filename-chip-remove:hover {', 'background'), threshold: 3 },
  { label: 'filename `_` separator', fg: popupColor('.filename-separator {', 'color'), bg: popupColor('.filename-field {', 'background'), threshold: 4.5 },
  { label: 'filename add chip', fg: popupColor('.filename-add-chip {', 'color'), bg: popupColor('.filename-add-chip {', 'background'), threshold: 4.5 },
  { label: 'filename add chip (hover)', fg: popupColor('.filename-add-chip:hover {', 'color'), bg: popupColor('.filename-add-chip {', 'background'), threshold: 4.5 },
  { label: 'filename drag hint', fg: popupColor('.filename-hint {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'filename resulting name', fg: popupColor('.filename-footer-name {', 'color'), bg: popupColor('.submenu-footer {', 'background'), threshold: 4.5 },
  { label: 'filename footer icon', fg: popupColor('.filename-footer-icon {', 'color'), bg: popupColor('.submenu-footer {', 'background'), threshold: 3 },
  // Unsupported page dims the header; the same text tokens ride on it.
  { label: 'popup-version (dimmed header)', fg: popupColor('.popup-version {', 'color'), bg: popupColor("body[data-ui-state='unsupported'] .popup-header {", 'background'), threshold: 4.5 },
  { label: 'status-text (dimmed header)', fg: popupColor('.status-text {', 'color'), bg: popupColor("body[data-ui-state='unsupported'] .popup-header {", 'background'), threshold: 4.5 },
  { label: 'popup-title (dimmed header)', fg: popupColor('.popup-title {', 'color'), bg: popupColor("body[data-ui-state='unsupported'] .popup-header {", 'background'), threshold: 4.5 },
];

const exporterPairs: Pair[] = [
  { label: 'export body text', fg: exporterColor('body {', 'color'), bg: bodyBg, threshold: 4.5 },
  { label: 'export .title (32px/700, large text)', fg: exporterColor('.title {', 'color'), bg: headerBg, threshold: 3 },
  { label: 'export .metadata', fg: exporterColor('.metadata {', 'color'), bg: headerBg, threshold: 4.5 },
  { label: 'export .metadata-value', fg: exporterColor('.metadata-value {', 'color'), bg: headerBg, threshold: 4.5 },
  { label: 'export .metadata-value a', fg: exporterColor('.metadata-value a {', 'color'), bg: headerBg, threshold: 4.5 },
  { label: 'user-message .message-role', fg: exporterColor('.user-message .message-role {', 'color'), bg: userMsgBg, threshold: 4.5 },
  { label: 'assistant-message .message-role (default)', fg: exporterColor('.assistant-message .message-role {', 'color'), bg: assistantMsgBg, threshold: 4.5 },
  { label: 'assistant-message .message-role (chatgpt)', fg: exporterColor('.assistant-message[data-platform="chatgpt"] .message-role {', 'color'), bg: assistantMsgBg, threshold: 4.5 },
  { label: 'assistant-message .message-role (claude)', fg: exporterColor('.assistant-message[data-platform="claude"] .message-role {', 'color'), bg: assistantMsgBg, threshold: 4.5 },
  { label: 'assistant-message .message-role (gemini)', fg: exporterColor('.assistant-message[data-platform="gemini"] .message-role {', 'color'), bg: assistantMsgBg, threshold: 4.5 },
  { label: 'pre code text', fg: exporterColor('.message-content pre {', 'color'), bg: preBg, threshold: 4.5 },
  { label: 'blockquote on user (white) bg', fg: exporterColor('.message-content blockquote {', 'color'), bg: userMsgBg, threshold: 4.5 },
  { label: 'blockquote on assistant (grey) bg', fg: exporterColor('.message-content blockquote {', 'color'), bg: assistantMsgBg, threshold: 4.5 },
  { label: 'message-content a on user (white) bg', fg: exporterColor('.message-content a {', 'color'), bg: userMsgBg, threshold: 4.5 },
  { label: 'message-content a on assistant (grey) bg', fg: exporterColor('.message-content a {', 'color'), bg: assistantMsgBg, threshold: 4.5 },
  { label: 'message-content th text', fg: exporterColor('body {', 'color'), bg: thBg, threshold: 4.5 },
  { label: 'artifacts-section h3 on user (white) bg', fg: exporterColor('.artifacts-section h3 {', 'color'), bg: userMsgBg, threshold: 4.5 },
  { label: 'artifacts-section h3 on assistant (grey) bg', fg: exporterColor('.artifacts-section h3 {', 'color'), bg: assistantMsgBg, threshold: 4.5 },
  { label: 'web-searches-section h3 on user (white) bg', fg: exporterColor('.web-searches-section h3 {', 'color'), bg: userMsgBg, threshold: 4.5 },
  { label: 'web-searches-section h3 on assistant (grey) bg', fg: exporterColor('.web-searches-section h3 {', 'color'), bg: assistantMsgBg, threshold: 4.5 },
  { label: 'artifact h4 (default bg)', fg: exporterColor('.artifact h4 {', 'color'), bg: artifactBg, threshold: 4.5 },
  { label: 'artifact h4 (user-message bg)', fg: exporterColor('.artifact h4 {', 'color'), bg: artifactUserBg, threshold: 4.5 },
  { label: 'artifact-type (default bg)', fg: exporterColor('.artifact-type {', 'color'), bg: artifactBg, threshold: 4.5 },
  { label: 'artifact-type (user-message bg)', fg: exporterColor('.artifact-type {', 'color'), bg: artifactUserBg, threshold: 4.5 },
  { label: 'web-search h4 on user (white) bg', fg: exporterColor('.web-search h4 {', 'color'), bg: userMsgBg, threshold: 4.5 },
  { label: 'web-search h4 on assistant (grey) bg', fg: exporterColor('.web-search h4 {', 'color'), bg: assistantMsgBg, threshold: 4.5 },
  { label: 'search-count on user (white) bg', fg: exporterColor('.search-count {', 'color'), bg: userMsgBg, threshold: 4.5 },
  { label: 'search-count on assistant (grey) bg', fg: exporterColor('.search-count {', 'color'), bg: assistantMsgBg, threshold: 4.5 },
  { label: 'result-title (default bg)', fg: exporterColor('.result-title {', 'color'), bg: searchResultBg, threshold: 4.5 },
  { label: 'result-title (user-message bg)', fg: exporterColor('.result-title {', 'color'), bg: searchResultUserBg, threshold: 4.5 },
  { label: 'result-domain (default bg)', fg: exporterColor('.result-domain {', 'color'), bg: searchResultBg, threshold: 4.5 },
  { label: 'result-domain (user-message bg)', fg: exporterColor('.result-domain {', 'color'), bg: searchResultUserBg, threshold: 4.5 },
  { label: 'export .footer text', fg: exporterColor('.footer {', 'color'), bg: bodyBg, threshold: 4.5 },
];

// GitHub-Dark syntax highlighting theme (also part of the exported HTML).
// Search text is the literal selector prefix as it appears in the source
// (grouped selectors are comma-separated on one line, so the prefix ends
// at the comma rather than at `{`).
const hljsTokenSelectors = [
  '.hljs-comment {',
  '.hljs-keyword,',
  '.hljs-string,',
  '.hljs-number,',
  '.hljs-function,',
  '.hljs-built_in {',
  '.hljs-class .hljs-title {',
];
const hljsPairs: Pair[] = [
  { label: 'hljs base text', fg: exporterColor('pre code.hljs {', 'color'), bg: hljsBg, threshold: 4.5 },
  ...hljsTokenSelectors.map(sel => ({
    label: `hljs token ${sel}`,
    fg: exporterColor(sel, 'color'),
    bg: hljsBg,
    threshold: 4.5 as const,
  })),
];

describe('WCAG AA contrast — popup and exported HTML palettes', () => {
  it.each([...popupPairs, ...exporterPairs, ...hljsPairs])(
    '$label meets its WCAG AA threshold ($fg on $bg)',
    ({ fg, bg, threshold }) => {
      const ratio = contrastRatio(fg, bg);
      expect(ratio).toBeGreaterThanOrEqual(threshold);
    }
  );
});
