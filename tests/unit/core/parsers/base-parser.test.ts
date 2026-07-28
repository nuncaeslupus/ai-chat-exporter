/**
 * BaseParser cleanupElement Tests
 * TDD: reproduces lo-74ed — cleanupElement's aria-hidden strip deletes
 * rendered KaTeX math that has no visible sibling copy.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { join } from 'path';
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

  // lo-725a: ChatGPT KaTeX ships THREE copies of a formula (.katex-mathml with an
  // annotation[encoding="application/x-tex"], plus .katex-html) where Gemini ships
  // only one (.katex-html). Keeping aria-hidden (lo-74ed) preserves Gemini's only
  // copy but triplicates ChatGPT's — cleanupElement must collapse the whole .katex
  // unit to one representation instead of deciding per aria-hidden node.
  function loadChatGPTMarkdown(): Element {
    const fixturePath = join(
      __dirname,
      '../../../fixtures/dom-snapshots/chatgpt/formatting-showcase-2026-07.html'
    );
    const html = readFileSync(fixturePath, 'utf-8');
    const dom = new JSDOM(html, { url: 'https://chatgpt.com/c/test-conversation' });
    const markdown = dom.window.document.querySelector('[data-message-author-role="assistant"] .markdown');
    if (!markdown) {
      throw new Error('fixture is missing the assistant .markdown content root');
    }
    return markdown;
  }

  describe('ChatGPT KaTeX (mathml + annotation + html) fixture', () => {
    it('collapses the inline formula to a single LaTeX-sourced copy, not a triplicated one', () => {
      const parser = buildParser('');
      const { content } = parser.extractContent(loadChatGPTMarkdown(), false);

      // The lossless annotation source ("E = mc^2") should appear, and only once —
      // "mc" is unique to the annotation copy (mathml/html render "mc2" with no gap).
      expect(content).toContain('E = mc^2');
      expect(content.match(/mc/g) ?? []).toHaveLength(1);
    });

    it('collapses the display formula to a single LaTeX-sourced copy, not a triplicated one', () => {
      const parser = buildParser('');
      const { content } = parser.extractContent(loadChatGPTMarkdown(), false);

      // "\sum" is unique to the annotation copy; the mathml/html copies render the
      // unicode glyph "∑" instead. Its absence proves those copies were dropped.
      expect(content).toContain('\\sum_{i=1}^{3} i = 6');
      expect(content).not.toContain('∑');
    });
  });

  // lo-62ce: `.markdown` contains ChatGPT's own action buttons ("Copy table",
  // "Copy code"). Their textContent is empty (icon-only), so a text-only assertion
  // can never catch this — htmlContent is what ships in the export and must be
  // asserted on directly.
  describe('interactive chrome stripped from htmlContent (lo-62ce)', () => {
    it('strips ARIA-role buttons that are not <button> elements', () => {
      const parser = buildParser(
        '<p>Row 1 <span role="button" tabindex="0">Copy<svg><use href="/cdn/assets/sprites-core-abc.svg#x"></use></svg></span> Row 2</p>'
      );
      const { htmlContent } = parser.extractContent(parser.document.body, true);

      expect(htmlContent).not.toContain('role="button"');
      expect(htmlContent).not.toContain('<svg');
      expect(htmlContent).not.toContain('sprites-');
    });

    it('leaves no <button> or sprite <use> reference in the real ChatGPT fixture', () => {
      const parser = buildParser('');
      const { htmlContent } = parser.extractContent(loadChatGPTMarkdown(), true);

      expect(htmlContent).not.toMatch(/<button/i);
      expect(htmlContent).not.toMatch(/sprites-[a-z0-9-]*\.svg/i);
    });

    it('leaves no <button> in the real Claude fixture (shared cleanup path)', () => {
      const fixturePath = join(
        __dirname,
        '../../../fixtures/dom-snapshots/claude/real-capture.html'
      );
      const html = readFileSync(fixturePath, 'utf-8');
      const dom = new JSDOM(html, { url: 'https://claude.ai/chat/test' });
      const markdown = dom.window.document.querySelector('div.standard-markdown, div.progressive-markdown');
      if (!markdown) {
        throw new Error('fixture is missing an assistant markdown content root');
      }

      const parser = buildParser('');
      const { htmlContent } = parser.extractContent(markdown, true);

      expect(htmlContent).not.toMatch(/<button/i);
    });
  });
});
