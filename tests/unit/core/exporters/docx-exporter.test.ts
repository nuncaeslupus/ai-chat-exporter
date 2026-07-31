/**
 * DOCX Exporter Tests
 */

import { describe, it, expect } from 'vitest';
import type {
  Conversation,
  DOCXExportOptions,
  ExportOptions,
  QAPair,
} from '../../../../src/core/types';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { COLOR, hexToDocxColor } from '../../../../src/core/exporters/style-tokens';
import { docxRunText, extractDocxEntry } from '../../../utils/docx-helpers';

/**
 * A pair whose answer carries a heading and a code block via htmlContent, so
 * ConversationStructureService parses real 'heading' and 'code' blocks
 * instead of a single flattened paragraph.
 */
function buildStructuredPair(): QAPair {
  return {
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
  } as unknown as QAPair;
}

function buildStructuredConversation(pair: QAPair): Conversation {
  return {
    id: 'test-conversation',
    title: 'DOCX Structure Test',
    platform: 'claude',
    model: 'claude-3',
    pairs: [pair],
    url: 'https://claude.ai/chat/docx-structure-test',
    createdAt: new Date('2025-01-01T12:00:00Z'),
  } as unknown as Conversation;
}

describe('DocxExporter', () => {
  describe('export() code blocks', () => {
    it('preserves line breaks in DOCX code blocks', async () => {
      const code = 'function foo() {\n  return 1;\n}\n// done';
      const newlineCount = (code.match(/\n/g) ?? []).length;

      const pair: QAPair = {
        id: 'pair-0',
        index: 0,
        question: {
          id: 'q-0',
          role: 'user',
          content: 'show me some code',
          timestamp: new Date('2025-01-01T12:00:00Z'),
        },
        answer: {
          id: 'a-0',
          role: 'assistant',
          content: code,
          htmlContent: `<pre><code class="language-js">${code}</code></pre>`,
          timestamp: new Date('2025-01-01T12:00:00Z'),
        },
        selected: true,
      };

      const conversation: Conversation = {
        id: 'test-conversation',
        title: 'Test Conversation',
        platform: 'chatgpt',
        model: 'gpt-4',
        pairs: [pair],
        url: 'https://chatgpt.com/c/test',
        createdAt: new Date('2025-01-01T12:00:00Z'),
      };

      const exporter = new DocxExporter();
      const result = await exporter.export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        showMetaInfo: false,
      });

      expect(result.success).toBe(true);
      const documentXml = await extractDocxEntry(result.blob!, 'word/document.xml');
      const breakCount = (documentXml.match(/<w:br\/>/g) ?? []).length;

      expect(breakCount).toBe(newlineCount);
    });
  });

  describe('export() structural contract', () => {
    it('produces a non-empty Blob', async () => {
      const pair = buildStructuredPair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        showMetaInfo: true,
      });

      expect(result.success).toBe(true);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob!.size).toBeGreaterThan(0);
    });

    it('maps a heading block to a Word heading style, distinct from body paragraphs', async () => {
      const pair = buildStructuredPair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        showMetaInfo: false,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');

      // The heading block must be styled as a Word heading (docx maps content
      // heading levels onto HeadingLevel.HEADING_3+), distinguishing it from
      // the plain-paragraph "Some text" that follows it.
      expect(xml).toContain('Section Heading');
      expect(xml).toMatch(/w:pStyle w:val="Heading\d+"/);
    });

    it('renders the code block in a monospace font distinct from body text', async () => {
      const pair = buildStructuredPair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        showMetaInfo: false,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');

      // R-8 splits code into one run per token, so join the runs before asserting
      // on what the reader sees.
      expect(docxRunText(xml)).toContain('function foo() { return 1; }');
      // R-3: Consolas, which ships with every Office install.
      expect(xml).toContain('Consolas');
    });

    it('keeps metadata, message order, heading, and code in document order', async () => {
      const pair = buildStructuredPair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        showMetaInfo: true,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');

      // Index into the RENDERED text, not the raw XML: R-8 splits code into one
      // run per token, so the code sample is no longer a contiguous substring of
      // the markup and `indexOf` on it returned -1.
      const text = docxRunText(xml);
      const idx = (s: string) => text.indexOf(s);
      expect(idx(conversation.url)).toBeGreaterThan(-1); // metadata rendered
      expect(idx(conversation.url)).toBeLessThan(idx('plain question')); // metadata before body
      expect(idx('plain question')).toBeLessThan(idx('Section Heading')); // question before answer
      expect(idx('Section Heading')).toBeLessThan(idx('Some text')); // heading before paragraph
      expect(idx('Some text')).toBeLessThan(idx('function foo() { return 1; }')); // paragraph before code
    });
  });

  describe('export() table headers', () => {
    function buildTablePair(): QAPair {
      return {
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
          content: 'Name Age Alice 30',
          htmlContent:
            '<table><thead><tr><th>Name</th><th>Age</th></tr></thead><tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>',
          timestamp: new Date('2025-01-01T12:00:00Z'),
        },
      } as unknown as QAPair;
    }

    it('renders header row runs bold and body row runs not bold', async () => {
      const pair = buildTablePair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        showMetaInfo: false,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');

      // Table rows are plain <w:tr> (no attributes); split them out so the
      // bold check is scoped to the header row vs. the body row.
      const rows = xml
        .split('<w:tr>')
        .slice(1)
        .map((r) => r.split('</w:tr>')[0]!);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain('Name');
      expect(rows[0]).toContain('<w:b/>');
      expect(rows[1]).toContain('Alice');
      expect(rows[1]).not.toContain('<w:b/>');
    });
  });

  describe('per-message timestamps', () => {
    it('renders a per-message timestamp when showMetaInfo is on', async () => {
      const pair = buildStructuredPair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        showMetaInfo: true,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
      expect(xml).toContain('(12:00:00)');
      // The day is announced once by a day separator, not repeated per message.
      // The date belongs to the header (which showMetaInfo also turns on) and to
      // the day separator — never to a per-message stamp.
      // docxRunText joins the runs; the role label's own run must carry only a time.
      // A per-message stamp is a run containing ONLY a time. The metadata block's
      // "Exported: <date> <time>" run is a different thing and legitimately has
      // the date, so match the whole run rather than searching inside it.
      const stampRuns = [...xml.matchAll(/<w:t[^>]*>\s*\(?\d{2}:\d{2}:\d{2}\)?\s*<\/w:t>/g)];
      expect(stampRuns.length).toBeGreaterThan(0);
    });

    it('omits the timestamp when showMetaInfo is off', async () => {
      const pair = buildStructuredPair();
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        showMetaInfo: false,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
      expect(xml).not.toContain('12:00:00');
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
      const conversation = buildStructuredConversation(pair);

      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        showMetaInfo: true,
      });
      const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
      expect(xml).not.toContain('undefined');
      expect(xml).not.toMatch(/\(\s*\)/);
    });
  });

  describe('export() platform brand colour', () => {
    async function roleHeadingXml(platform: string): Promise<string> {
      const pair = buildStructuredPair();
      // `platform` is deliberately widened to string: one case exercises an
      // id outside the Platform union (the clean-fallback path).
      const conversation = {
        ...buildStructuredConversation(pair),
        platform,
      } as unknown as Conversation;
      const result = await new DocxExporter().export(conversation, [pair], {
        format: 'docx',
        filename: 'test',
        showMetaInfo: false,
      });
      return extractDocxEntry(result.blob!, 'word/document.xml');
    }

    it.each([
      ['chatgpt', COLOR.brandTextOnLight.chatgpt],
      ['claude', COLOR.brandTextOnLight.claude],
      ['gemini', COLOR.brandTextOnLight.gemini],
    ])('colours the %s assistant role label with its brand colour', async (platform, hex) => {
      const xml = await roleHeadingXml(platform);
      expect(xml).toContain(`<w:color w:val="${hexToDocxColor(hex)}"/>`);
    });

    it('falls back to the neutral default for an unknown platform', async () => {
      const xml = await roleHeadingXml('some-new-bot');
      expect(xml).toContain(`<w:color w:val="${hexToDocxColor(COLOR.brandTextOnLight.default)}"/>`);
      // no empty / undefined colour attribute anywhere
      expect(xml).not.toMatch(/<w:color w:val="(?:|undefined)"\s*\/>/);
    });

    it('gives each platform a distinct role-label colour', async () => {
      const hexes = [
        COLOR.brandTextOnLight.chatgpt,
        COLOR.brandTextOnLight.claude,
        COLOR.brandTextOnLight.gemini,
        COLOR.brandTextOnLight.default,
      ];
      expect(new Set(hexes).size).toBe(hexes.length);
    });
  });
});

