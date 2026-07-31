/**
 * PDF Exporter Tests
 *
 * jsPDF does not run under jsdom (it draws to a canvas-like surface), so
 * instead of inspecting rendered bytes these tests mock the jsPDF module and
 * assert on the structured calls PdfExporter makes against it -- the
 * "structured input handed to jsPDF". Assertions are written against the
 * same shared contract the other formats are tested against (heading
 * levels, code-block handling, message ordering, metadata placement) so they
 * keep working if the visual styling changes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Conversation, QAPair } from '../../../../src/core/types';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { COLOR, hexToRgbTuple } from '../../../../src/core/exporters/style-tokens';
import { DEFAULT_PDF_OPTIONS } from '../../../../src/core/types';
import {
  sanitizeTextForPDF,
  UNSUPPORTED_SCRIPT_PLACEHOLDER,
} from '../../../../src/core/utils/pdf-characters';
import { WARNING_KEYS } from '../../../../src/shared/constants';

interface Call {
  method: string;
  args: unknown[];
}

const { instances, MockJsPDF } = vi.hoisted(() => {
  class MockJsPDF {
    calls: Call[] = [];
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };

    constructor(_options: unknown) {
      instances.push(this);
    }

    private record(method: string, args: unknown[]) {
      this.calls.push({ method, args });
    }

    setFontSize(...args: unknown[]) {
      this.record('setFontSize', args);
    }
    setFont(...args: unknown[]) {
      this.record('setFont', args);
    }
    setTextColor(...args: unknown[]) {
      this.record('setTextColor', args);
    }
    setDrawColor(...args: unknown[]) {
      this.record('setDrawColor', args);
    }
    setFillColor(...args: unknown[]) {
      this.record('setFillColor', args);
    }
    setLineWidth(...args: unknown[]) {
      this.record('setLineWidth', args);
    }
    text(...args: unknown[]) {
      this.record('text', args);
    }
    line(...args: unknown[]) {
      this.record('line', args);
    }
    rect(...args: unknown[]) {
      this.record('rect', args);
    }
    roundedRect(...args: unknown[]) {
      this.record('roundedRect', args);
    }
    addPage(...args: unknown[]) {
      this.record('addPage', args);
    }
    addImage(...args: unknown[]) {
      this.record('addImage', args);
    }
    setPage(...args: unknown[]) {
      this.record('setPage', args);
    }
    getNumberOfPages() {
      return 1;
    }
    // No wrapping -- keeps the exact strings PdfExporter asked to render
    // visible to the assertions below instead of split into fragments.
    splitTextToSize(text: string) {
      return [text];
    }
    addFileToVFS(...args: unknown[]) {
      this.record('addFileToVFS', args);
    }
    addFont(...args: unknown[]) {
      this.record('addFont', args);
    }
    getTextWidth(text: string) {
      // Enough for layout maths; real jsPDF measures the font.
      return text.length * 2;
    }
    output(type: string) {
      this.record('output', [type]);
      return new Blob(['%PDF-mock'], { type: 'application/pdf' });
    }
  }

  const instances: InstanceType<typeof MockJsPDF>[] = [];
  return { instances, MockJsPDF };
});

// vi.mock is hoisted above imports, so the dynamic `import('jspdf')` inside
// pdf-exporter.ts resolves to this mock.
vi.mock('jspdf', () => ({ jsPDF: MockJsPDF }));

// jsdom never fires load/error on <img>, so the real loader hangs. An empty
// cache is exactly the "every image failed to load" state under test.
vi.mock('../../../../src/core/utils/image-loader', () => ({
  loadImagesParallel: async () => new Map(),
}));

function buildConversation(): { conversation: Conversation; pairs: QAPair[] } {
  const pair: QAPair = {
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
      content: 'Section Heading Some text function foo() {}',
      htmlContent:
        '<h2>Section Heading</h2><p>Some text</p><pre><code class="language-js">function foo() {}</code></pre>',
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
  };

  const conversation: Conversation = {
    id: 'test-conversation',
    title: 'PDF Structure Test',
    platform: 'claude',
    model: 'claude-3',
    pairs: [pair],
    url: 'https://claude.ai/chat/pdf-structure-test',
    createdAt: new Date('2025-01-01T12:00:00Z'),
  };

  return { conversation, pairs: [pair] };
}

function textCallsOf(instance: InstanceType<typeof MockJsPDF>): string[] {
  return instance.calls
    .filter((c) => c.method === 'text')
    .map((c) => c.args[0])
    .filter((t): t is string => typeof t === 'string');
}

/** The setFontSize value in effect when a given text string was rendered. */
function fontSizeBeforeText(
  instance: InstanceType<typeof MockJsPDF>,
  text: string
): number | undefined {
  const idx = instance.calls.findIndex((c) => c.method === 'text' && c.args[0] === text);
  if (idx === -1) return undefined;
  for (let i = idx - 1; i >= 0; i--) {
    const call = instance.calls[i]!;
    if (call.method === 'setFontSize') return call.args[0] as number;
  }
  return undefined;
}

