/**
 * HtmlContentParser Tests
 */

import { describe, it, expect } from 'vitest';
import { HtmlContentParser } from '../../../../src/core/services/html-content-parser';
import type {
  ParagraphBlock,
  HeadingBlock,
  ListBlock,
  TableBlock,
  CodeBlock,
} from '../../../../src/core/types/structured-content';

describe('HtmlContentParser', () => {
  describe('parse() basics', () => {
    it('returns empty array for empty input', () => {
      expect(HtmlContentParser.parse('')).toEqual([]);
    });

    it('treats pure inline content as a single paragraph', () => {
      const blocks = HtmlContentParser.parse('Hello world');
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.type).toBe('paragraph');
    });
  });

  describe('headings', () => {
    it('parses h1-h6 with correct level and content', () => {
      const html = '<h1>Title</h1><h2>Sub</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>';
      const blocks = HtmlContentParser.parse(html) as HeadingBlock[];
      expect(blocks).toHaveLength(6);
      blocks.forEach((block, i) => {
        expect(block.type).toBe('heading');
        expect(block.level).toBe(i + 1);
      });
      expect(blocks[0]!.content).toEqual([{ type: 'text', text: 'Title' }]);
    });

    it('drops empty headings', () => {
      const blocks = HtmlContentParser.parse('<h1></h1>');
      expect(blocks).toEqual([]);
    });
  });

  describe('lists', () => {
    it('parses an unordered list', () => {
      const html = '<ul><li>One</li><li>Two</li></ul>';
      const blocks = HtmlContentParser.parse(html) as ListBlock[];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.type).toBe('list');
      expect(blocks[0]!.ordered).toBe(false);
      expect(blocks[0]!.items).toHaveLength(2);
      expect(blocks[0]!.items[0]?.content).toEqual([{ type: 'text', text: 'One' }]);
    });

    it('parses an ordered list', () => {
      const html = '<ol><li>First</li><li>Second</li></ol>';
      const blocks = HtmlContentParser.parse(html) as ListBlock[];
      expect(blocks[0]?.ordered).toBe(true);
    });

    it('parses nested lists, excluding the nested list from the parent item content', () => {
      // Nested list uses <ol> inside the outer <ul> (not <ul> inside <ul>): jsdom's
      // selector engine (nwsapi) has a `:scope > li` bug where a same-tag nested list
      // (ul > ... > ul > li) leaks descendant <li>s into the direct-child match. That's
      // a test-environment quirk (real browsers implement `:scope` correctly per spec),
      // not a bug in the parser, so a mixed ul/ol nesting sidesteps it while still
      // exercising the same exclude-nested-list code path.
      const html =
        '<ul><li>Parent<ol><li>Child A</li><li>Child B</li></ol></li><li>Sibling</li></ul>';
      const blocks = HtmlContentParser.parse(html) as ListBlock[];
      const list = blocks[0];
      expect(list?.items).toHaveLength(2);

      const parentItem = list?.items[0];
      // Parent item content should only be its own text, not the nested list's text
      expect(parentItem?.content).toEqual([{ type: 'text', text: 'Parent' }]);
      expect(parentItem?.nested).toBeDefined();
      expect(parentItem?.nested?.ordered).toBe(true);
      expect(parentItem?.nested?.items).toHaveLength(2);
      expect(parentItem?.nested?.items[0]?.content).toEqual([{ type: 'text', text: 'Child A' }]);

      const siblingItem = list?.items[1];
      expect(siblingItem?.content).toEqual([{ type: 'text', text: 'Sibling' }]);
      expect(siblingItem?.nested).toBeUndefined();
    });

    it('drops an empty list', () => {
      const blocks = HtmlContentParser.parse('<ul></ul>');
      expect(blocks).toEqual([]);
    });
  });

  describe('tables', () => {
    it('parses a table with a header row', () => {
      const html = `
        <table>
          <thead><tr><th>Name</th><th>Age</th></tr></thead>
          <tbody>
            <tr><td>Alice</td><td>30</td></tr>
            <tr><td>Bob</td><td>25</td></tr>
          </tbody>
        </table>
      `;
      const blocks = HtmlContentParser.parse(html) as TableBlock[];
      expect(blocks).toHaveLength(1);
      const table = blocks[0];
      expect(table?.type).toBe('table');
      expect(table?.headers).toEqual([
        [{ type: 'text', text: 'Name' }],
        [{ type: 'text', text: 'Age' }],
      ]);
      expect(table?.rows).toHaveLength(2);
      expect(table?.rows[0]).toEqual([
        [{ type: 'text', text: 'Alice' }],
        [{ type: 'text', text: '30' }],
      ]);
    });

    it('parses a table without a header row', () => {
      const html = `
        <table>
          <tbody>
            <tr><td>Alice</td><td>30</td></tr>
          </tbody>
        </table>
      `;
      const blocks = HtmlContentParser.parse(html) as TableBlock[];
      const table = blocks[0];
      expect(table?.headers).toEqual([]);
      expect(table?.rows).toHaveLength(1);
    });

    it('parses a table with no thead/tbody wrapper (rows direct under table)', () => {
      const html = '<table><tr><td>A</td><td>B</td></tr></table>';
      const blocks = HtmlContentParser.parse(html) as TableBlock[];
      const table = blocks[0];
      expect(table?.headers).toEqual([]);
      expect(table?.rows).toEqual([[[{ type: 'text', text: 'A' }], [{ type: 'text', text: 'B' }]]]);
    });

    it('handles empty cells by producing empty inline-content arrays', () => {
      const html = '<table><tbody><tr><td></td><td>b</td></tr></tbody></table>';
      const blocks = HtmlContentParser.parse(html) as TableBlock[];
      const table = blocks[0];
      expect(table?.rows[0]).toEqual([[], [{ type: 'text', text: 'b' }]]);
    });

    it('drops a completely empty table', () => {
      const blocks = HtmlContentParser.parse('<table><tbody></tbody></table>');
      expect(blocks).toEqual([]);
    });
  });

  /**
   * EXP-4: a two-row <thead> was flattened into one row by appending CELLS
   * instead of rows (doubling the column count), and colspan/rowspan were
   * ignored entirely, so a merged-cell table put values under the wrong
   * column. Every assertion here is about which value lands under which
   * heading -- never about styling.
   */
  describe('EXP-4: table fidelity — multi-row headers and spans', () => {
    /** Flatten a cell's inline content to plain text for assertions. */
    function text(cell: readonly { text: string }[] | undefined): string {
      return (cell ?? []).map((c) => c.text).join('');
    }

    it('merges a two-row <thead> into one composite header instead of doubling the column count', () => {
      const html = `
        <table>
          <thead>
            <tr><th>Region</th><th>Q1</th></tr>
            <tr><th>(EUR)</th><th>(EUR)</th></tr>
          </thead>
          <tbody>
            <tr><td>EMEA</td><td>10</td></tr>
            <tr><td>APAC</td><td>20</td></tr>
          </tbody>
        </table>
      `;
      const [table] = HtmlContentParser.parse(html) as TableBlock[];

      // RED (pre-fix): headers.push(...headerRow) appended cells from BOTH
      // rows, reporting 4 columns for a 2-cell body -- half the table would
      // render empty in every format.
      expect(table?.headers).toHaveLength(2);
      expect(table?.headers.map(text)).toEqual(['Region (EUR)', 'Q1 (EUR)']);
      expect(table?.rows[0]?.map(text)).toEqual(['EMEA', '10']);
      expect(table?.rows[1]?.map(text)).toEqual(['APAC', '20']);
    });

    it('expands a colspan=2 header over two data columns, keeping each value under its own heading', () => {
      const html = `
        <table>
          <thead><tr><th>Name</th><th colspan="2">Score</th></tr></thead>
          <tbody><tr><td>Alice</td><td>10</td><td>20</td></tr></tbody>
        </table>
      `;
      const [table] = HtmlContentParser.parse(html) as TableBlock[];

      // RED (pre-fix): headers reported only 2 columns ("Name", "Score") over
      // a 3-cell body row -- the third value ("20") had no heading at all,
      // and every column-count-driven renderer (pdf's numCols, e.g.) sized
      // for 2 columns instead of 3.
      expect(table?.headers).toHaveLength(3);
      expect(text(table?.headers[0])).toBe('Name');
      expect(text(table?.headers[1])).toBe('Score');
      expect(table?.rows[0]?.map(text)).toEqual(['Alice', '10', '20']);
    });

    it('expands a rowspan=2 first column, keeping later rows blank in that column rather than shifted', () => {
      const html = `
        <table>
          <tbody>
            <tr><td rowspan="2">Total</td><td>1</td><td>2</td></tr>
            <tr><td>3</td><td>4</td></tr>
          </tbody>
        </table>
      `;
      const [table] = HtmlContentParser.parse(html) as TableBlock[];

      // RED (pre-fix): row 2 was emitted as-is (2 cells: "3","4"), so a
      // column-index renderer would draw "3" under column A and "4" under
      // column B -- one column left of where they belong.
      expect(table?.rows[0]?.map(text)).toEqual(['Total', '1', '2']);
      expect(table?.rows[1]?.map(text)).toEqual(['', '3', '4']);
    });

    it('handles a table mixing rowspan and colspan without misattributing any value', () => {
      // The exact scenario from the review finding: a 3-column table where
      // column A's first cell spans two rows, and the last row's first cell
      // spans two columns.
      const html = `
        <table>
          <tbody>
            <tr><td rowspan="2">x</td><td>1</td><td>2</td></tr>
            <tr><td>3</td><td>4</td></tr>
            <tr><td colspan="2">merged</td><td>9</td></tr>
          </tbody>
        </table>
      `;
      const [table] = HtmlContentParser.parse(html) as TableBlock[];

      // RED (pre-fix) verified parse output was:
      // rows: [["x","1","2"],["3","4"],["merged","9"]] -- row 2's "3"/"4"
      // land under columns A/B (belong under B/C), and row 3's "9" lands
      // under B (belongs under C).
      expect(table?.rows[0]?.map(text)).toEqual(['x', '1', '2']);
      expect(table?.rows[1]?.map(text)).toEqual(['', '3', '4']);
      expect(table?.rows[2]?.map(text)).toEqual(['merged', '', '9']);
    });

    it('pads a ragged row (fewer cells than the header) instead of leaving it column-misaligned', () => {
      const html = `
        <table>
          <thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>
          <tbody>
            <tr><td>a1</td><td>b1</td><td>c1</td></tr>
            <tr><td>a2</td><td>b2</td></tr>
          </tbody>
        </table>
      `;
      const [table] = HtmlContentParser.parse(html) as TableBlock[];

      expect(table?.headers).toHaveLength(3);
      expect(table?.rows[1]).toHaveLength(3);
      expect(table?.rows[1]?.map(text)).toEqual(['a2', 'b2', '']);
    });
  });

  describe('inline formatting nesting', () => {
    it('parses bold text', () => {
      const html = '<p><strong>bold</strong></p>';
      const blocks = HtmlContentParser.parse(html) as ParagraphBlock[];
      expect(blocks[0]?.content).toEqual([
        { type: 'bold', text: 'bold', children: [{ type: 'text', text: 'bold' }] },
      ]);
    });

    it('parses italic text', () => {
      const html = '<p><em>italic</em></p>';
      const blocks = HtmlContentParser.parse(html) as ParagraphBlock[];
      expect(blocks[0]?.content).toEqual([
        { type: 'italic', text: 'italic', children: [{ type: 'text', text: 'italic' }] },
      ]);
    });

    it('parses inline code', () => {
      const html = '<p><code>const x = 1;</code></p>';
      const blocks = HtmlContentParser.parse(html) as ParagraphBlock[];
      expect(blocks[0]?.content).toEqual([{ type: 'code', text: 'const x = 1;' }]);
    });

    it('parses links', () => {
      const html = '<p><a href="https://example.com">example</a></p>';
      const blocks = HtmlContentParser.parse(html) as ParagraphBlock[];
      expect(blocks[0]?.content).toEqual([
        { type: 'link', text: 'example', url: 'https://example.com/' },
      ]);
    });

    it('parses bold containing italic containing code (deep nesting)', () => {
      const html = '<p><strong>bold <em>italic <code>code</code></em></strong></p>';
      const blocks = HtmlContentParser.parse(html) as ParagraphBlock[];
      const content = blocks[0]?.content;
      expect(content).toHaveLength(1);

      const bold = content?.[0];
      expect(bold?.type).toBe('bold');
      expect(bold?.text).toBe('bold italic code');
      expect(bold?.children).toEqual([
        { type: 'text', text: 'bold ' },
        {
          type: 'italic',
          text: 'italic code',
          children: [
            { type: 'text', text: 'italic ' },
            { type: 'code', text: 'code' },
          ],
        },
      ]);
    });

    it('parses a link nested inside bold', () => {
      const html = '<p><strong>see <a href="https://example.com">here</a></strong></p>';
      const blocks = HtmlContentParser.parse(html) as ParagraphBlock[];
      const bold = blocks[0]?.content[0];
      expect(bold?.type).toBe('bold');
      expect(bold?.children).toEqual([
        { type: 'text', text: 'see ' },
        { type: 'link', text: 'here', url: 'https://example.com/' },
      ]);
    });

    it('parses strikethrough', () => {
      const html = '<p><del>gone</del></p>';
      const blocks = HtmlContentParser.parse(html) as ParagraphBlock[];
      expect(blocks[0]?.content).toEqual([{ type: 'strikethrough', text: 'gone' }]);
    });
  });

  describe('code blocks', () => {
    it('parses a code block with a language class', () => {
      const html = '<pre><code class="language-python">print("hi")</code></pre>';
      const blocks = HtmlContentParser.parse(html) as CodeBlock[];
      expect(blocks[0]).toEqual({ type: 'code', language: 'python', code: 'print("hi")' });
    });

    it('parses a code block without a language class, defaulting language to "code"', () => {
      const html = '<pre><code>plain text</code></pre>';
      const blocks = HtmlContentParser.parse(html) as CodeBlock[];
      expect(blocks[0]).toEqual({ type: 'code', language: 'code', code: 'plain text' });
    });

    it('parses a <pre> with no inner <code> element', () => {
      const html = '<pre>raw pre text</pre>';
      const blocks = HtmlContentParser.parse(html) as CodeBlock[];
      expect(blocks[0]).toEqual({ type: 'code', language: 'code', code: 'raw pre text' });
    });

    it('drops an empty code block', () => {
      const blocks = HtmlContentParser.parse('<pre><code></code></pre>');
      expect(blocks).toEqual([]);
    });

    it('does not treat inline <code> inside a <pre> as inline code', () => {
      // Inline-code handling explicitly skips <code> elements nested under <pre>
      // so a code block's contents are never double-processed as inline code.
      const html =
        '<pre><code class="language-js">const a = 1;</code></pre><p><code>inline</code></p>';
      const blocks = HtmlContentParser.parse(html);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]?.type).toBe('code');
      expect((blocks[1] as ParagraphBlock).content).toEqual([{ type: 'code', text: 'inline' }]);
    });
  });

  describe('malformed HTML', () => {
    it('does not throw on unclosed tags', () => {
      const html = '<p>Hello <strong>world';
      expect(() => HtmlContentParser.parse(html)).not.toThrow();
    });

    it('recovers text content from unclosed bold/paragraph tags', () => {
      const html = '<p>Hello <strong>world';
      const blocks = HtmlContentParser.parse(html) as ParagraphBlock[];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.type).toBe('paragraph');
      const bold = blocks[0]?.content.find((c) => c.type === 'bold');
      expect(bold?.text).toBe('world');
    });

    it('closes unclosed <li> elements in a list', () => {
      const html = '<ul><li>Item 1<li>Item 2</ul>';
      const blocks = HtmlContentParser.parse(html) as ListBlock[];
      expect(blocks[0]?.items).toHaveLength(2);
      expect(blocks[0]?.items[0]?.content).toEqual([{ type: 'text', text: 'Item 1' }]);
      expect(blocks[0]?.items[1]?.content).toEqual([{ type: 'text', text: 'Item 2' }]);
    });

    it('handles empty table cells without crashing', () => {
      const html = '<table><tbody><tr><td></td><td></td></tr></tbody></table>';
      expect(() => HtmlContentParser.parse(html)).not.toThrow();
      const blocks = HtmlContentParser.parse(html) as TableBlock[];
      expect(blocks[0]?.rows[0]).toEqual([[], []]);
    });

    it('recurses through deeply nested divs to find block content', () => {
      const html =
        '<div><div><div><table><tbody><tr><td>deep</td></tr></tbody></table></div></div></div>';
      const blocks = HtmlContentParser.parse(html) as TableBlock[];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.type).toBe('table');
      expect(blocks[0]?.rows[0]).toEqual([[{ type: 'text', text: 'deep' }]]);
    });

    it('flattens deeply nested divs with no block content into a single paragraph', () => {
      const html = '<div><div><div>buried text</div></div></div>';
      const blocks = HtmlContentParser.parse(html) as ParagraphBlock[];
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.type).toBe('paragraph');
      expect(blocks[0]?.content).toEqual([{ type: 'text', text: 'buried text' }]);
    });
  });

  describe('other block elements', () => {
    it('parses a blockquote', () => {
      const html = '<blockquote><p>Quoted</p></blockquote>';
      const blocks = HtmlContentParser.parse(html);
      expect(blocks[0]?.type).toBe('blockquote');
    });

    it('parses an hr', () => {
      const blocks = HtmlContentParser.parse('<hr>');
      expect(blocks).toEqual([{ type: 'hr' }]);
    });

    it('parses an image with dimensions', () => {
      const html =
        '<img src="https://example.com/x.png" alt="alt text" width="100" height="50"><hr>';
      const blocks = HtmlContentParser.parse(html);
      expect(blocks[0]).toMatchObject({
        type: 'image',
        url: 'https://example.com/x.png',
        alt: 'alt text',
        width: 100,
        height: 50,
      });
    });

    // Regression: 'img' must stay in the block-tag lists that `parse()` and the
    // `case 'p'/'div'` branch of `parseElement()` use to decide whether to route
    // content through block parsing. Drop it and an image falls through to
    // `parseInlineContent()`, whose default branch reads `el.textContent` -- always
    // '' for an <img> -- silently discarding it from every export format.
    it('keeps a standalone image with no block-level sibling', () => {
      const html = '<img src="https://example.com/x.png" alt="alt text">';
      const blocks = HtmlContentParser.parse(html);
      expect(blocks).toEqual([
        { type: 'image', url: 'https://example.com/x.png', alt: 'alt text' },
      ]);
    });

    it('keeps an image that is the sole content of a <p>', () => {
      const html = '<p><img src="https://example.com/x.png" alt="alt text"></p>';
      const blocks = HtmlContentParser.parse(html);
      expect(blocks).toEqual([
        { type: 'image', url: 'https://example.com/x.png', alt: 'alt text' },
      ]);
    });

    it('keeps an image alongside the text of its paragraph', () => {
      const html = '<p>before<img src="https://example.com/x.png" alt="a">after</p>';
      const blocks = HtmlContentParser.parse(html);
      expect(blocks).toEqual([
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
        { type: 'image', url: 'https://example.com/x.png', alt: 'a' },
        { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
      ]);
    });

    // Regression: `hasNestedBlocks` matches the nested <img> and recurses into the
    // <p>, but parseElement's switch had no <a> case, so the anchor fell through to
    // parseInlineContent() -- which has no image case either -- and the image was
    // silently discarded. The anchor's href is preserved on the image node as
    // `linkUrl` since ImageBlock already declares it optional (no exporter changes).
    it('preserves an image wrapped in an anchor, carrying the link URL', () => {
      const html =
        '<p><a href="https://example.com"><img src="https://example.com/x.png" alt="a"></a></p>';
      const blocks = HtmlContentParser.parse(html);
      expect(blocks).toEqual([
        {
          type: 'image',
          url: 'https://example.com/x.png',
          alt: 'a',
          linkUrl: 'https://example.com/',
        },
      ]);
    });

    it('parses an anchor with real text and no image as a link (not a dropped block)', () => {
      const html = '<p><a href="https://example.com">text only</a></p>';
      const blocks = HtmlContentParser.parse(html);
      expect(blocks).toEqual([
        {
          type: 'paragraph',
          content: [{ type: 'link', text: 'text only', url: 'https://example.com/' }],
        },
      ]);
    });
  });
});

