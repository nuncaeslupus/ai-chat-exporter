/**
 * HTML Exporter security tests
 *
 * The exported file ships its own inline syntax-highlighting <script> that
 * runs when the file is later opened. That script reads `block.textContent`
 * (decoding whatever the exporter escaped back to raw text) and reassigns
 * `block.innerHTML`. These tests actually execute that script in a real DOM
 * (via jsdom's `runScripts: 'dangerously'`) to prove attacker-controlled
 * message content stays inert instead of just inspecting the HTML string.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import { blobToText } from '../../../utils/exporter-helpers';

function buildConversation(codeHtml: string): Conversation {
  return {
    id: 'test-conversation',
    title: 'Test Conversation',
    platform: 'chatgpt',
    model: 'gpt-4',
    url: 'https://chatgpt.com/c/test',
    createdAt: new Date('2025-01-01T12:00:00Z'),
    pairs: [
      {
        id: 'pair-0',
        index: 0,
        selected: true,
        question: {
          id: 'q-0',
          role: 'user',
          content: 'Show me an example',
          timestamp: new Date('2025-01-01T12:00:00Z'),
        },
        answer: {
          id: 'a-0',
          role: 'assistant',
          content: 'Here it is',
          htmlContent: `<pre><code>${codeHtml}</code></pre>`,
          timestamp: new Date('2025-01-01T12:00:00Z'),
        },
      },
    ],
  };
}

async function exportAndRun(codeHtml: string) {
  const exporter = new HtmlExporter();
  const conversation = buildConversation(codeHtml);
  const result = await exporter.export(conversation, conversation.pairs, {
    format: 'html',
    filename: 'test',
    showMetaInfo: true,
  });
  expect(result.success).toBe(true);
  if (!result.blob) {
    throw new Error('export() did not return a blob');
  }
  const html = await blobToText(result.blob);

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/export.html',
  });
  // Let the DOMContentLoaded-triggered highlighter script run.
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  return dom;
}

describe('HtmlExporter security', () => {
  it('renders script tags in message content inert in the HTML export', async () => {
    // A code sample that literally contains a <script> tag as example text
    // (e.g. a tutorial about XSS), escaped by the exporter as &lt;script&gt;.
    const dom = await exportAndRun('&lt;script&gt;window.__pwned()&lt;/script&gt;');

    // The highlighter must not have turned the escaped text back into a
    // live <script> element inside the code block.
    expect(dom.window.document.querySelector('code script')).toBeNull();
  });

  it('does not execute inline event handlers from scraped content', async () => {
    const dom = await exportAndRun('&lt;img src=x onerror=alert(1)&gt;');

    const codeBlock = dom.window.document.querySelector('pre code');
    expect(codeBlock).not.toBeNull();
    // The highlighter must not have turned the escaped text back into a
    // live <img> element with a working onerror handler.
    expect(codeBlock?.querySelector('img')).toBeNull();
    // The literal text should still be visible to the reader.
    expect(codeBlock?.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

// SEC-1 (medium): the structured-block path (metadata.images/media, and
// htmlContent anchors parsed by html-content-parser.ts) writes scraped URLs
// straight into href/src with only escapeHtml -- no scheme check at all,
// unlike the prose-artifact path which goes through sanitizeHtml. Each case
// here must fail before routing block.url/item.url through safeUrl.
describe('HtmlExporter structured-block URL validation (SEC-1)', () => {
  function conversationWithAnswer(overrides: Record<string, unknown>): Conversation {
    return {
      id: 'test-conversation',
      title: 'Test',
      platform: 'chatgpt',
      model: 'gpt-4',
      url: 'https://chatgpt.com/c/test',
      createdAt: new Date('2025-01-01T12:00:00Z'),
      pairs: [
        {
          id: 'pair-0',
          index: 0,
          selected: true,
          question: {
            id: 'q-0',
            role: 'user',
            content: 'question',
            timestamp: new Date('2025-01-01T12:00:00Z'),
          },
          answer: {
            id: 'a-0',
            role: 'assistant',
            content: 'answer',
            timestamp: new Date('2025-01-01T12:00:00Z'),
            ...overrides,
          },
        },
      ],
    } as unknown as Conversation;
  }

  async function renderHtml(overrides: Record<string, unknown>): Promise<string> {
    const conversation = conversationWithAnswer(overrides);
    const exporter = new HtmlExporter();
    const result = await exporter.export(conversation, conversation.pairs, {
      format: 'html',
      filename: 'test',
      showMetaInfo: false,
    } as unknown as ExportOptions);
    expect(result.success).toBe(true);
    return blobToText(result.blob!);
  }

  it('does not carry a javascript: URL from metadata.images into a live <img src>', async () => {
    const html = await renderHtml({
      metadata: { images: [{ src: 'javascript:alert(1)', alt: 'evil' }] },
    });
    expect(html).not.toContain('javascript:alert');
  });

  it('still renders a real http(s) image from metadata.images', async () => {
    const html = await renderHtml({
      metadata: { images: [{ src: 'https://example.com/pic.png', alt: 'a real image' }] },
    });
    expect(html).toContain('<img src="https://example.com/pic.png" alt="a real image">');
  });

  it('does not carry a javascript: URL from metadata.media into a live <audio src>', async () => {
    const html = await renderHtml({
      metadata: { media: [{ kind: 'audio', src: 'javascript:alert(1)' }] },
    });
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('<audio controls src="javascript');
  });

  it('does not carry a javascript: URL from a scraped <a href> into a live anchor', async () => {
    const html = await renderHtml({
      htmlContent: '<p><a href="javascript:alert(1)">click me</a></p>',
    });
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('<a href="javascript');
    // The link text still reaches the reader, just not as a live link.
    expect(html).toContain('click me');
  });

  it('still renders a real https link from scraped content', async () => {
    const html = await renderHtml({
      htmlContent: '<p><a href="https://example.com/report">report</a></p>',
    });
    expect(html).toContain(
      '<a href="https://example.com/report" target="_blank" rel="noopener noreferrer">report</a>'
    );
  });

  it('does not carry a javascript: URL from a web-search result into a live anchor', async () => {
    const html = await renderHtml({
      metadata: {
        webSearches: [
          {
            query: 'q',
            results: [{ title: 'evil result', url: 'javascript:alert(1)', domain: 'evil.example' }],
          },
        ],
      },
    });
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('evil result'); // title still shown, just not as a link
  });
});

describe('HtmlExporter structural contract', () => {
  function buildStructuredConversation(): Conversation {
    return {
      id: 'test-conversation',
      title: 'HTML Structure Test',
      platform: 'claude',
      model: 'claude-3',
      url: 'https://claude.ai/chat/html-structure-test',
      createdAt: new Date('2025-01-01T12:00:00Z'),
      pairs: [
        {
          id: 'pair-0',
          index: 0,
          selected: true,
          question: {
            id: 'q-0',
            role: 'user',
            content: 'plain question',
            timestamp: new Date('2025-01-01T12:00:00Z'),
          },
          answer: {
            id: 'a-0',
            role: 'assistant',
            content: 'Section Heading Some text function foo() { return 1; }',
            htmlContent:
              '<h2>Section Heading</h2><p>Some text</p><pre><code class="language-js">function foo() { return 1; }</code></pre>',
            timestamp: new Date('2025-01-01T12:00:00Z'),
          },
        },
      ],
    } as unknown as Conversation;
  }

  async function exportStructured(showMetaInfo: boolean) {
    const conversation = buildStructuredConversation();
    const exporter = new HtmlExporter();
    const result = await exporter.export(conversation, conversation.pairs, {
      format: 'html',
      filename: 'test',
      showMetaInfo,
    });
    expect(result.success).toBe(true);
    return { conversation, html: await blobToText(result.blob!) };
  }

  it('emits a full standalone document', async () => {
    const { html } = await exportStructured(true);

    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</html>');
    // Standalone: styling is inlined, not fetched.
    expect(html).toContain('<style>');
    // R-8: highlighting happens at export time, so the file needs no script at
    // all. It used to ship ~60 lines of regex highlighting that ran on
    // DOMContentLoaded — code was uncoloured until JS ran, and not at all where
    // scripts are blocked.
    expect(html).not.toContain('<script>');
    expect(html).toContain('.tok-keyword');
  });

  it('escapes HTML-significant characters in plain user content', async () => {
    const conversation = buildStructuredConversation();
    // No htmlContent -- exercises the plain-text fallback path, which runs
    // the raw message content straight through the exporter's own escaper.
    conversation.pairs[0]!.question.content = '<b>Is 1 < 2</b> & "quoted"?';
    const exporter = new HtmlExporter();
    const result = await exporter.export(conversation, conversation.pairs, {
      format: 'html',
      filename: 'test',
      showMetaInfo: false,
    });
    const html = await blobToText(result.blob!);

    // Must never be interpreted as a real <b> tag or unescaped ampersand.
    expect(html).not.toContain('<b>Is 1 < 2');
    expect(html).toContain('&lt;b&gt;Is 1 &lt; 2&lt;/b&gt; &amp; &quot;quoted&quot;?');
  });

  it('tags a code block with its language and bakes the token spans in', async () => {
    const { html } = await exportStructured(false);

    // The language still travels on the code element, as every format shares it.
    expect(html).toContain('<pre><code class="language-js">');

    // R-8: no script runs, so parse the static markup — the spans are already
    // there. The code text must survive verbatim through the tokenizer.
    const dom = new JSDOM(html, { url: 'https://example.com/export.html' });
    const codeBlock = dom.window.document.querySelector('pre code');
    expect(codeBlock?.textContent).toBe('function foo() { return 1; }');
    expect(codeBlock?.querySelectorAll('.tok-keyword').length).toBeGreaterThan(0);
  });

  it('highlights a keyword and a quoted string in the same block without corrupting markup', async () => {
    // The original corruption this guards against: a chained-regex highlighter
    // wrote `<span class="hljs-keyword">`, then its later "strings" pass
    // re-matched the quoted class attribute it had just emitted. hljs tokenizes
    // properly, but the guarantee is worth keeping asserted.
    const dom = await exportAndRun('function foo() { return "hi"; }');
    const codeBlock = dom.window.document.querySelector('pre code');
    expect(codeBlock).not.toBeNull();

    // No span markup ever ends up inside another element's class attribute.
    for (const el of Array.from(codeBlock!.querySelectorAll('*'))) {
      expect(el.getAttribute('class')).not.toContain('<span');
    }

    const keywords = Array.from(codeBlock!.querySelectorAll('.tok-keyword')).map(
      (el) => el.textContent
    );
    expect(keywords).toEqual(expect.arrayContaining(['function', 'return']));

    const strings = Array.from(codeBlock!.querySelectorAll('.tok-string')).map(
      (el) => el.textContent
    );
    expect(strings).toEqual(['"hi"']);

    // And the code still reads exactly as written.
    expect(codeBlock!.textContent).toBe('function foo() { return "hi"; }');
  });

  it('keeps message order, heading level, and code placement consistent', async () => {
    const { conversation, html } = await exportStructured(true);

    const idx = (s: string) => html.indexOf(s);
    expect(idx(conversation.url)).toBeGreaterThan(-1); // metadata rendered
    expect(idx(conversation.url)).toBeLessThan(idx('plain question')); // metadata before body
    expect(idx('plain question')).toBeLessThan(idx('Section Heading')); // question before answer
    expect(idx('Section Heading')).toBeLessThan(idx('Some text')); // heading before paragraph
    // R-8 splits the code across token spans, so the literal source string is
    // no longer present verbatim in the markup; anchor on the <pre> instead.
    expect(idx('Some text')).toBeLessThan(idx('<pre><code class="language-js">'));
    // D-32: body headings are normalised, not offset by a flat +1. h2 is the
    // ONLY source heading level present in this conversation, so it ranks
    // first and lands on document level 2 (<h2>) -- the level right after the
    // title, regardless of the raw source number.
    expect(html).toContain('<h2>Section Heading</h2>');
  });
});

describe('HtmlExporter per-message timestamps', () => {
  function buildStructuredConversation(): Conversation {
    return {
      id: 'test-conversation',
      title: 'HTML Structure Test',
      platform: 'claude',
      model: 'claude-3',
      url: 'https://claude.ai/chat/html-structure-test',
      createdAt: new Date('2025-01-01T12:00:00Z'),
      pairs: [
        {
          id: 'pair-0',
          index: 0,
          selected: true,
          question: {
            id: 'q-0',
            role: 'user',
            content: 'plain question',
            timestamp: new Date('2025-01-01T12:00:00Z'),
          },
          answer: {
            id: 'a-0',
            role: 'assistant',
            content: 'plain answer',
            timestamp: new Date('2025-01-01T12:00:00Z'),
          },
        },
      ],
    } as unknown as Conversation;
  }

  it('renders a per-message timestamp when showMetaInfo is on', async () => {
    const exporter = new HtmlExporter();
    const conversation = buildStructuredConversation();
    const result = await exporter.export(conversation, conversation.pairs, {
      format: 'html',
      filename: 'test',
      showMetaInfo: true,
    });
    const html = await blobToText(result.blob!);
    expect(html).toContain('(12:00:00)');
    // The day is announced once by a day separator, not repeated per message.
    // The date belongs to the header (which showMetaInfo also turns on) and to
    // the day separator — never to a per-message stamp.
    // The per-message stamp lives in .message-timestamp and carries a time only.
    const stamps = [...html.matchAll(/<span class="message-timestamp">([^<]*)<\/span>/g)].map(
      (m) => m[1] ?? ''
    );
    expect(stamps.length).toBeGreaterThan(0);
    expect(stamps.every((t) => !t.includes('2025-01-01'))).toBe(true);
  });

  it('omits the timestamp when showMetaInfo is off', async () => {
    const exporter = new HtmlExporter();
    const conversation = buildStructuredConversation();
    const result = await exporter.export(conversation, conversation.pairs, {
      format: 'html',
      filename: 'test',
      showMetaInfo: false,
    });
    const html = await blobToText(result.blob!);
    expect(html).not.toContain('12:00:00');
  });

  it('emits no stray label or "undefined" when a message has no timestamp', async () => {
    const conversation = buildStructuredConversation();
    delete (conversation.pairs[0]!.question as { timestamp?: Date }).timestamp;
    delete (conversation.pairs[0]!.answer as { timestamp?: Date }).timestamp;
    const exporter = new HtmlExporter();
    const result = await exporter.export(conversation, conversation.pairs, {
      format: 'html',
      filename: 'test',
      showMetaInfo: true,
    });
    const html = await blobToText(result.blob!);
    expect(html).not.toContain('undefined');
    // Scope to the message-header sections -- the embedded highlighter
    // <script> legitimately contains empty-paren arrow functions elsewhere
    // in the document.
    const headers = html.match(/<div class="message-header">[\s\S]*?<\/div>/g) ?? [];
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header).not.toMatch(/\(\s*\)/);
    }
  });
});

describe('exported HTML makes no third-party requests', () => {
  /**
   * PR #49 removed citation favicons at the parser, but the exporter's <img>
   * sink survived — one repopulated field away from an exported file phoning a
   * third-party icon service (and leaking the reader's IP) on every open.
   * This asserts the property at the sink, so it holds whatever parsers do.
   */
  async function exportWithSearch(): Promise<string> {
    const conversation = buildConversation('const x = 1;');
    conversation.pairs[0]!.answer.metadata = {
      webSearches: [
        {
          query: 'example query',
          resultCount: 1,
          results: [
            {
              title: 'Example result',
              url: 'https://example.com/article',
              domain: 'example.com',
              favicon: 'https://logo.clearbit.com/example.com',
            },
          ],
        },
      ],
    };
    const exporter = new HtmlExporter();
    const result = await exporter.export(conversation, conversation.pairs, {
      format: 'html',
      filename: 'test',
      showMetaInfo: true,
    });
    expect(result.success).toBe(true);
    return blobToText(result.blob!);
  }

  it('does not emit a favicon <img> even when a result carries one', async () => {
    const html = await exportWithSearch();
    expect(html).not.toContain('logo.clearbit.com');
    expect(html).not.toContain('result-favicon');
  });

  it('embeds no remote subresource of any kind', async () => {
    const html = await exportWithSearch();
    const dom = new JSDOM(html);
    const remote = [
      ...dom.window.document.querySelectorAll('img[src], script[src], link[href], iframe[src]'),
    ]
      .map((el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '')
      .filter((u) => /^https?:\/\//i.test(u));
    expect(remote).toEqual([]);
  });

  it('still renders the result title and destination', async () => {
    const html = await exportWithSearch();
    expect(html).toContain('Example result');
    expect(html).toContain('https://example.com/article');
  });
});