describe('R-3: DOCX renders the same in anyone Word', () => {
  function pairWithCode(): QAPair {
    return {
      id: 'p0',
      index: 0,
      selected: true,
      question: { id: 'q0', role: 'user', content: 'asked' },
      answer: {
        id: 'a0',
        role: 'assistant',
        content: 'answered',
        htmlContent:
          '<h1>Design</h1><p>answered</p><pre><code class="language-python">x = 1</code></pre>',
      },
    } as unknown as QAPair;
  }

  async function renderXml(
    docxOptions?: Partial<DOCXExportOptions>,
    entry = 'word/document.xml'
  ): Promise<string> {
    const pair = pairWithCode();
    const conversation = {
      id: 'c1',
      title: 'Systematic research',
      platform: 'chatgpt',
      url: 'https://chatgpt.com/c/test',
      createdAt: new Date('2026-07-30T12:00:00Z'),
      pairs: [pair],
    } as unknown as Conversation;
    const result = await new DocxExporter().export(conversation, [pair], {
      format: 'docx',
      filename: 'test',
      showMetaInfo: true,
      ...(docxOptions && { docxOptions: { useHeadings: true, ...docxOptions } }),
    } as unknown as ExportOptions);
    return extractDocxEntry(result.blob!, entry);
  }

  // Word page sizes in twips: 1in = 1440 twips.
  const A4 = { w: 11906, h: 16838 };
  const LETTER = { w: 12240, h: 15840 };
  const LEGAL = { w: 12240, h: 20160 };

  it('declares A4 by default instead of taking the library default', async () => {
    const xml = await renderXml();
    expect(xml).toMatch(new RegExp(`w:w="${String(A4.w)}"`));
    expect(xml).toMatch(new RegExp(`w:h="${String(A4.h)}"`));
  });

  it('honours letter', async () => {
    const xml = await renderXml({ pageSize: 'letter' });
    expect(xml).toMatch(new RegExp(`w:w="${String(LETTER.w)}"`));
    expect(xml).toMatch(new RegExp(`w:h="${String(LETTER.h)}"`));
  });

  it('honours legal, the third size the option admits', async () => {
    const xml = await renderXml({ pageSize: 'legal' });
    expect(xml).toMatch(new RegExp(`w:w="${String(LEGAL.w)}"`));
    expect(xml).toMatch(new RegExp(`w:h="${String(LEGAL.h)}"`));
  });

  it('sets the same margins the PDF uses, in twips', async () => {
    const xml = await renderXml();
    // 20mm top, 18mm sides, 16mm bottom.
    expect(xml).toContain('w:top="1134"');
    expect(xml).toContain('w:bottom="907"');
  });

  it('uses Calibri and Consolas, which exist in every Office install', async () => {
    // The body font is a document default, so it lives in styles.xml; the code
    // font is set per run and appears in document.xml.
    const styles = await renderXml(undefined, 'word/styles.xml');
    const body = await renderXml();
    expect(styles).toContain('Calibri');
    expect(body).toContain('Consolas');
    expect(body).not.toContain('Courier New');
    expect(styles).not.toContain('Arial');
  });

  it('emits the page number as a real Word field, not literal text', async () => {
    const footer = await renderXml(undefined, 'word/footer1.xml');
    // A field, so it renumbers when the document reflows.
    expect(footer).toContain('PAGE');
    expect(footer).toMatch(/<w:fldChar w:fldCharType="begin"\/>/);
  });

  it('declares heading formatting rather than inheriting the reader Word theme', async () => {
    const styles = await renderXml(undefined, 'word/styles.xml');
    // Size, font and colour all stated, so the document cannot change shape
    // between two machines with different Normal styles.
    expect(styles).toContain('Calibri');
    expect(styles).toMatch(/w:styleId="Heading1"/);
  });
});