describe('PdfExporter', () => {
  beforeEach(() => {
    instances.length = 0;
  });

  it('produces a non-empty blob and constructs jsPDF once', async () => {
    const { conversation, pairs } = buildConversation();
    const result = await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: true,
    });

    expect(result.success).toBe(true);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(instances).toHaveLength(1);
  });

  it('feeds the title, metadata, and Q&A text to jsPDF in document order', async () => {
    const { conversation, pairs } = buildConversation();
    await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: true,
    });

    const instance = instances[0]!;
    const rendered = textCallsOf(instance);
    const idx = (s: string) => rendered.findIndex((t) => t.includes(s));

    expect(rendered[0]).toBe('PDF Structure Test'); // title always renders first
    expect(idx(conversation.url)).toBeGreaterThan(-1); // metadata rendered
    expect(idx(conversation.url)).toBeLessThan(idx('plain question')); // metadata before body
    expect(idx('plain question')).toBeLessThan(idx('Section Heading')); // question before answer
    expect(idx('Section Heading')).toBeLessThan(idx('Some text')); // heading before paragraph
    expect(idx('Some text')).toBeLessThan(idx('function foo() {}')); // paragraph before code
  });

  it('renders the heading in a distinct (larger) font size than body text', async () => {
    const { conversation, pairs } = buildConversation();
    await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: false,
    });

    const instance = instances[0]!;
    const headingSize = fontSizeBeforeText(instance, 'Section Heading');
    const paragraphSize = fontSizeBeforeText(instance, 'Some text');
    expect(headingSize).toBeGreaterThan(paragraphSize!);
  });

  it('renders both the anchor text and its destination URL for a link', async () => {
    const pair: QAPair = {
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
        htmlContent: '<p>See <a href="https://example.com/source">the source</a> for details.</p>',
        timestamp: new Date('2025-01-01T12:00:00Z'),
      },
    };
    const conversation: Conversation = {
      id: 'test-conversation-link',
      title: 'Link Test',
      platform: 'claude',
      model: 'claude-3',
      pairs: [pair],
      url: 'https://claude.ai/chat/link-test',
      createdAt: new Date('2025-01-01T12:00:00Z'),
    };

    await new PdfExporter().export(conversation, [pair], {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: false,
    });

    const instance = instances[0]!;
    const combined = textCallsOf(instance).join(' ');
    expect(combined).toContain('the source');
    expect(combined).toContain('https://example.com/source');
  });

  it('omits the redundant URL suffix when the link text is the URL itself', async () => {
    const pair: QAPair = {
      id: 'pair-link-identical',
      index: 0,
      selected: true,
      question: {
        id: 'q-link-identical',
        role: 'user',
        content: 'question',
        timestamp: new Date('2025-01-01T12:00:00Z'),
      },
      answer: {
        id: 'a-link-identical',
        role: 'assistant',
        content: 'fallback',
        htmlContent:
          '<p>See <a href="https://example.com/">https://example.com/</a> for details.</p>',
        timestamp: new Date('2025-01-01T12:00:00Z'),
      },
    };
    const conversation: Conversation = {
      id: 'test-conversation-link-identical',
      title: 'Link Test Identical',
      platform: 'claude',
      model: 'claude-3',
      pairs: [pair],
      url: 'https://claude.ai/chat/link-test-identical',
      createdAt: new Date('2025-01-01T12:00:00Z'),
    };

    await new PdfExporter().export(conversation, [pair], {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: false,
    });

    const instance = instances[0]!;
    const combined = textCallsOf(instance).join(' ');
    expect(combined).toContain('https://example.com/');
    expect(combined).not.toContain('https://example.com/ (https://example.com/)');
  });

  it('keeps the URL in the placeholder when an image fails to load and has alt text', async () => {
    const pair: QAPair = {
      id: 'pair-img',
      index: 0,
      selected: true,
      question: {
        id: 'q-img',
        role: 'user',
        content: 'question',
        timestamp: new Date('2025-01-01T12:00:00Z'),
      },
      answer: {
        id: 'a-img',
        role: 'assistant',
        content: 'fallback',
        htmlContent: '<p><img src="https://example.com/pic.png" alt="A diagram"></p>',
        timestamp: new Date('2025-01-01T12:00:00Z'),
      },
    };
    const conversation: Conversation = {
      id: 'test-conversation-img',
      title: 'Image Test',
      platform: 'claude',
      model: 'claude-3',
      pairs: [pair],
      url: 'https://claude.ai/chat/image-test',
      createdAt: new Date('2025-01-01T12:00:00Z'),
    };

    await new PdfExporter().export(conversation, [pair], {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: false,
    });

    const combined = textCallsOf(instances[0]!).join(' ');
    expect(combined).toContain('[Image: A diagram]');
    expect(combined).toContain('https://example.com/pic.png');
  });

  it('switches to a monospace font for the code block', async () => {
    const { conversation, pairs } = buildConversation();
    await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: false,
    });

    const instance = instances[0]!;
    const idx = instance.calls.findIndex(
      (c) => c.method === 'text' && c.args[0] === 'function foo() {}'
    );
    expect(idx).toBeGreaterThan(-1);
    const fontCallBefore = [...instance.calls.slice(0, idx)]
      .reverse()
      .find((c) => c.method === 'setFont');
    // R-2b: IBM Plex Mono, embedded. It was jsPDF's built-in courier, one of the
    // standard 14 and WinAnsi-only.
    expect(fontCallBefore?.args[0]).toBe('IBMPlexMono');
  });

  describe('per-message timestamps', () => {
    it('renders a per-message timestamp when showMetaInfo is on', async () => {
      const { conversation, pairs } = buildConversation();
      await new PdfExporter().export(conversation, pairs, {
        format: 'pdf',
        filename: 'test',
        showMetaInfo: true,
      });

      const rendered = textCallsOf(instances[0]!);
      expect(rendered.some((t) => t.includes('(12:00:00)'))).toBe(true);
      // The date belongs to the header (which showMetaInfo also turns on) and to
      // the day separator — never to a per-message stamp. Assert on the ROLE
      // LABEL line rather than the whole document, which now legitimately
      // contains a full "Exported: <date> <time>" too.
      const roleLines = rendered.filter((t) => /^\w+.*\(\d{2}:\d{2}:\d{2}\)/.test(t));
      expect(roleLines.length).toBeGreaterThan(0);
      expect(roleLines.every((t) => !t.includes('2025-01-01'))).toBe(true);
    });

    it('omits the timestamp when showMetaInfo is off', async () => {
      const { conversation, pairs } = buildConversation();
      await new PdfExporter().export(conversation, pairs, {
        format: 'pdf',
        filename: 'test',
        showMetaInfo: false,
      });

      const rendered = textCallsOf(instances[0]!);
      expect(rendered.some((t) => t.includes('12:00:00'))).toBe(false);
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
      const conversation: Conversation = {
        id: 'test-conversation-no-ts',
        title: 'No Timestamp Test',
        platform: 'claude',
        model: 'claude-3',
        pairs: [pair],
        url: 'https://claude.ai/chat/no-timestamp-test',
        createdAt: new Date('2025-01-01T12:00:00Z'),
      };

      await new PdfExporter().export(conversation, [pair], {
        format: 'pdf',
        filename: 'test',
        showMetaInfo: true,
      });

      const rendered = textCallsOf(instances[0]!);
      expect(rendered.some((t) => t.includes('undefined'))).toBe(false);
      expect(rendered.some((t) => /\(\s*\)/.test(t))).toBe(false);
    });
  });
});