describe('R-6: HTML adopts the redesign', () => {
  const pair = {
    id: 'p0',
    index: 0,
    selected: true,
    question: {
      id: 'q0',
      role: 'user',
      content: 'asked',
      timestamp: new Date('2025-01-01T12:04:00Z'),
    },
    answer: {
      id: 'a0',
      role: 'assistant',
      content: 'answered',
      htmlContent:
        '<p>answered</p><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
      timestamp: new Date('2025-01-01T12:05:00Z'),
    },
  } as unknown as QAPair;

  const conversation = {
    id: 'c1',
    title: 'Systematic research',
    platform: 'chatgpt',
    model: 'gpt-4o',
    url: 'https://chatgpt.com/c/test',
    createdAt: new Date('2025-01-01T15:12:00Z'),
    pairs: [pair],
  } as unknown as Conversation;

  async function render(): Promise<string> {
    const result = await new HtmlExporter().export(conversation, [pair], {
      format: 'html',
      filename: 'test',
      showMetaInfo: true,
    } as unknown as ExportOptions);
    return blobToText(result.blob!);
  }

  /** The base stylesheet, before any @media override. */
  function baseCss(html: string): string {
    return html.split('@media')[0]!;
  }

  it('puts the turn fill on the question, not the answer', async () => {
    const css = baseCss(await render());
    const user = /\.user-message \{([^}]*)\}/.exec(css)![1]!;
    const assistant = /\.assistant-message \{([^}]*)\}/.exec(css)![1]!;

    // The background marks who is ASKING now, which is the reverse of before.
    expect(user).toMatch(/background:\s*#F6F7F6/i);
    expect(assistant).toMatch(/background:\s*(transparent|none)/i);
  });

  it('rules the role label with the platform brand colour', async () => {
    const css = baseCss(await render());
    expect(css).toMatch(/\.message-role\b[^}]*border-bottom/);
  });

  it('gives tables horizontal rules only', async () => {
    const css = baseCss(await render());
    const cells = /\.message-content th,\s*\.message-content td \{([^}]*)\}/.exec(css)![1]!;

    // No full grid: only a bottom rule per row.
    expect(cells).not.toMatch(/border:\s*1px/);
    expect(cells).toMatch(/border-bottom:/);
  });

  it('drops the alternating row fill everywhere, not just in light mode', async () => {
    // The whole document, not just baseCss: the dark-mode block had its own copy
    // of the striping, so checking only the base stylesheet passed while dark
    // mode still striped its tables.
    const html = await render();
    expect(html).not.toMatch(/tr:nth-child\(even\)/);
  });

  it('inverts the dark-mode fill the same way, so both modes agree', async () => {
    const html = await render();
    const dark = html.slice(html.indexOf('prefers-color-scheme: dark'));
    const assistant = /\.assistant-message \{([^}]*)\}/.exec(dark)![1]!;
    expect(assistant).toMatch(/background:\s*transparent/i);
  });

  it('scales the document title to the shared 20pt', async () => {
    const html = await render();
    // 20pt = 26.67px at 96dpi.
    expect(baseCss(html)).toMatch(/\.title \{[^}]*font-size:\s*26\.67px/);
  });

  it('keeps the role label out of the heading outline', async () => {
    const html = await render();
    expect(html).toContain('<p class="message-role">');
    expect(html).not.toMatch(/<h[1-6] class="message-role">/);
  });
});