describe('EXP-1: XML-1.0-illegal control characters are sanitized', () => {
  /**
   * Proves well-formedness, not mere character absence: a real XML parser
   * (jsdom's DOMParser, available under the `environment: 'jsdom'` test
   * setup) reports a `parsererror` node when it can't parse the document —
   * exactly the failure Word/LibreOffice hit on an unescaped control char.
   */
  function assertWellFormedXml(xml: string): void {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const errors = doc.getElementsByTagName('parsererror');
    expect(errors.length, `document.xml is not well-formed XML:\n${xml.slice(0, 500)}`).toBe(0);
  }

  function pairWithPlainContent(content: string): QAPair {
    return {
      id: 'p0',
      index: 0,
      selected: true,
      question: { id: 'q0', role: 'user', content: 'asked' },
      answer: { id: 'a0', role: 'assistant', content },
    } as unknown as QAPair;
  }

  async function exportPair(pair: QAPair, title = 'Title'): Promise<string> {
    const conversation: Conversation = {
      id: 'c1',
      title,
      platform: 'chatgpt',
      url: 'https://chatgpt.com/c/test',
      createdAt: new Date('2026-07-30T12:00:00Z'),
      pairs: [pair],
    } as unknown as Conversation;
    const result = await new DocxExporter().export(conversation, [pair], {
      format: 'docx',
      filename: 'test',
      showMetaInfo: false,
    });
    expect(result.success).toBe(true);
    return extractDocxEntry(result.blob!, 'word/document.xml');
  }

  // U+0000 never reaches `renderInline` through htmlContent: the HTML parser
  // (jsdom, same one `HtmlContentParser` uses) already drops raw NUL bytes
  // during tokenization. Plain `content` (no htmlContent) skips HTML parsing
  // entirely and lands in `renderInline` untouched — the path that exercises
  // the fix at `docx-exporter.ts`'s `renderInline` (the site the review named).
  it('produces well-formed XML for a message containing U+0000 (NUL)', async () => {
    const xml = await exportPair(pairWithPlainContent('before\x00after'));
    assertWellFormedXml(xml);
    expect(docxRunText(xml)).not.toContain('\x00');
    expect(docxRunText(xml)).toContain('before�after');
  });

  it('produces well-formed XML for a message containing U+001B (ESC)', async () => {
    // The reproduction from the review: ANSI-coloured terminal output pasted
    // into a chat, exported as plain (non-code) text.
    const xml = await exportPair(pairWithPlainContent('\x1b[31mERROR\x1b[0m exit 1'));
    assertWellFormedXml(xml);
    expect(docxRunText(xml)).not.toContain('\x1b');
  });

  it('produces well-formed XML for a message containing U+000C (form feed)', async () => {
    const xml = await exportPair(pairWithPlainContent('page one\x0cpage two'));
    assertWellFormedXml(xml);
    expect(docxRunText(xml)).not.toContain('\x0c');
    expect(docxRunText(xml)).toContain('page one�page two');
  });

  it('produces well-formed XML for a conversation title containing U+FFFE', async () => {
    const xml = await exportPair(pairWithPlainContent('plain'), 'Chat ￾ Title');
    assertWellFormedXml(xml);
    expect(docxRunText(xml)).not.toContain('￾');
    expect(docxRunText(xml)).toContain('Chat � Title');
  });

  it('sanitizes control characters inside a code block while keeping it well-formed', async () => {
    // ESC and form feed survive jsdom's HTML tokenization (unlike NUL), so a
    // code block is a real end-to-end path for the review's reproduction:
    // pasting ANSI-coloured terminal output as a fenced code block.
    const code = 'line one\x1b[31mERROR\x1b[0m\nline\x0ctwo';
    const pair: QAPair = {
      id: 'p0',
      index: 0,
      selected: true,
      question: { id: 'q0', role: 'user', content: 'asked' },
      answer: {
        id: 'a0',
        role: 'assistant',
        content: 'answered',
        htmlContent: `<pre><code class="language-bash">${code}</code></pre>`,
      },
    } as unknown as QAPair;

    const xml = await exportPair(pair);
    assertWellFormedXml(xml);
    const text = docxRunText(xml);
    expect(text).not.toContain('\x1b');
    expect(text).not.toContain('\x0c');
    expect(text).toContain('�');
  });

  it('keeps tab and newline intact inside a code block (both are legal XML 1.0 chars)', async () => {
    const code = 'function foo() {\n\treturn 1;\n}';
    const pair: QAPair = {
      id: 'p0',
      index: 0,
      selected: true,
      question: { id: 'q0', role: 'user', content: 'asked' },
      answer: {
        id: 'a0',
        role: 'assistant',
        content: 'answered',
        htmlContent: `<pre><code class="language-js">${code}</code></pre>`,
      },
    } as unknown as QAPair;

    const xml = await exportPair(pair);
    assertWellFormedXml(xml);
    // Newlines become explicit <w:br/> breaks rather than literal '\n' runs
    // (R-8); the tab is real content within a line and must survive as a
    // literal tab character in the run text.
    expect(xml).toContain('<w:br/>');
    expect(docxRunText(xml)).toContain('\treturn 1;');
  });
});