describe('R-2: page chrome and the R2 role label', () => {
  async function render() {
    instances.length = 0;
    const { conversation, pairs } = buildConversation();
    await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: true,
    } as never);
    return instances[0]!;
  }

  it('uses the design margins, not a uniform 20mm box', () => {
    // 20 top / 18 sides / 16 bottom, per the 1a direction.
    expect(DEFAULT_PDF_OPTIONS.margins).toEqual({ top: 20, right: 18, bottom: 16, left: 18 });
  });

  it('rules the role label in the platform colour (R2)', async () => {
    const instance = await render();
    const calls = instance.calls;
    // The assistant's name comes from i18n, absent in this harness, so match the
    // label's shape rather than the resolved word.
    // showMetaInfo turns times on too, so the label may carry a "(HH:MM:SS)".
    const labelIndex = calls.findIndex(
      (c) => c.method === 'text' && /^[A-Za-z]+( \(\d{2}:\d{2}:\d{2}\))?:$/.test(String(c.args[0]))
    );
    expect(labelIndex).toBeGreaterThan(-1);

    // A brand-coloured rule is drawn for the label — the one place the
    // platform's colour appears in the body.
    const drawColors = calls
      .filter((c) => c.method === 'setDrawColor')
      .map((c) => c.args.join(','));
    // buildConversation() is a Claude conversation.
    expect(drawColors).toContain(hexToRgbTuple(COLOR.brand.claude).join(','));
    expect(calls.some((c) => c.method === 'line')).toBe(true);
  });

  it('prints the exporter attribution in the footer alongside the page number', async () => {
    const instance = await render();
    const texts = instance.calls.filter((c) => c.method === 'text').map((c) => String(c.args[0]));
    expect(texts.some((t) => t.includes('AI Chat Exporter'))).toBe(true);
  });
});