describe('prose artifacts render as prose, not as source', () => {
  function conversationWithArtifact(artifact: Record<string, unknown>): Conversation {
    return {
      id: 'c1',
      title: 'Research',
      platform: 'gemini',
      url: 'https://gemini.google.com/app/1',
      createdAt: new Date('2026-07-29T15:12:00Z'),
      pairs: [
        {
          id: 'p0',
          index: 0,
          selected: true,
          question: { id: 'q0', role: 'user', content: 'research this' },
          answer: {
            id: 'a0',
            role: 'assistant',
            content: 'here it is',
            metadata: { artifacts: [artifact] },
          },
        },
      ],
    } as unknown as Conversation;
  }

  async function render(artifact: Record<string, unknown>): Promise<string> {
    const conversation = conversationWithArtifact(artifact);
    const result = await new HtmlExporter().export(conversation, conversation.pairs, {
      format: 'html',
      filename: 'test',
      showMetaInfo: false,
    } as unknown as ExportOptions);
    return blobToText(result.blob!);
  }

  it('renders a deep-research markdown document instead of showing its source', async () => {
    const html = await render({
      type: 'document',
      title: 'Deep research report',
      language: 'markdown',
      content: '## Findings\n\nFive anchored folds, with a [source](https://example.com).\n',
    });

    // Rendered: a real heading and a real link.
    expect(html).toContain('<h2>Findings</h2>');
    expect(html).toContain('<a href="https://example.com">source</a>');
    expect(html).toContain('class="artifact-document"');
    // Not shown as source.
    expect(html).not.toContain('## Findings');
  });

  it('still shows a code artifact as code', async () => {
    const html = await render({
      type: 'code',
      title: 'snippet',
      language: 'python',
      content: 'def f():\n    return 1\n',
    });

    expect(html).toContain('<pre><code class="language-python">');
    expect(html).not.toContain('class="artifact-document"');
  });

  it('sanitizes a prose artifact, since marked passes raw HTML through', async () => {
    const html = await render({
      type: 'document',
      title: 'Hostile report',
      language: 'markdown',
      content: '## Title\n\n<script>window.__pwned = 1</script>\n\n<img src=x onerror=alert(1)>\n',
    });

    // The heading still renders...
    expect(html).toContain('<h2>Title</h2>');
    // ...but nothing executable survives into a file the reader will open.
    expect(html).not.toContain('<script>window.__pwned');
    expect(html).not.toContain('onerror=');
  });

  it('highlights a code fence inside a prose artifact, like any other code block', async () => {
    const html = await render({
      type: 'document',
      title: 'Report with code',
      language: 'markdown',
      content: '## Method\n\n```python\ndef f():\n    return "x"\n```\n',
    });

    // One document must not show highlighted code in a message and plain code in
    // a research report.
    const doc = html.slice(html.indexOf('artifact-document'));
    expect(doc).toContain('class="tok-keyword"');
    expect(doc).toContain('class="tok-string"');
  });
});
