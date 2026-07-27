/**
 * sanitizeHtml tests
 */

import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../../../../src/core/utils/sanitize-html';

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
});
