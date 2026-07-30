/**
 * lo-3900 (R9): two cross-format guarantees from docs/design/popup-redesign.md,
 * implementation notes 5 and 6.
 *
 * 1. Header — with `includeMetadata` on, every format carries platform, model,
 *    conversation date range, export date and URL. The date range is the new
 *    field; the other four already reached all six formats.
 * 2. Day separator — with `includeTimestamps` on, a day change emits
 *    `— <date> —` once, at the boundary; the per-message stamp keeps only the
 *    time. A single-day conversation emits no separator at all.
 *
 * Drives all six registered formats end-to-end.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { JsonExporter } from '../../../../src/core/exporters/json-exporter';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import { blobToText } from '../../../utils/exporter-helpers';
import { extractDocxEntry } from '../../../utils/docx-helpers';

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
    splitTextToSize(text: string) {
      return [text];
    }
    output(type: string) {
      this.record('output', [type]);
      return new Blob(['%PDF-mock'], { type: 'application/pdf' });
    }
  }

  const instances: InstanceType<typeof MockJsPDF>[] = [];
  return { instances, MockJsPDF };
});

vi.mock('jspdf', () => ({ jsPDF: MockJsPDF }));

// getUILanguage() falls back to 'en' with no chrome.i18n in the test env.
const DAY_1 = 'Jan 1, 2025';
const DAY_2 = 'Jan 2, 2025';
const SEP_1 = `— ${DAY_1} —`;
const SEP_2 = `— ${DAY_2} —`;
// pdf sanitizes em dashes to '--' (WinAnsi, see src/core/utils/pdf-characters.ts).
const PDF_SEP_1 = `-- ${DAY_1} --`;
const PDF_SEP_2 = `-- ${DAY_2} --`;

function pair(index: number, day: 1 | 2, answerDay: 1 | 2 = day): QAPair {
  return {
    id: `p${index}`,
    index,
    selected: true,
    question: {
      id: `q${index}`,
      role: 'user',
      content: `Question ${index}`,
      timestamp: new Date(`2025-01-0${day}T09:15:00Z`),
    },
    answer: {
      id: `a${index}`,
      role: 'assistant',
      content: `Answer ${index}`,
      htmlContent: `<p>Answer ${index}</p>`,
      timestamp: new Date(`2025-01-0${answerDay}T09:16:00Z`),
    },
  } as unknown as QAPair;
}

function conversationOf(pairs: QAPair[]): Conversation {
  return {
    id: 'c1',
    title: 'Lighthouse notes',
    platform: 'chatgpt',
    model: 'gpt-4',
    url: 'https://chatgpt.com/c/1',
    createdAt: new Date('2025-01-03T08:00:00Z'),
    pairs,
  } as unknown as Conversation;
}

const twoDay = conversationOf([pair(0, 1), pair(1, 2)]);
const singleDay = conversationOf([pair(0, 1), pair(1, 1)]);

const headerOptions: ExportOptions = {
  format: 'md',
  filename: 'test',
  includeMetadata: true,
  includeTimestamps: false,
};

const separatorOptions: ExportOptions = {
  format: 'md',
  filename: 'test',
  includeMetadata: false,
  includeTimestamps: true,
};

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

async function renderText(
  format: 'md' | 'txt' | 'html' | 'json',
  conversation: Conversation,
  options: ExportOptions
): Promise<string> {
  const exporter =
    format === 'md'
      ? new StructuredMarkdownExporter()
      : format === 'txt'
        ? new TextExporter()
        : format === 'html'
          ? new HtmlExporter()
          : new JsonExporter();
  const result = await exporter.export(conversation, conversation.pairs, { ...options, format });
  expect(result.success).toBe(true);
  return blobToText(result.blob!);
}

async function renderPdf(conversation: Conversation, options: ExportOptions): Promise<string> {
  instances.length = 0;
  const result = await new PdfExporter().export(conversation, conversation.pairs, {
    ...options,
    format: 'pdf',
  });
  expect(result.success).toBe(true);
  return instances
    .flatMap((doc) => doc.calls.filter((c) => c.method === 'text'))
    .map((c) => String(c.args[0]))
    .join('\n');
}

async function renderDocx(conversation: Conversation, options: ExportOptions): Promise<string> {
  const result = await new DocxExporter().export(conversation, conversation.pairs, {
    ...options,
    format: 'docx',
  });
  expect(result.success).toBe(true);
  return extractDocxEntry(result.blob!, 'word/document.xml');
}

// ---------------------------------------------------------------------------
// Half 1 — header carries platform, model, date range, export date and URL
// ---------------------------------------------------------------------------

describe('export header carries all five fields in every format', () => {
  const expectAllFields = (text: string) => {
    expect(text).toContain('ChatGPT'); // platform
    expect(text).toContain('gpt-4'); // model
    expect(text).toContain(`${DAY_1} – ${DAY_2}`); // conversation date range (new)
    expect(text).toContain('2025-01-03 08:00:00'); // export date
    expect(text).toContain('https://chatgpt.com/c/1'); // url
  };

  it('md: header lists every field', async () => {
    expectAllFields(await renderText('md', twoDay, headerOptions));
  });

  it('txt: header lists every field', async () => {
    expectAllFields(await renderText('txt', twoDay, headerOptions));
  });

  it('html: header lists every field', async () => {
    expectAllFields(await renderText('html', twoDay, headerOptions));
  });

  it('pdf: header lists every field', async () => {
    const text = await renderPdf(twoDay, headerOptions);
    expect(text).toContain('ChatGPT');
    expect(text).toContain('gpt-4');
    // pdf sanitizes the en dash to '-'
    expect(text).toContain(`${DAY_1} - ${DAY_2}`);
    expect(text).toContain('2025-01-03 08:00:00');
    expect(text).toContain('https://chatgpt.com/c/1');
  });

  it('docx: header lists every field', async () => {
    expectAllFields(await renderDocx(twoDay, headerOptions));
  });

  it('json: header records every field, date range as ISO bounds', async () => {
    const parsed = JSON.parse(await renderText('json', twoDay, headerOptions)) as {
      platform: string;
      model: string;
      url: string;
      exportedAt: string;
      dateRange: { from: string; to: string };
    };
    expect(parsed.platform).toBe('chatgpt');
    expect(parsed.model).toBe('gpt-4');
    expect(parsed.url).toBe('https://chatgpt.com/c/1');
    expect(parsed.exportedAt).toBeTruthy();
    expect(parsed.dateRange).toEqual({
      from: '2025-01-01T09:15:00.000Z',
      to: '2025-01-02T09:16:00.000Z',
    });
  });

  it('a single-day conversation reports one date, not a range', async () => {
    const text = await renderText('md', singleDay, headerOptions);
    expect(text).toContain(DAY_1);
    expect(text).not.toContain(`${DAY_1} – `);
  });
});

// ---------------------------------------------------------------------------
// Half 2 — day separators replace the per-message date
// ---------------------------------------------------------------------------

describe('day separators mark each day change in every format', () => {
  it('md: exactly one separator, at the boundary', async () => {
    const text = await renderText('md', twoDay, separatorOptions);
    expect(countOccurrences(text, SEP_2)).toBe(1);
    expect(text).not.toContain(SEP_1);
  });

  it('txt: exactly one separator, at the boundary', async () => {
    const text = await renderText('txt', twoDay, separatorOptions);
    expect(countOccurrences(text, SEP_2)).toBe(1);
    expect(text).not.toContain(SEP_1);
  });

  it('html: exactly one separator, at the boundary', async () => {
    const text = await renderText('html', twoDay, separatorOptions);
    expect(countOccurrences(text, SEP_2)).toBe(1);
    expect(text).not.toContain(SEP_1);
  });

  it('pdf: exactly one separator, at the boundary', async () => {
    const text = await renderPdf(twoDay, separatorOptions);
    expect(countOccurrences(text, PDF_SEP_2)).toBe(1);
    expect(text).not.toContain(PDF_SEP_1);
  });

  it('docx: exactly one separator, at the boundary', async () => {
    const xml = await renderDocx(twoDay, separatorOptions);
    expect(countOccurrences(xml, SEP_2)).toBe(1);
    expect(xml).not.toContain(SEP_1);
  });

  it('json: no separator — the raw ISO timestamps already carry the day', async () => {
    const text = await renderText('json', twoDay, separatorOptions);
    expect(text).not.toContain('—');
    const parsed = JSON.parse(text) as {
      pairs: { question: { timestamp: string }; answer: { timestamp: string } }[];
    };
    expect(parsed.pairs[1]!.question.timestamp).toBe('2025-01-02T09:15:00.000Z');
  });

  it.each([
    ['md', renderText.bind(null, 'md')],
    ['txt', renderText.bind(null, 'txt')],
    ['html', renderText.bind(null, 'html')],
    ['docx', renderDocx],
  ] as const)('%s: a single-day conversation emits no separator', async (_name, render) => {
    const text = await render(singleDay, separatorOptions);
    expect(text).not.toContain(SEP_1);
    expect(text).not.toContain(SEP_2);
  });

  it('pdf: a single-day conversation emits no separator', async () => {
    const text = await renderPdf(singleDay, separatorOptions);
    expect(text).not.toContain(PDF_SEP_1);
    expect(text).not.toContain(PDF_SEP_2);
  });

  it('a boundary inside a pair still emits exactly one separator', async () => {
    const straddling = conversationOf([pair(0, 1, 2), pair(1, 2)]);
    const text = await renderText('md', straddling, separatorOptions);
    expect(countOccurrences(text, SEP_2)).toBe(1);
  });

  it('the per-message stamp keeps the time and drops the date', async () => {
    const text = await renderText('md', twoDay, separatorOptions);
    // R-4 renders md's per-message time as `· HH:MM` after the bold role label.
    // The point of the assertion is unchanged: the time survives, the date does
    // not — the day is announced once by a separator.
    expect(text).toContain('· 09:15');
    expect(text).not.toContain('2025-01-01 09:15:00');
  });

  it('timestamps off: no separators at all', async () => {
    const text = await renderText('md', twoDay, { ...separatorOptions, includeTimestamps: false });
    expect(text).not.toContain(SEP_1);
    expect(text).not.toContain(SEP_2);
  });
});
