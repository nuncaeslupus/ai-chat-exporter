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
import type { Conversation } from '../../../../src/core/types';
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
    includeMetadata: true,
    includeTimestamps: false,
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

  async function exportStructured(includeMetadata: boolean) {
    const conversation = buildStructuredConversation();
    const exporter = new HtmlExporter();
    const result = await exporter.export(conversation, conversation.pairs, {
      format: 'html',
      filename: 'test',
      includeMetadata,
      includeTimestamps: false,
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
    // Standalone: styling and syntax highlighting are inlined, not fetched.
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
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
      includeMetadata: false,
      includeTimestamps: false,
    });
    const html = await blobToText(result.blob!);

    // Must never be interpreted as a real <b> tag or unescaped ampersand.
    expect(html).not.toContain('<b>Is 1 < 2');
    expect(html).toContain('&lt;b&gt;Is 1 &lt; 2&lt;/b&gt; &amp; &quot;quoted&quot;?');
  });

  it('embeds highlight.js classes on code blocks, matching the language shared across formats', async () => {
    const { html } = await exportStructured(false);

    expect(html).toContain(
      '<pre><code class="language-js">function foo() { return 1; }</code></pre>'
    );

    // The highlighter that runs client-side on open promotes 'hljs' onto the
    // same code element and tags recognized keywords -- exercise it for real
    // in a DOM rather than just checking the static markup.
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      url: 'https://example.com/export.html',
    });
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    const codeBlock = dom.window.document.querySelector('pre code');
    expect(codeBlock?.classList.contains('hljs')).toBe(true);
  });

  it('highlights a keyword and a quoted string in the same code block without corrupting markup', async () => {
    // A code sample with BOTH a keyword and a quoted string: the keyword
    // pass injects `<span class="hljs-keyword">...</span>` and a later
    // "strings" pass must not re-match the quoted `"hljs-keyword"` class
    // attribute value it just wrote.
    const dom = await exportAndRun('function foo() { return "hi"; }');
    const codeBlock = dom.window.document.querySelector('pre code');
    expect(codeBlock).not.toBeNull();

    // No <span> markup ever nested inside another element's class attribute
    // value -- the reported corruption pattern.
    for (const el of Array.from(codeBlock!.querySelectorAll('*'))) {
      expect(el.getAttribute('class')).not.toContain('<span');
    }

    const keywordText = Array.from(codeBlock!.querySelectorAll('.hljs-keyword')).map(
      (el) => el.textContent
    );
    expect(keywordText).toEqual(expect.arrayContaining(['function', 'return']));

    const stringText = Array.from(codeBlock!.querySelectorAll('.hljs-string')).map(
      (el) => el.textContent
    );
    expect(stringText).toEqual(['"hi"']);
  });

  it('keeps message order, heading level, and code placement consistent', async () => {
    const { conversation, html } = await exportStructured(true);

    const idx = (s: string) => html.indexOf(s);
    expect(idx(conversation.url)).toBeGreaterThan(-1); // metadata rendered
    expect(idx(conversation.url)).toBeLessThan(idx('plain question')); // metadata before body
    expect(idx('plain question')).toBeLessThan(idx('Section Heading')); // question before answer
    expect(idx('Section Heading')).toBeLessThan(idx('Some text')); // heading before paragraph
    expect(idx('Some text')).toBeLessThan(idx('function foo() { return 1; }')); // paragraph before code
    // A content heading of level 2 is shifted down two levels since the
    // document title already occupies <h1>.
    expect(html).toContain('<h4>Section Heading</h4>');
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

  it('renders a per-message timestamp when includeTimestamps is on', async () => {
    const exporter = new HtmlExporter();
    const conversation = buildStructuredConversation();
    const result = await exporter.export(conversation, conversation.pairs, {
      format: 'html',
      filename: 'test',
      includeMetadata: false,
      includeTimestamps: true,
    });
    const html = await blobToText(result.blob!);
    expect(html).toContain('(12:00:00)');
    // The day is announced once by a day separator, not repeated per message.
    expect(html).not.toContain('2025-01-01 12:00:00');
  });

  it('omits the timestamp when includeTimestamps is off', async () => {
    const exporter = new HtmlExporter();
    const conversation = buildStructuredConversation();
    const result = await exporter.export(conversation, conversation.pairs, {
      format: 'html',
      filename: 'test',
      includeMetadata: false,
      includeTimestamps: false,
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
      includeMetadata: false,
      includeTimestamps: true,
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
      includeMetadata: true,
      includeTimestamps: false,
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
