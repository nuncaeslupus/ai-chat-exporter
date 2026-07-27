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
      const html = '<ul><li>Parent<ol><li>Child A</li><li>Child B</li></ol></li><li>Sibling</li></ul>';
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
      const html = '<pre><code class="language-js">const a = 1;</code></pre><p><code>inline</code></p>';
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
      const html = '<div><div><div><table><tbody><tr><td>deep</td></tr></tbody></table></div></div></div>';
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

    it('parses an image with dimensions when a sibling block element forces block parsing', () => {
      // The img has to share a parent with another recognized block element (here <hr>)
      // to reach the image-parsing branch at all -- see the bug noted below.
      const html = '<img src="https://example.com/x.png" alt="alt text" width="100" height="50"><hr>';
      const blocks = HtmlContentParser.parse(html);
      expect(blocks[0]).toMatchObject({
        type: 'image',
        url: 'https://example.com/x.png',
        alt: 'alt text',
        width: 100,
        height: 50,
      });
    });

    // BUG: a standalone <img> (no other block-level sibling) is silently dropped.
    // `parse()` and the `case 'p'/'div'` block in `parseElement()` both decide whether
    // to route content through block parsing (which has the `case 'img'` handler) by
    // checking for a fixed list of tags that does not include 'img'. When it's absent,
    // content falls through to `parseInlineContent()`, whose default branch reads
    // `el.textContent` -- always '' for an <img> -- so the image is discarded with no
    // error. This means a lone image (or an image inside a lone <p>/<div>) never
    // appears in exported output. Not fixed here -- test-only task; asserting the
    // current (wrong) behavior explicitly so it doesn't get silently "fixed" by a
    // future refactor without anyone noticing the semantic change.
    it('BUG: silently drops a standalone image with no block-level sibling', () => {
      const html = '<img src="https://example.com/x.png" alt="alt text">';
      const blocks = HtmlContentParser.parse(html);
      expect(blocks).toEqual([]); // should contain an image block; it does not
    });

    it('BUG: silently drops an image that is the sole content of a <p>', () => {
      const html = '<p><img src="https://example.com/x.png" alt="alt text"></p>';
      const blocks = HtmlContentParser.parse(html);
      expect(blocks).toEqual([]); // should contain a paragraph/image block; it does not
    });
  });
});