describe('R-2b: embedded fonts and what they mean for transliteration', () => {
  it('registers all four faces before anything is drawn', async () => {
    instances.length = 0;
    const { conversation, pairs } = buildConversation();
    await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      includeMetadata: true,
      includeTimestamps: false,
    } as never);
    const instance = instances[0]!;

    // Keyed on family/style, not just family: three of the four faces share
    // the family 'SourceSans3' (regular/bold/italic) and only `style`
    // distinguishes them. `arrayContaining` against a family-only array would
    // pass with just 2 of the 4 faces registered, since ArrayContaining's
    // `every`/`some` check ignores duplicate expected entries — a sorted
    // `toEqual` catches a missing, duplicated, or extra face.
    const added = instance.calls
      .filter((c) => c.method === 'addFont')
      .map((c) => `${String(c.args[1])}/${String(c.args[2])}`);
    expect(added.sort()).toEqual([
      'IBMPlexMono/normal',
      'SourceSans3/bold',
      'SourceSans3/italic',
      'SourceSans3/normal',
    ]);

    // Registration must precede every setFont, or jsPDF falls back silently.
    const firstSetFont = instance.calls.findIndex((c) => c.method === 'setFont');
    const lastAddFont = instance.calls.map((c) => c.method).lastIndexOf('addFont');
    expect(lastAddFont).toBeLessThan(firstSetFont);
  });

  it('stops transliterating characters the embedded fonts render', () => {
    // These were mangled because jsPDF's built-ins are WinAnsi-only. The
    // embedded faces have them, so the replacement is now a downgrade.
    expect(sanitizeTextForPDF('a — b')).toBe('a — b');
    expect(sanitizeTextForPDF('−5')).toBe('−5');
    expect(sanitizeTextForPDF('a – b')).toBe('a – b');
    expect(sanitizeTextForPDF('€10')).toBe('€10');
  });

  it('still transliterates what the latin subset genuinely lacks', () => {
    // The fonts ship a latin subset, not all of Unicode — coverage is read from
    // their own cmap, so these are still replaced rather than dropped.
    expect(sanitizeTextForPDF('√2')).not.toContain('√');
    expect(sanitizeTextForPDF('₹5')).not.toContain('₹');
  });
});