describe('D-23: prose keeps its shape around inline widgets', () => {
  /** The flattened text of a paragraph block, as an exporter would render it. */
  function paragraphText(html: string): string {
    const blocks = HtmlContentParser.parse(html) as ParagraphBlock[];
    return blocks
      .filter((b) => b.type === 'paragraph')
      .map((b) => b.content.map((c) => c.text).join(''))
      .join('\n');
  }

  it('collapses the source indentation around a citation pill', () => {
    // ChatGPT wraps each citation in a pretty-printed span, so the raw
    // textContent carries the page's newlines and indentation. Unfixed, one
    // sentence became ten lines in md and txt, and the blank lines split the
    // Markdown paragraph into several.
    const html = [
      '<p>Backed by research',
      '            <span class="citation">',
      '              MDN Web Docs',
      '            </span>',
      '          and',
      '            <span class="citation">',
      '              web.dev',
      '            </span>.',
      '</p>',
    ].join('\n');

    const text = paragraphText(html);
    expect(text).not.toContain('\n');
    // No doubled spaces either: each flattened widget contributes a leading and
    // a trailing space, so the collapse has to run across the seam between runs.
    expect(text).not.toMatch(/ {2}/);
    expect(text.trim()).toBe('Backed by research MDN Web Docs and web.dev .');
  });

  it('normalises a link label spanning several source lines', () => {
    const html = '<p>See <a href="https://example.com">\n   the\n   source\n</a> for more.</p>';
    expect(paragraphText(html)).not.toContain('\n');
  });

  it('leaves inline code untouched, where whitespace is content', () => {
    // A snippet's spacing is meaningful; only prose gets collapsed.
    const blocks = HtmlContentParser.parse('<p><code>a  +  b</code></p>') as ParagraphBlock[];
    const code = blocks[0]!.content.find((c) => c.type === 'code');
    expect(code?.text).toBe('a  +  b');
  });
});

