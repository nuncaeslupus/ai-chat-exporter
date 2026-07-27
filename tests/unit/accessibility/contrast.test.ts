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

/** Value of `prop` inside the first `{...}` block whose text starts with `selector`. */
function declValue(css: string, selector: string, prop: string): string {
  const idx = css.indexOf(selector);
  if (idx === -1) throw new Error(`selector not found: ${selector}`);
  const braceStart = css.indexOf('{', idx);
  const braceEnd = css.indexOf('}', braceStart);
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
function exporterColor(selector: string, prop: string): string {
  return declValue(exporterTs, selector, prop);
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
  { label: 'conversation-meta', fg: popupColor('.conversation-meta {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'badge-code', fg: popupColor('.badge-code {', 'color'), bg: popupColor('.badge-code {', 'background'), threshold: 4.5 },
  { label: 'badge-image', fg: popupColor('.badge-image {', 'color'), bg: popupColor('.badge-image {', 'background'), threshold: 4.5 },
  { label: 'format-select text', fg: popupColor('.format-select {', 'color'), bg: popupColor('.format-select {', 'background'), threshold: 4.5 },
  { label: 'action-button text/border', fg: popupColor('.action-button {', 'color'), bg: popupColor('.action-button {', 'background'), threshold: 4.5 },
  { label: 'action-button hover text', fg: declValue(popupCss, '.action-button:hover:not(:disabled) {', 'color'), bg: popupColor('.action-button:hover:not(:disabled) {', 'background'), threshold: 4.5 },
  { label: 'setting-item span (default bg)', fg: popupColor('.setting-item span {', 'color'), bg: popupColor('body {', 'background'), threshold: 4.5 },
  { label: 'setting-item span (hover bg)', fg: popupColor('.setting-item span {', 'color'), bg: popupColor('.setting-item:hover {', 'background'), threshold: 4.5 },
  { label: 'popup-footer text', fg: popupColor('.popup-footer {', 'color'), bg: popupColor('.popup-footer {', 'background'), threshold: 4.5 },
  { label: 'footer-link', fg: popupColor('.footer-link {', 'color'), bg: popupColor('.popup-footer {', 'background'), threshold: 4.5 },
  { label: 'not-supported-title', fg: popupColor('.not-supported-title {', 'color'), bg: popupColor('.not-supported-message {', 'background'), threshold: 4.5 },
  { label: 'not-supported-text', fg: popupColor('.not-supported-text {', 'color'), bg: popupColor('.not-supported-message {', 'background'), threshold: 4.5 },
  { label: 'not-supported-text strong', fg: popupColor('.not-supported-text strong {', 'color'), bg: popupColor('.not-supported-message {', 'background'), threshold: 4.5 },
  { label: 'kbd text', fg: popupColor('kbd {', 'color'), bg: normalizeColor(declValue(popupCss, 'kbd {', 'background-color')), threshold: 4.5 },
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