describe('R-2b: the question turn fill', () => {
  it('fills the question box before drawing its label, and only once', async () => {
    instances.length = 0;
    const { conversation, pairs } = buildConversation();
    await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: false,
    });

    const instance = instances[0]!;
    const calls = instance.calls;

    const fillIdx = calls.findIndex(
      (c) =>
        c.method === 'setFillColor' &&
        c.args.join(',') === hexToRgbTuple(COLOR.surfaceTurn).join(',')
    );
    expect(fillIdx).toBeGreaterThan(-1);

    const rectIdx = calls.findIndex((c) => c.method === 'rect');
    expect(rectIdx).toBeGreaterThan(fillIdx);

    // The question's role label text must be drawn AFTER the fill rect --
    // jsPDF has no z-order, so a rect drawn later would cover it.
    const questionLabelIdx = calls.findIndex(
      (c) => c.method === 'text' && /^[A-Za-z]+:$/.test(String(c.args[0]))
    );
    expect(questionLabelIdx).toBeGreaterThan(rectIdx);

    // The dry-run measurement pass stubs `rect`/`text`, so it draws nothing;
    // only the real pass should produce a rect.
    expect(calls.filter((c) => c.method === 'rect')).toHaveLength(1);
  });

  it('does not fill the answer', async () => {
    instances.length = 0;
    const { conversation, pairs } = buildConversation();
    await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: false,
    });

    const calls = instances[0]!.calls;
    // Exactly one rect (the question's) — none for the answer.
    expect(calls.filter((c) => c.method === 'rect')).toHaveLength(1);
  });
});

describe('R-2b: tables — horizontal rules and numeric right-alignment', () => {
  async function renderTable() {
    const pair: QAPair = {
      id: 'pair-table',
      index: 0,
      selected: true,
      question: {
        id: 'q-table',
        role: 'user',
        content: 'question',
        timestamp: new Date('2025-01-01T12:00:00Z'),
      },
      answer: {
        id: 'a-table',
        role: 'assistant',
        content: 'fallback',
        htmlContent:
          '<table><thead><tr><th>Name</th><th>Count</th></tr></thead>' +
          '<tbody><tr><td>Alpha</td><td>10</td></tr><tr><td>Beta</td><td>200</td></tr></tbody></table>',
        timestamp: new Date('2025-01-01T12:00:00Z'),
      },
    };
    const conversation: Conversation = {
      id: 'test-conversation-table',
      title: 'Table Test',
      platform: 'claude',
      model: 'claude-3',
      pairs: [pair],
      url: 'https://claude.ai/chat/table-test',
      createdAt: new Date('2025-01-01T12:00:00Z'),
    };

    instances.length = 0;
    await new PdfExporter().export(conversation, [pair], {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: false,
    });
    return instances[0]!;
  }

  it('draws no full grid and no fill for the table — lines only', async () => {
    const instance = await renderTable();
    // Only the question's turn-fill rect — no header/row background fill.
    expect(instance.calls.filter((c) => c.method === 'rect')).toHaveLength(1);
  });

  it('right-aligns the numeric column and left-aligns the text column', async () => {
    const instance = await renderTable();
    const numericCell = instance.calls.find((c) => c.method === 'text' && c.args[0] === '10');
    const textCell = instance.calls.find((c) => c.method === 'text' && c.args[0] === 'Alpha');

    expect((numericCell?.args[3] as { align?: string } | undefined)?.align).toBe('right');
    expect((textCell?.args[3] as { align?: string } | undefined)?.align).toBeUndefined();
  });
});

