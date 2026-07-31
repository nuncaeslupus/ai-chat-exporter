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
  extractContent: (
    element: Element,
    preserveHtml: boolean
  ) => { content: string; htmlContent?: string };
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
    const parser = buildParser(
      '<p>Hello<span aria-hidden="true">(decorative icon)</span> world</p>'
    );
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
    const markdown = dom.window.document.querySelector(
      '[data-message-author-role="assistant"] .markdown'
    );
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

  // lo-320b: collapsing to ONE copy fixed triplication but left the survivor an
  // undelimited, untagged LaTeX string — indistinguishable from prose in every
  // export. The chosen copy is now delimited ($…$ / $$…$$) and wrapped in a
  // marker span so HtmlContentParser can type it. The priority order above is
  // unchanged; these tests sit alongside it, they do not replace it.
  describe('math is tagged and delimited, not flattened to bare text (lo-320b)', () => {
    it('delimits the inline formula in the plain-text content', () => {
      const parser = buildParser('');
      const { content } = parser.extractContent(loadChatGPTMarkdown(), false);

      expect(content).toContain('$E = mc^2$');
    });

    it('delimits the display formula with $$ in the plain-text content', () => {
      const parser = buildParser('');
      const { content } = parser.extractContent(loadChatGPTMarkdown(), false);

      expect(content).toContain('$$\\sum_{i=1}^{3} i = 6$$');
    });

    it('marks the inline formula with data-math-display="inline" in htmlContent', () => {
      const parser = buildParser('');
      const { htmlContent } = parser.extractContent(loadChatGPTMarkdown(), true);

      expect(htmlContent).toContain('<span data-math-display="inline">$E = mc^2$</span>');
    });

    it('marks the display formula with data-math-display="block" in htmlContent', () => {
      const parser = buildParser('');
      const { htmlContent } = parser.extractContent(loadChatGPTMarkdown(), true);

      expect(htmlContent).toContain(
        '<span data-math-display="block">$$\\sum_{i=1}^{3} i = 6$$</span>'
      );
    });

    it('treats a Gemini glyph-only formula as inline math', () => {
      // Gemini ships `.katex-html` only, wrapped in its own `.math-inline`
      // span that already uses `data-math` for the formula label — which is
      // why the marker attribute is `data-math-display`, not `data-math`.
      const parser = buildParser(katexFragment);
      const { htmlContent } = parser.extractContent(parser.document.body, true);

      expect(htmlContent).toContain('data-math-display="inline"');
      expect(htmlContent).toMatch(/\$KE\$/);
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
      const markdown = dom.window.document.querySelector(
        'div.standard-markdown, div.progressive-markdown'
      );
      if (!markdown) {
        throw new Error('fixture is missing an assistant markdown content root');
      }

      const parser = buildParser('');
      const { htmlContent } = parser.extractContent(markdown, true);

      expect(htmlContent).not.toMatch(/<button/i);
    });
  });
});

describe('BaseParser.extractContent: block-level content never joins (D-35)', () => {
  function buildParser(html: string): TestableParser {
    const dom = new JSDOM(`<html><body>${html}</body></html>`, {
      url: 'https://gemini.google.com/app/test',
    });
    return new GeminiParser(dom.window.document) as TestableParser;
  }

  it('never concatenates the cells of a div-based table (no <table> tag at all)', () => {
    // Gemini's real export renders a table as a grid of plain divs with no
    // whitespace between adjacent tags -- unfixed, plain `textContent`
    // collapsed this to "Base LiquidableCuota0 EUR19%...".
    const html =
      '<div><div><div>Base Liquidable</div><div>Cuota</div><div>Pct</div></div>' +
      '<div><div>Hasta 6.000 EUR</div><div>0 EUR</div><div>19%</div></div></div>';
    const parser = buildParser(html);
    const { content } = parser.extractContent(parser.document.body, false);

    expect(content).not.toContain('0 EUR19%');
    expect(content).not.toContain('Base LiquidableCuota');
    expect(content).toContain('0 EUR');
    expect(content).toContain('19%');
  });

  it('separates a real <table> cell-by-cell and row-by-row', () => {
    const html =
      '<table><tr><th>Base</th><th>Cuota</th></tr><tr><td>0 EUR</td><td>19%</td></tr></table>';
    const parser = buildParser(html);
    const { content } = parser.extractContent(parser.document.body, false);

    expect(content).toBe('Base | Cuota\n0 EUR | 19%');
  });

  it('keeps a lone "–" cell distinct from its neighbours', () => {
    const html = '<table><tr><td>Ajuste</td><td>–</td><td>0%</td></tr></table>';
    const parser = buildParser(html);
    const { content } = parser.extractContent(parser.document.body, false);

    expect(content).not.toContain('Ajuste–');
    expect(content).not.toContain('–0%');
  });

  it('keeps identical adjacent cells distinct rather than merging into one run', () => {
    const html = '<table><tr><td>Nota</td><td>EUR</td><td>EUR</td></tr></table>';
    const parser = buildParser(html);
    const { content } = parser.extractContent(parser.document.body, false);

    expect(content).not.toContain('NotaEUREUR');
    expect(content.match(/EUR/g)?.length).toBe(2);
  });

  it('never concatenates two adjacent block divs', () => {
    const parser = buildParser('<div>First block</div><div>Second block</div>');
    const { content } = parser.extractContent(parser.document.body, false);

    expect(content).not.toContain('First blockSecond block');
    expect(content).toBe('First block\nSecond block');
  });

  it('never concatenates a heading with the list that follows it', () => {
    const parser = buildParser('<h2>Section Title</h2><ul><li>Item one</li></ul>');
    const { content } = parser.extractContent(parser.document.body, false);

    expect(content).not.toContain('Section TitleItem one');
  });

  it('does not add spurious spaces around inline elements mid-sentence (no regression)', () => {
    const parser = buildParser(
      '<p>The <strong>quick</strong> fox jumps over the <em>lazy</em> dog.</p>'
    );
    const { content } = parser.extractContent(parser.document.body, false);

    expect(content).toBe('The quick fox jumps over the lazy dog.');
  });

  it('keeps <pre>/<code> content byte-exact', () => {
    const parser = buildParser('<pre>  keep\n\tthis   exactly  </pre>');
    const { content } = parser.extractContent(parser.document.body, false);

    expect(content).toBe('keep\n\tthis   exactly');
  });
});
