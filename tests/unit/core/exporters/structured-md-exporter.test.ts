/**
 * Structured Markdown Exporter Tests
 */

import { describe, it, expect } from 'vitest';
import { marked, type Tokens } from 'marked';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { blobToText } from '../../../utils/exporter-helpers';

function buildPair(withTimestamp: boolean): QAPair {
  return {
    id: 'pair-0',
    index: 0,
    selected: true,
    question: {
      id: 'q-0',
      role: 'user',
      content: 'plain question',
      timestamp: withTimestamp ? new Date('2025-01-01T12:00:00Z') : undefined,
    },
    answer: {
      id: 'a-0',
      role: 'assistant',
      content: 'plain answer',
      timestamp: withTimestamp ? new Date('2025-01-01T12:00:00Z') : undefined,
    },
  } as unknown as QAPair;
}

function buildConversation(pair: QAPair): Conversation {
  return {
    id: 'test-conversation',
    title: 'Test Conversation',
    platform: 'chatgpt',
    model: 'gpt-4',
    pairs: [pair],
    url: 'https://chatgpt.com/c/test',
    createdAt: new Date('2025-01-01T12:00:00Z'),
  } as unknown as Conversation;
}

describe('StructuredMarkdownExporter timestamps', () => {
  it('renders a per-message timestamp when showMetaInfo is on', async () => {
    const pair = buildPair(true);
    const conversation = buildConversation(pair);
    const result = await new StructuredMarkdownExporter().export(conversation, [pair], {
      format: 'md',
      filename: 'test',
      showMetaInfo: true,
    });
    const text = await blobToText(result.blob!);
    // R-4: hours and minutes after a middot, not a parenthesised HH:MM:SS.
    expect(text).toContain('· 12:00');
    // The date belongs to the header (which showMetaInfo also turns on) and to
    // the day separator — never to a per-message stamp. Assert on the role label
    // lines, since the document now legitimately carries a full export date too.
    const roleLines = text.split('\n').filter((l) => /^\*\*\w+\*\*/.test(l));
    expect(roleLines.length).toBeGreaterThan(0);
    expect(roleLines.every((l) => !l.includes('2025-01-01'))).toBe(true);
  });

  it('omits the timestamp when showMetaInfo is off', async () => {
    const pair = buildPair(true);
    const conversation = buildConversation(pair);
    const result = await new StructuredMarkdownExporter().export(conversation, [pair], {
      format: 'md',
      filename: 'test',
      showMetaInfo: false,
    });
    const text = await blobToText(result.blob!);
    // R-4 moved the per-message stamp to `**Role** · HH:MM` — this format never
    // emits seconds, so a '12:00:00' assertion could never fail even with the
    // preference honoured. '· 12:00' is the string the positive test above
    // actually asserts on, negated.
    expect(text).not.toContain('· 12:00');
  });

  it('emits no stray label or "undefined" when a message has no timestamp', async () => {
    const pair = buildPair(false);
    const conversation = buildConversation(pair);
    const result = await new StructuredMarkdownExporter().export(conversation, [pair], {
      format: 'md',
      filename: 'test',
      showMetaInfo: true,
    });
    const text = await blobToText(result.blob!);
    expect(text).not.toContain('undefined');
    // R-4's role label has no parens left to leave empty ('**Role** · HH:MM');
    // a timestamp-less message's own failure mode is a stray middot with
    // nothing after it, e.g. '**User** · ' if the `!timestamp` guard were lost.
    expect(text).not.toMatch(/\*\*\w+\*\*\s*·\s*$/m);
  });
});