describe('R-2b: the code-language tab', () => {
  it('renders the language as a chip above the code block, not inline', async () => {
    instances.length = 0;
    const { conversation, pairs } = buildConversation();
    await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: false,
    });

    const calls = instances[0]!.calls;
    // Two roundedRects for a code block with a language: the tab chip, then
    // the code block's own background.
    const roundedRects = calls.filter((c) => c.method === 'roundedRect');
    expect(roundedRects).toHaveLength(2);

    const tabTextIdx = calls.findIndex((c) => c.method === 'text' && c.args[0] === 'JS');
    expect(tabTextIdx).toBeGreaterThan(-1);

    // The tab chip is drawn (setFillColor + roundedRect) BEFORE its label text.
    const chipRectIdx = calls.indexOf(roundedRects[0]!);
    expect(chipRectIdx).toBeLessThan(tabTextIdx);

    // The code itself is drawn after the tab, in the monospace font.
    const codeTextIdx = calls.findIndex(
      (c) => c.method === 'text' && c.args[0] === 'function foo() {}'
    );
    expect(codeTextIdx).toBeGreaterThan(tabTextIdx);
  });
});

describe('EXP-2: unsupported-script placeholder and warning', () => {
  it('warns when the export contains a script the embedded fonts cannot render', async () => {
    instances.length = 0;
    const { conversation, pairs } = buildConversation();
    conversation.title = '你好世界'; // CJK: not in EMBEDDED_FONT_COVERAGE
    const result = await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: false,
    });

    expect(result.success).toBe(true);
    expect(result.warning).toBe(WARNING_KEYS.PDF_UNSUPPORTED_SCRIPT);

    const rendered = textCallsOf(instances[0]!);
    expect(rendered.some((t) => t.includes('你'))).toBe(false);
    expect(rendered[0]).toBe(UNSUPPORTED_SCRIPT_PLACEHOLDER.repeat(4));
  });

  it('does not warn for a pure-Latin export (no regression)', async () => {
    instances.length = 0;
    const { conversation, pairs } = buildConversation();
    const result = await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: true,
    });

    expect(result.success).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it('sanitizes the model and url metadata lines, not just the message body', async () => {
    // pdf-exporter.ts used to interpolate platform/model/exported/url straight
    // into doc.text() without ever calling sanitizeTextForPDF -- unprotected
    // even for characters the replacement table already knows how to handle.
    instances.length = 0;
    const { conversation, pairs } = buildConversation();
    conversation.model = 'Клод-3'; // Cyrillic
    conversation.url = 'https://example.com/чат';
    const result = await new PdfExporter().export(conversation, pairs, {
      format: 'pdf',
      filename: 'test',
      showMetaInfo: true,
    });

    expect(result.warning).toBe(WARNING_KEYS.PDF_UNSUPPORTED_SCRIPT);
    const rendered = textCallsOf(instances[0]!);
    expect(rendered.some((t) => t.includes('Клод') || t.includes('чат'))).toBe(false);
    expect(rendered.some((t) => t.includes(UNSUPPORTED_SCRIPT_PLACEHOLDER))).toBe(true);
  });
});
