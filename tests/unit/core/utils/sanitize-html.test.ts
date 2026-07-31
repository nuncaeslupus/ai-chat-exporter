/**
 * sanitizeHtml tests
 */

import { describe, it, expect } from 'vitest';
import { sanitizeHtml, safeUrl } from '../../../../src/core/utils/sanitize-html';

describe('sanitizeHtml', () => {
  it('does not execute inline event handlers from scraped content', () => {
    const result = sanitizeHtml('<p>hi</p><img src="x" onerror="alert(1)">');
    const div = document.createElement('div');
    div.innerHTML = result;
    const img = div.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('onerror')).toBeNull();
    expect(result).not.toContain('onerror');
  });

  it('renders script tags inert', () => {
    const result = sanitizeHtml('<p>before</p><script>window.__pwned = true;</script><p>after</p>');
    expect(result).not.toContain('<script');
    const div = document.createElement('div');
    div.innerHTML = result;
    expect(div.querySelector('script')).toBeNull();
  });

  it('strips javascript: URLs from links', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    const div = document.createElement('div');
    div.innerHTML = result;
    expect(div.querySelector('a')?.getAttribute('href')).toBeNull();
  });

  it('leaves benign markup untouched', () => {
    const result = sanitizeHtml('<p>Hello <strong>world</strong></p>');
    expect(result).toBe('<p>Hello <strong>world</strong></p>');
  });

  // SEC-1 (critical): `\s*` in the old `/^\s*javascript:/i` check only
  // anchors *leading* whitespace. HTML entity-decodes `href="jav&#9;ascript:` /
  // `&#x0a;` variants at parse time into a literal tab/newline *inside* the
  // scheme, which the regex never matches — but the browser's URL parser
  // strips ASCII tab/LF/CR from anywhere in the string before resolving the
  // scheme, so the link still navigates to `javascript:alert(1)`. Each of
  // these must fail against the pre-fix regex and pass against `safeUrl`.
  it.each([
    ['tab inside the scheme (decoded &#x09;)', 'jav\tascript:alert(1)'],
    ['newline inside the scheme (decoded &#x0a;)', 'jav\nascript:alert(1)'],
    ['carriage return inside the scheme (decoded &#x0d;)', 'jav\rascript:alert(1)'],
    ['mixed case with an embedded tab', 'JaVaScRiPt\t:alert(1)'],
  ])('strips a javascript: URL hidden behind a %s', (_label, hostileHref) => {
    const result = sanitizeHtml(`<a href="${hostileHref}">click</a>`);
    const div = document.createElement('div');
    div.innerHTML = result;
    expect(div.querySelector('a')?.getAttribute('href')).toBeNull();
  });

  // SEC-1 (high): the old implementation was a 5-tag denylist
  // (script/style/iframe/object/embed). Each of these reached live DOM
  // through it; the allowlist must drop all of them.
  it('drops <meta http-equiv=refresh>, which needs no click at all', () => {
    const result = sanitizeHtml(
      '<meta http-equiv="refresh" content="0;url=https://evil.example/">'
    );
    expect(result).not.toContain('<meta');
    expect(result).not.toContain('evil.example');
  });

  it('drops <base href>, which would redirect every relative URL in the document', () => {
    const result = sanitizeHtml('<p>hi</p><base href="https://evil.example/">');
    expect(result).not.toContain('<base');
    expect(result).not.toContain('evil.example');
  });

  it("drops a remote <link>, preserving the exported file's no-remote-subresource invariant", () => {
    const result = sanitizeHtml('<link rel="stylesheet" href="https://evil.example/x.css">');
    expect(result).not.toContain('<link');
    expect(result).not.toContain('evil.example');
  });

  it('drops <form>/<button formaction> instead of only checking href/src', () => {
    const result = sanitizeHtml(
      '<form><button formaction="javascript:alert(1)">go</button></form>'
    );
    expect(result).not.toContain('<form');
    expect(result).not.toContain('<button');
    expect(result).not.toContain('formaction');
  });

  it('drops an SVG xlink:href javascript: URL by dropping the carrying <a>/<svg> content entirely', () => {
    const result = sanitizeHtml('<svg><a xlink:href="javascript:alert(1)">click</a></svg>');
    expect(result).not.toContain('xlink:href');
    expect(result).not.toContain('javascript:');
  });

  // SEC-1 (low): a nested <template>'s content lives in its own separate
  // DocumentFragment, which the old TreeWalker (over the outer template's
  // content) never descended into, so a <script> inside it survived
  // untouched.
  it('drops a <script> hidden inside a nested <template>', () => {
    const result = sanitizeHtml('<template><script>alert(1)</script></template>');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('<template');
    const div = document.createElement('div');
    div.innerHTML = result;
    expect(div.querySelector('script')).toBeNull();
    expect(div.querySelector('template')).toBeNull();
  });

  it('keeps a real diagram <svg> (size + accessible name) for the Deep Research size check', () => {
    const result = sanitizeHtml(
      '<svg width="500" height="200" aria-label="timeline diagram"></svg>'
    );
    const div = document.createElement('div');
    div.innerHTML = result;
    const svg = div.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('500');
    expect(svg?.getAttribute('height')).toBe('200');
  });
});

describe('safeUrl', () => {
  it('allows http, https and mailto', () => {
    expect(safeUrl('http://example.com')).toBe('http://example.com');
    expect(safeUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
    expect(safeUrl('mailto:a@example.com')).toBe('mailto:a@example.com');
  });

  it('allows a relative URL (resolves against the page origin, not executable)', () => {
    expect(safeUrl('/path')).toBe('/path');
    expect(safeUrl('#section')).toBe('#section');
  });

  it('rejects javascript: even with an internal tab/newline/CR', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('jav\tascript:alert(1)')).toBeNull();
    expect(safeUrl('jav\nascript:alert(1)')).toBeNull();
    expect(safeUrl('jav\rascript:alert(1)')).toBeNull();
  });

  it('rejects data: URLs unless allowImageData is set and the MIME type is an image', () => {
    expect(safeUrl('data:text/html;base64,abc')).toBeNull();
    expect(safeUrl('data:image/png;base64,abc')).toBeNull();
    expect(safeUrl('data:image/png;base64,abc', { allowImageData: true })).toBe(
      'data:image/png;base64,abc'
    );
    expect(safeUrl('data:text/html;base64,abc', { allowImageData: true })).toBeNull();
  });

  it('rejects an empty or non-string value', () => {
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });
});