describe('D-35: block-level content flattened as prose never joins wordlessly', () => {
  /** The flattened text of every paragraph block, as an exporter would render it. */
  function paragraphText(html: string): string {
    const blocks = HtmlContentParser.parse(html) as ParagraphBlock[];
    return blocks
      .filter((b) => b.type === 'paragraph')
      .map((b) => b.content.map((c) => c.text).join(''))
      .join('\n');
  }

  it('never concatenates the cells of a div-based table (no <table> tag at all)', () => {
    // Gemini's real export renders a table as a grid of plain divs, with no
    // whitespace between adjacent tags -- exactly what a serialized DOM
    // looks like. Unfixed, this collapsed to one run:
    // "JurisdicciónImpuesto (Acrónimo)Tasa Impositiva...".
    const html =
      '<div><div><div>Jurisdicción</div><div>Impuesto (Acrónimo)</div><div>Tasa Impositiva</div></div>' +
      '<div><div>España</div><div>ITF (Tasa Tobin)</div><div>0.20%</div></div></div>';

    const text = paragraphText(html);
    expect(text).not.toContain('JurisdicciónImpuesto');
    expect(text).not.toContain('(Acrónimo)Tasa');
    expect(text).not.toContain('ImpositivaEspaña');
    expect(text).toContain('Jurisdicción');
    expect(text).toContain('Impuesto (Acrónimo)');
  });

  it('never joins adjacent numeric cells (the exact "0 EUR19%" corruption)', () => {
    const html = '<div><div><div>Hasta 6.000 EUR</div><div>0 EUR</div><div>19%</div></div></div>';
    const text = paragraphText(html);
    expect(text).not.toContain('0 EUR19%');
    expect(text).toContain('0 EUR');
    expect(text).toContain('19%');
  });

  it('keeps a lone "–" cell distinct from its neighbours', () => {
    const html = '<div><div><div>Ajuste</div><div>–</div><div>0%</div></div></div>';
    const text = paragraphText(html);
    expect(text).not.toContain('Ajuste–');
    expect(text).not.toContain('–0%');
    expect(text).toContain('–');
  });

  it('keeps identical adjacent cells distinct rather than merging into one run', () => {
    const html = '<div><div><div>Nota</div><div>EUR</div><div>EUR</div></div></div>';
    const text = paragraphText(html);
    expect(text).not.toContain('NotaEUREUR');
    expect(text.match(/EUR/g)?.length).toBe(2);
  });

  it('does not add spurious spaces around inline elements mid-sentence (no regression)', () => {
    const html = '<p>The <strong>quick</strong> fox jumps over the <em>lazy</em> dog.</p>';
    expect(paragraphText(html)).toBe('The quick fox jumps over the lazy dog.');
  });

  it('does not add a boundary around a plain inline element (e.g. <sup>) mid-word', () => {
    const html = '<p>footnote<sup>1</sup> continues</p>';
    expect(paragraphText(html)).toBe('footnote1 continues');
  });
});
