/**
 * BaseParser cleanupElement Tests
 * TDD: reproduces lo-74ed — cleanupElement's aria-hidden strip deletes
 * rendered KaTeX math that has no visible sibling copy.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { GeminiParser } from '../../../../src/core/parsers/gemini/parser';

// GeminiParser exposes `document` and `extractContent` as `protected`; this test
// reaches into BaseParser internals directly rather than testing through a full
// (unimplemented) extractQAPairs pipeline.
type TestableParser = GeminiParser & {
  document: Document;
  extractContent: (element: Element, preserveHtml: boolean) => { content: string; htmlContent?: string };
};

describe('BaseParser cleanupElement (via GeminiParser.extractContent)', () => {
  // Real fragment captured from a Gemini export (tmp/examples/artifacts-gemini-rendered.html,
  // line ~3838): a KaTeX-rendered "KE" formula. The visible glyphs live inside the
  // aria-hidden katex-html span with no katex-mathml sibling to fall back on.
  const katexFragment = `
    <p>
      Kinetic Energy (<span class="math-inline" data-math="KE" data-index-in-node="16">
        <span class="katex">
          <span class="katex-html" aria-hidden="true">
            <span class="base">
              <span class="strut" style="height: 0.6833em;"></span>
              <span class="mord mathnormal" style="margin-right: 0.0715em;">K</span><span class="mord mathnormal" style="margin-right: 0.0576em;">E</span>
            </span>
          </span>
        </span>
      </span>):
    </p>
  `;

  function buildParser(html: string): TestableParser {
    const dom = new JSDOM(`<html><body>${html}</body></html>`, {
      url: 'https://gemini.google.com/app/test',
    });
    return new GeminiParser(dom.window.document) as TestableParser;
  }

  it('preserves KaTeX-rendered formula text instead of deleting it', () => {
    const parser = buildParser(katexFragment);
    const element = parser.document.body;
    const { content } = parser.extractContent(element, false);

    expect(content).toContain('KE');
  });

  it('still strips decorative aria-hidden elements that are not math output', () => {
    const parser = buildParser('<p>Hello<span aria-hidden="true">(decorative icon)</span> world</p>');
    const element = parser.document.body;
    const { content } = parser.extractContent(element, false);

    expect(content).not.toContain('decorative icon');
    expect(content).toContain('Hello');
    expect(content).toContain('world');
  });
});
