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

  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/export.html' });
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
    const remote = [...dom.window.document.querySelectorAll('img[src], script[src], link[href], iframe[src]')]
      .map(el => el.getAttribute('src') ?? el.getAttribute('href') ?? '')
      .filter(u => /^https?:\/\//i.test(u));
    expect(remote).toEqual([]);
  });

  it('still renders the result title and destination', async () => {
    const html = await exportWithSearch();
    expect(html).toContain('Example result');
    expect(html).toContain('https://example.com/article');
  });
});
