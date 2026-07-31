/**
 * Plain Text Exporter Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import {
  blobToText,
  createTestQAPair,
  createTestConversation,
} from '../../../utils/exporter-helpers';

describe('TextExporter', () => {
  let exporter: TextExporter;
  let conversation: Conversation;
  let selectedPairs: QAPair[];

  beforeEach(() => {
    exporter = new TextExporter();
    const pairs = [
      createTestQAPair(0, 'What is TypeScript?', 'TypeScript is a typed superset of JavaScript.'),
      createTestQAPair(1, 'How do I use it?', 'You can install it with npm.'),
    ];
    conversation = createTestConversation(pairs);
    selectedPairs = pairs;
  });

  describe('format property', () => {
    it('returns "txt"', () => {
      expect(exporter.format).toBe('txt');
    });
  });

  describe('extension property', () => {
    it('returns "txt"', () => {
      expect(exporter.extension).toBe('txt');
    });
  });

  describe('mimeType property', () => {
    it('returns "text/plain"', () => {
      expect(exporter.mimeType).toBe('text/plain');
    });
  });

  describe('export()', () => {
    it('returns success with valid blob', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        showMetaInfo: true,
      });
      expect(result.success).toBe(true);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toBe('test.txt');
    });

    it('formats as plain text without markdown', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        showMetaInfo: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).not.toContain('##'); // No markdown headings
      expect(text).not.toContain('**'); // No bold
      expect(text).toContain('USER');
      // R-5: the role label is uppercase and underlined, not `Name:`.
      expect(text).toContain('CHATGPT'); // Platform-specific assistant name
    });

    it('separates messages with separators', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        showMetaInfo: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toMatch(/\n-{20,}/); // Has separator lines
    });

    it('includes conversation title', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        showMetaInfo: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('Test Conversation');
    });

    it('omits the metadata block when the metadata option is off', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        showMetaInfo: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).not.toContain('Platform:');
      expect(text).not.toContain('URL:');
    });

    it('includes the metadata block when the metadata option is on', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        showMetaInfo: true,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('Platform:');
      expect(text).toContain('URL:');
    });
  });

  describe('per-message timestamps', () => {
    it('renders a per-message timestamp when showMetaInfo is on', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        showMetaInfo: true,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('· 12:00');
      // The date belongs to the header (which showMetaInfo also turns on) and to
      // the day separator — never to a per-message stamp. Assert on the ROLE
      // LABEL line rather than the whole document, which now legitimately
      // contains a full "Exported: <date> <time>" too.
      const roleLines = text.split('\n').filter((l) => /^[A-Z]+ ·/.test(l));
      expect(roleLines.length).toBeGreaterThan(0);
      expect(roleLines.every((l) => !l.includes('2025-01-01'))).toBe(true);
    });

    it('omits the timestamp when showMetaInfo is off', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'txt',
        filename: 'test',
        showMetaInfo: false,
      });
      const text = await blobToText(result.blob!);
      // R-5's per-message stamp is '· HH:MM' on the role-label line — never
      // 'HH:MM:SS' — so a '12:00:00' assertion could never fail even with the
      // preference honoured. Scope to the role-label line the positive test
      // (above) actually asserts on, negated: no such line should exist at all.
      const roleLines = text.split('\n').filter((l) => /^[A-Z]+ ·/.test(l));
      expect(roleLines).toEqual([]);
    });

    it('emits no stray label or "undefined" when a message has no timestamp', async () => {
      const pair: QAPair = {
        id: 'pair-no-ts',
        index: 0,
        selected: true,
        question: {
          id: 'q-no-ts',
          role: 'user',
          content: 'question',
        },
        answer: {
          id: 'a-no-ts',
          role: 'assistant',
          content: 'answer',
        },
      } as unknown as QAPair;
      const result = await exporter.export(createTestConversation([pair]), [pair], {
        format: 'txt',
        filename: 'test',
        showMetaInfo: true,
      });
      const text = await blobToText(result.blob!);
      expect(text).not.toContain('undefined');
      // R-5's role label has no parens to leave empty ('USER · HH:MM'); the
      // timestamp-less failure mode is a stray middot with nothing after it.
      expect(text).not.toMatch(/^[A-Z]+\s*·\s*$/m);
    });
  });

  describe('link rendering', () => {
    function buildLinkPair(href: string, linkText: string): QAPair {
      return {
        id: 'pair-link',
        index: 0,
        selected: true,
        question: {
          id: 'q-link',
          role: 'user',
          content: 'question',
          timestamp: new Date('2025-01-01T12:00:00Z'),
        },
        answer: {
          id: 'a-link',
          role: 'assistant',
          content: 'fallback',
          htmlContent: `<p>See <a href="${href}">${linkText}</a> for details.</p>`,
          timestamp: new Date('2025-01-01T12:00:00Z'),
        },
      };
    }

    it('renders both the anchor text and its destination URL', async () => {
      const pair = buildLinkPair('https://example.com/source', 'the source');
      const conversation = createTestConversation([pair]);
      const result = await exporter.export(conversation, [pair], {
        format: 'txt',
        filename: 'test',
        showMetaInfo: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('the source');
      expect(text).toContain('https://example.com/source');
    });

    it('omits the redundant URL suffix when the link text is the URL itself', async () => {
      const pair = buildLinkPair('https://example.com/', 'https://example.com/');
      const conversation = createTestConversation([pair]);
      const result = await exporter.export(conversation, [pair], {
        format: 'txt',
        filename: 'test',
        showMetaInfo: false,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('https://example.com/');
      expect(text).not.toContain('https://example.com/ (https://example.com/)');
    });
  });

  describe('validateOptions()', () => {
    it('returns true for valid options', () => {
      const valid = exporter.validateOptions({
        format: 'txt',
        filename: 'test',
        showMetaInfo: true,
      });
      expect(valid).toBe(true);
    });

    it('returns false for wrong format', () => {
      const valid = exporter.validateOptions({
        format: 'pdf',
        filename: 'test',
        showMetaInfo: true,
      });
      expect(valid).toBe(false);
    });
  });
});

describe('R-5: the 72-column plain-text layout', () => {
  const richPair = (): QAPair =>
    ({
      id: 'p0',
      index: 0,
      selected: true,
      question: {
        id: 'q0',
        role: 'user',
        content: 'question',
        htmlContent:
          '<p>I am setting up a systematic investment research programme and want to validate the walk-forward design before widening the asset universe.</p>',
        timestamp: new Date('2025-01-01T12:04:37Z'),
      },
      answer: {
        id: 'a0',
        role: 'assistant',
        content: 'answer',
        htmlContent:
          '<h1>Walk-forward design</h1>' +
          '<p>With nine years of daily history the split that best balances bias and variance is five anchored folds, with the test window fixed at twelve months.</p>' +
          '<pre><code class="language-python">folds = anchored_walk_forward(prices, n_folds=5, test_months=12, embargo_months=6)</code></pre>' +
          '<table><thead><tr><th>Fold</th><th>Train</th></tr></thead><tbody><tr><td>1</td><td>2017-2019</td></tr></tbody></table>',
        timestamp: new Date('2025-01-01T12:05:02Z'),
      },
    }) as unknown as QAPair;

  async function render(showMetaInfo = true): Promise<string> {
    const pair = richPair();
    const conversation = {
      id: 'c1',
      title: 'Systematic investment research programme',
      platform: 'chatgpt',
      model: 'gpt-4o',
      url: 'https://chatgpt.com/c/test',
      createdAt: new Date('2025-01-01T15:12:00Z'),
      pairs: [pair],
    } as unknown as Conversation;
    const result = await new TextExporter().export(conversation, [pair], {
      format: 'txt',
      filename: 'test',
      showMetaInfo,
    } as never);
    return blobToText(result.blob!);
  }

  /**
   * Prose is wrapped at 72. Four things are deliberately exempt, because
   * wrapping them would damage them rather than tidy them:
   *
   *  - fenced code — wrapping a code line changes the code
   *  - table rows  — wrapping breaks the ASCII box
   *  - bare URLs   — a wrapped URL cannot be copied
   *  - raw markup  — artifact bodies (e.g. an SVG) are emitted verbatim, are
   *                  not fenced, and are outside R-5's scope
   *
   * The markup exemption is stated explicitly rather than left to the URL rule
   * to catch by coincidence, which is what happened first: the one over-long
   * line in a real fixture export is an `<svg xmlns="http://...">` tag that the
   * URL filter happened to skip.
   */
  function proseLines(text: string): string[] {
    const out: string[] = [];
    let inCode = false;
    for (const line of text.split('\n')) {
      if (line.startsWith('```')) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      if (/^[+|]/.test(line)) continue;
      if (/https?:\/\//.test(line)) continue;
      if (/^\s*<\/?[a-zA-Z]/.test(line)) continue;
      out.push(line);
    }
    return out;
  }

  it('wraps every prose line at 72 columns', async () => {
    const text = await render();
    const tooLong = proseLines(text).filter((l) => l.length > 72);
    expect(tooLong).toEqual([]);
  });

  it('never splits a word to make the wrap', async () => {
    const text = await render();
    // "systematic" appears in the question; it must survive intact.
    expect(text).toContain('systematic');
    expect(text).not.toMatch(/syste-?\n/);
  });

  it('renders the role label uppercase with the time, underlined to its width', async () => {
    const text = await render();
    const match = /^(USER · 12:04)\n(-+)$/m.exec(text);
    expect(match).not.toBeNull();
    expect(match![2]!.length).toBe(match![1]!.length);
  });

  it('indents the question by two spaces and leaves the answer flush', async () => {
    const text = await render();
    expect(text).toMatch(/^ {2}I am setting up a systematic/m);
    expect(text).toMatch(/^With nine years of daily history/m);
  });

  it('spans the separator rule across all 72 columns', async () => {
    const text = await render();
    expect(text).toContain('-'.repeat(72));
    // The old rule was exactly 40 wide. Check whole LINES, not substrings: a
    // 72-dash run trivially contains a 40-dash window.
    const dashRules = text.split('\n').filter((l) => /^-+$/.test(l));
    expect(dashRules.length).toBeGreaterThan(0);
    expect(dashRules.every((l) => l.length === 72 || l.length <= 20)).toBe(true);
  });

  it('fences code with its language and does not indent it', async () => {
    const text = await render();
    expect(text).toContain('```python');
    expect(text).toMatch(/^folds = anchored_walk_forward\(/m);
    expect(text).not.toContain('[python]');
  });

  it('boxes a table with = under the header row', async () => {
    const text = await render();
    expect(text).toMatch(/^\+[-+]+\+$/m);
    expect(text).toMatch(/^\+[=+]+\+$/m);
    expect(text).toMatch(/^\| Fold \|/m);
  });

  it('underlines a body heading with ~ at its exact width', async () => {
    const text = await render();
    const match = /^(Walk-forward design)\n(~+)$/m.exec(text);
    expect(match).not.toBeNull();
    expect(match![2]!.length).toBe(match![1]!.length);
  });
});