describe('R-4: Markdown composition', () => {
  const answerWithRichBody = (): QAPair =>
    ({
      id: 'pair-0',
      index: 0,
      selected: true,
      question: {
        id: 'q-0',
        role: 'user',
        content: 'first line\n\nsecond line',
        htmlContent: '<p>first line</p><p>second line</p>',
        timestamp: new Date('2025-01-01T12:04:37Z'),
      },
      answer: {
        id: 'a-0',
        role: 'assistant',
        content: 'Alpha body',
        htmlContent:
          '<h1>Alpha</h1><p>body</p><img src="https://example.com/equity.png" alt="equity curve">',
        timestamp: new Date('2025-01-01T12:05:02Z'),
      },
    }) as unknown as QAPair;

  async function render(pair: QAPair, showMetaInfo = true): Promise<string> {
    const conversation = buildConversation(pair);
    const result = await new StructuredMarkdownExporter().export(conversation, [pair], {
      format: 'md',
      filename: 'test',
      showMetaInfo,
    });
    return blobToText(result.blob!);
  }

  it('renders the role label as bold text with a middot and no seconds', async () => {
    const text = await render(answerWithRichBody());

    expect(text).toContain('**User** · 12:04');
    // The assistant's name comes from i18n, which this harness does not provide,
    // so assert the shape rather than the resolved word.
    expect(text).toMatch(/^\*\*\w+\*\* · 12:05$/m);
    // No seconds on a per-message time, and no heading or emoji form.
    expect(text).not.toContain('12:04:37');
    expect(text).not.toMatch(/^#+ .*(User|ChatGPT)/m);
    expect(text).not.toMatch(/[👤🤖]/u);
  });

  it('drops the middot entirely when there is no time to show', async () => {
    const text = await render(answerWithRichBody(), false);

    expect(text).toContain('**User**');
    expect(text).not.toContain('·');
  });

  it('renders the question as a blockquote', async () => {
    const text = await render(answerWithRichBody());

    expect(text).toContain('> first line');
    expect(text).toContain('> second line');
    // The answer is not quoted — the quote is what distinguishes the voices.
    expect(text).not.toContain('> body');
  });

  it('renders a content image with native Markdown, not a sized img tag', async () => {
    const text = await render(answerWithRichBody());

    expect(text).toContain('![equity curve](https://example.com/equity.png)');
    // The 200px "webchat thumbnail" scaling is gone for good.
    expect(text).not.toContain('max-width: 200px');
    expect(text).not.toMatch(/<img[^>]*equity\.png/);
  });

  it('keeps the metadata block as a table', async () => {
    const text = await render(answerWithRichBody());

    expect(text).toMatch(/^\|---\|---\|$/m);
    expect(text).toContain('https://chatgpt.com/c/test');
  });
});

/**
 * TEST-1 (high): `renderTable` and its inner callbacks (the separator-row
 * push in particular) had zero coverage — the only `|---|` assertion in the
 * suite was against the hand-assembled metadata table, not this renderer.
 * Without the GFM separator row, a "table" is just pipe-separated text lines
 * in GitHub/Obsidian/pandoc. Adjacency (index comparison), not a bare
 * toContain, is what actually pins the separator immediately after the
 * header row rather than matching the metadata table elsewhere in the doc.
 */
describe('R-4: markdown table rendering (renderTable)', () => {
  it('renders the header row, the GFM separator row directly after it, then data', async () => {
    const pair = {
      id: 'p0',
      index: 0,
      selected: true,
      question: { id: 'q0', role: 'user', content: 'q', timestamp: undefined },
      answer: {
        id: 'a0',
        role: 'assistant',
        content: 'a',
        htmlContent:
          '<table><thead><tr><th>Fold</th><th>Train</th></tr></thead>' +
          '<tbody><tr><td>1</td><td>2017-2019</td></tr></tbody></table>',
        timestamp: undefined,
      },
    } as unknown as QAPair;
    const conversation = buildConversation(pair);
    const result = await new StructuredMarkdownExporter().export(conversation, [pair], {
      format: 'md',
      filename: 't',
      showMetaInfo: false,
    });
    const text = await blobToText(result.blob!);
    const lines = text.split('\n');

    const headerIdx = lines.indexOf('| Fold | Train |');
    expect(headerIdx).toBeGreaterThan(-1);
    // RED (pre-fix / regression check): dropping the separator-row push, or
    // inverting the headers guard, leaves this either absent or not adjacent
    // to the header — a bare toContain('|---|') would still pass because the
    // hand-assembled metadata table separator is a different literal.
    expect(lines[headerIdx + 1]).toBe('| --- | --- |');
    expect(lines[headerIdx + 2]).toBe('| 1 | 2017-2019 |');
  });
});

describe('R-4: the question quote is a closed block', () => {
  it('separates the quote from the next role label with an unquoted blank line', async () => {
    const pair = {
      id: 'p',
      index: 0,
      selected: true,
      question: { id: 'q', role: 'user', content: 'asked', timestamp: undefined },
      answer: { id: 'a', role: 'assistant', content: 'answered', timestamp: undefined },
    } as unknown as QAPair;
    const result = await new StructuredMarkdownExporter().export(buildConversation(pair), [pair], {
      format: 'md',
      filename: 't',
      showMetaInfo: false,
    });
    const text = await blobToText(result.blob!);

    // A quote ending on '>' would let Markdown's lazy continuation swallow the
    // assistant's label into the user's question.
    expect(text).not.toMatch(/^>\n\*\*/m);
    expect(text).toMatch(/^> asked\n\n\*\*/m);
  });
});

/**
 * EXP-3: the exporter emits Markdown structure (fences, tables, block
 * markers) without inspecting content that collides with it. Every test here
 * proves the failure by re-parsing the exported .md with the repo's own
 * `marked` dependency -- the same tool a reader would open the file with --
 * rather than asserting on a raw substring.
 */
describe('EXP-3: Markdown structural escaping', () => {
  function pair(question: Partial<QAPair['question']>, answer: Partial<QAPair['answer']>): QAPair {
    return {
      id: 'p',
      index: 0,
      selected: true,
      question: { id: 'q', role: 'user', content: 'q', timestamp: undefined, ...question },
      answer: { id: 'a', role: 'assistant', content: 'a', timestamp: undefined, ...answer },
    } as unknown as QAPair;
  }

  function twoPairConversation(firstAnswerHtml: string): {
    conversation: Conversation;
    pairs: QAPair[];
  } {
    const first = pair(
      { content: 'first question' },
      { content: 'first answer', htmlContent: firstAnswerHtml }
    );
    const second = pair(
      { content: 'second question UNIQUE_MARKER' },
      { content: 'second answer UNIQUE_MARKER' }
    );
    const conversation = {
      id: 'c',
      title: 'T',
      platform: 'chatgpt',
      model: 'gpt-4',
      pairs: [first, second],
      url: 'https://chatgpt.com/c/test',
      createdAt: new Date('2025-01-01T00:00:00Z'),
    } as unknown as Conversation;
    return { conversation, pairs: [first, second] };
  }

  async function renderTwoPairs(firstAnswerHtml: string): Promise<string> {
    const { conversation, pairs } = twoPairConversation(firstAnswerHtml);
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      format: 'md',
      filename: 't',
      showMetaInfo: false,
    });
    return blobToText(result.blob!);
  }

  async function renderSinglePair(qa: QAPair): Promise<string> {
    const conversation = buildConversation(qa);
    const result = await new StructuredMarkdownExporter().export(conversation, [qa], {
      format: 'md',
      filename: 't',
      showMetaInfo: false,
    });
    return blobToText(result.blob!);
  }

  describe('code-fence breakout', () => {
    it('keeps the rest of the conversation intact when a code block contains a ``` fence', async () => {
      const html =
        '<pre><code class="language-markdown">Example:\n```js\nlet a = 1;\n```\ndone</code></pre>';
      const text = await renderTwoPairs(html);

      const tokens = marked.lexer(text);
      // RED (pre-fix): the fixed 3-backtick fence closes early on the nested
      // ``` and a later stray ``` opens a new, never-closed code block that
      // swallows the rest of the document -- so the marker below would only
      // be found inside a 'code' token instead of ordinary prose.
      const markerToken = tokens.find(
        (t) => 'raw' in t && typeof t.raw === 'string' && t.raw.includes('UNIQUE_MARKER')
      );
      expect(markerToken).toBeDefined();
      expect(markerToken?.type).not.toBe('code');
    });

    it('widens the fence past 3 backticks when the code itself contains 4+', async () => {
      const html = '<pre><code class="language-text">before\n````\nafter</code></pre>';
      const text = await renderTwoPairs(html);

      // A 4-backtick run inside the content needs (at least) a 5-backtick fence.
      expect(text).toMatch(/^`{5,}text$/m);

      const tokens = marked.lexer(text);
      const codeToken = tokens.find((t) => t.type === 'code') as Tokens.Code | undefined;
      expect(codeToken?.text).toContain('````');
      const markerToken = tokens.find(
        (t) => 'raw' in t && typeof t.raw === 'string' && t.raw.includes('UNIQUE_MARKER')
      );
      expect(markerToken).toBeDefined();
      expect(markerToken?.type).not.toBe('code');
    });
  });

  describe('unescaped metacharacters', () => {
    it('escapes a pipe inside a table cell so no column is shifted or dropped', async () => {
      const html =
        '<table><thead><tr><th>Cmd</th><th>Desc</th></tr></thead>' +
        '<tbody><tr><td><code>ls | wc -l</code></td><td>counts</td></tr></tbody></table>';
      const text = await renderSinglePair(pair({}, { htmlContent: html }));

      const tokens = marked.lexer(text);
      const table = tokens.find((t) => t.type === 'table') as Tokens.Table | undefined;
      expect(table).toBeDefined();
      // RED (pre-fix): the unescaped pipe inside the code span splits into a
      // phantom extra column, and GFM then drops the declared 'counts' cell
      // because the row has more cells than the header.
      expect(table?.rows[0]?.[1]?.text).toBe('counts');
      expect(table?.rows[0]?.[0]?.tokens?.[0]?.type).toBe('codespan');
    });

    it('does not turn a quoted checklist into a heading and a list inside the user blockquote', async () => {
      const html = '<div># Deploy checklist</div><div>1. drain traffic</div>';
      const text = await renderSinglePair(pair({ htmlContent: html }, {}));

      const tokens = marked.lexer(text);
      const bq = tokens.find((t) => t.type === 'blockquote') as Tokens.Blockquote | undefined;
      expect(bq).toBeDefined();
      const nestedTypes = bq?.tokens.map((t) => t.type) ?? [];
      // RED (pre-fix): '> # Deploy checklist' and '> 1. drain traffic' parse
      // as a real H1 and a real <ol> nested inside the blockquote.
      expect(nestedTypes).not.toContain('heading');
      expect(nestedTypes).not.toContain('list');
      expect(bq?.text).toContain('Deploy checklist');
      expect(bq?.text).toContain('drain traffic');
    });

    it('does not escape emphasis characters mid-sentence or mid-word (no over-escaping)', async () => {
      const html =
        '<p>The cost is 5 * 2 and my_var_name should stay untouched. Also 3.14 and -5.</p>';
      const text = await renderSinglePair(pair({}, { htmlContent: html }));

      expect(text).toContain(
        'The cost is 5 * 2 and my_var_name should stay untouched. Also 3.14 and -5.'
      );
      expect(text).not.toContain('\\*');
      expect(text).not.toContain('\\_');
      expect(text).not.toContain('\\.');
      expect(text).not.toContain('\\-');
    });
  });

  describe('non-Latin-1 SVG artifact', () => {
    it('exports successfully when an SVG artifact contains a non-Latin-1 character', async () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Ventas – 2026</text></svg>';
      const qa = pair(
        {},
        {
          metadata: {
            artifacts: [{ type: 'image', language: 'svg', title: 'Chart', content: svg }],
          },
        }
      );
      const conversation = buildConversation(qa);
      const result = await new StructuredMarkdownExporter().export(conversation, [qa], {
        format: 'md',
        filename: 't',
        showMetaInfo: false,
      });

      // RED (pre-fix): `btoa()` throws on the en dash (U+2013), the export's
      // try/catch converts that into an error result, and NO FILE is produced
      // at all -- not a degraded one.
      expect(result.success).toBe(true);
      expect(result.blob).toBeDefined();

      const text = await blobToText(result.blob!);
      expect(text).toContain('data:image/svg+xml,');
      expect(text).toContain('Ventas');
    });
  });

  describe('nested ordered lists', () => {
    it('re-parses a 3-deep nested ordered list into 3 properly nested lists', async () => {
      const html = '<ol><li>L1<ol><li>L2<ol><li>L3</li></ol></li></ol></li></ol>';
      const text = await renderSinglePair(pair({}, { htmlContent: html }));

      const tokens = marked.lexer(text);
      const outer = tokens.find((t) => t.type === 'list') as Tokens.List | undefined;
      expect(outer).toBeDefined();
      // RED (pre-fix): a fixed 2-space indent step is too narrow for an
      // ordered parent (`1. ` needs 3), so L2 becomes a sibling of L1 with
      // '1. L3' embedded as literal text instead of a real nested list.
      expect(outer?.items).toHaveLength(1);
      expect(
        outer?.items[0]?.tokens.some((t) => t.type === 'text' && t.raw.includes('1. L3'))
      ).toBe(false);

      const middle = outer?.items[0]?.tokens.find((t) => t.type === 'list') as
        | Tokens.List
        | undefined;
      expect(middle).toBeDefined();
      expect(middle?.items).toHaveLength(1);

      const inner = middle?.items[0]?.tokens.find((t) => t.type === 'list') as
        | Tokens.List
        | undefined;
      expect(inner).toBeDefined();
      expect(inner?.items).toHaveLength(1);
      expect(inner?.items[0]?.text).toBe('L3');
    });
  });
});
