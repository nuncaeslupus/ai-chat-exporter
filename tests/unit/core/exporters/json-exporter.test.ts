/**
 * JSON Exporter Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { JsonExporter, type JsonExport } from '../../../../src/core/exporters/json-exporter';
import {
  blobToText,
  createTestQAPair,
  createTestConversation,
} from '../../../utils/exporter-helpers';

describe('JsonExporter', () => {
  let exporter: JsonExporter;
  let conversation: Conversation;
  let selectedPairs: QAPair[];

  beforeEach(() => {
    exporter = new JsonExporter();
    const pairs = [
      createTestQAPair(0, 'What is TypeScript?', 'TypeScript is a typed superset of JavaScript.'),
      createTestQAPair(1, 'How do I use it?', 'You can install it with npm.'),
    ];
    conversation = createTestConversation(pairs);
    selectedPairs = pairs;
  });

  describe('format property', () => {
    it('returns "json"', () => {
      expect(exporter.format).toBe('json');
    });
  });

  describe('extension property', () => {
    it('returns "json"', () => {
      expect(exporter.extension).toBe('json');
    });
  });

  describe('mimeType property', () => {
    it('returns "application/json"', () => {
      expect(exporter.mimeType).toBe('application/json');
    });
  });

  describe('export()', () => {
    it('returns success with valid blob', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        showMetaInfo: true,
      });
      expect(result.success).toBe(true);
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toBe('test.json');
    });

    it('outputs valid JSON', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        showMetaInfo: true,
      });
      const text = await blobToText(result.blob!);
      expect(() => JSON.parse(text) as JsonExport).not.toThrow();
    });

    it('includes conversation metadata', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        showMetaInfo: true,
      });
      const text = await blobToText(result.blob!);
      const parsed = JSON.parse(text) as JsonExport;
      expect(parsed.title).toBe('Test Conversation');
      expect(parsed.platform).toBe('chatgpt');
      expect(parsed.model).toBe('gpt-4');
    });

    it('includes messages in pairs', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        showMetaInfo: true,
      });
      const text = await blobToText(result.blob!);
      const parsed = JSON.parse(text) as JsonExport;
      expect(parsed.pairs).toHaveLength(2);
      expect(parsed.pairs[0]?.question.content).toBe('What is TypeScript?');
      expect(parsed.pairs[0]?.answer.content).toBe('TypeScript is a typed superset of JavaScript.');
    });

    it('formats output with indentation', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        showMetaInfo: true,
      });
      const text = await blobToText(result.blob!);
      expect(text).toContain('\n'); // Has newlines (formatted)
      expect(text).toMatch(/^\s+"/m); // Has indentation
    });
  });

  describe('showMetaInfo gating', () => {
    it('omits title/platform/url/model/createdAt when showMetaInfo is false', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        showMetaInfo: false,
      });
      const text = await blobToText(result.blob!);
      const parsed = JSON.parse(text) as JsonExport;
      expect(parsed.title).toBeUndefined();
      expect(parsed.platform).toBeUndefined();
      expect(parsed.url).toBeUndefined();
      expect(parsed.model).toBeUndefined();
      expect(parsed.createdAt).toBeUndefined();
    });

    it('includes title/platform/url/model/createdAt when showMetaInfo is true', async () => {
      const result = await exporter.export(conversation, selectedPairs, {
        format: 'json',
        filename: 'test',
        showMetaInfo: true,
      });
      const text = await blobToText(result.blob!);
      const parsed = JSON.parse(text) as JsonExport;
      expect(parsed.title).toBe('Test Conversation');
      expect(parsed.platform).toBe('chatgpt');
      expect(parsed.url).toBe('https://chatgpt.com/c/test');
      expect(parsed.model).toBe('gpt-4');
      expect(parsed.createdAt).toBeDefined();
    });
  });

  describe('validateOptions()', () => {
    it('returns true for valid options', () => {
      const valid = exporter.validateOptions({
        format: 'json',
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

describe('R-7: JSON schema and stability', () => {
  const pair = {
    id: 'p0',
    index: 0,
    selected: true,
    question: {
      id: 'q0',
      role: 'user',
      content: 'asked',
      timestamp: new Date('2026-07-26T09:31:12Z'),
    },
    answer: {
      id: 'a0',
      role: 'assistant',
      content: 'answered',
      timestamp: new Date('2026-07-29T15:02:47Z'),
    },
  } as unknown as QAPair;

  const conversation = {
    id: 'c1',
    title: 'Systematic research programme',
    platform: 'gemini',
    model: '2.5 Pro',
    url: 'https://gemini.google.com/app/2f9c41d0a7',
    createdAt: new Date('2026-07-29T15:12:04Z'),
    pairs: [pair],
  } as unknown as Conversation;

  const options = {
    format: 'json',
    filename: 'test',
    showMetaInfo: true,
  } as unknown as ExportOptions;

  async function render(opts = options): Promise<string> {
    const result = await new JsonExporter().export(conversation, [pair], opts);
    return blobToText(result.blob!);
  }

  it('declares schemaVersion 2 as the first key', async () => {
    const parsed = JSON.parse(await render()) as JsonExport;
    expect(parsed.schemaVersion).toBe(2);
    expect(Object.keys(parsed)[0]).toBe('schemaVersion');
  });

  it('emits a stable key order that does not depend on which fields exist', async () => {
    const full = Object.keys(JSON.parse(await render()) as JsonExport);
    // A conversation with no model and no timestamps must keep the same
    // relative order for the keys it does have, so a diff stays readable.
    const bare = { ...conversation, model: undefined } as unknown as Conversation;
    const bareResult = await new JsonExporter().export(bare, [pair], options);
    const lean = Object.keys(JSON.parse(await blobToText(bareResult.blob!)) as JsonExport);
    expect(full).toEqual([
      'schemaVersion',
      'title',
      'platform',
      'model',
      'url',
      'exportedAt',
      'createdAt',
      'dateRange',
      'pairs',
    ]);
    expect(lean).toEqual(full.filter((k) => k !== 'model'));
  });

  it('writes timestamps as ISO-8601 with a UTC offset, not bare Z', async () => {
    const parsed = JSON.parse(await render()) as {
      dateRange: { from: string; to: string };
      pairs: { question: { timestamp: string } }[];
    };

    // Offset form: ±HH:MM (or +00:00 when the runner really is at UTC).
    const OFFSET = /[+-]\d{2}:\d{2}$/;
    expect(parsed.pairs[0]!.question.timestamp).toMatch(OFFSET);
    expect(parsed.dateRange.from).toMatch(OFFSET);
    expect(parsed.pairs[0]!.question.timestamp).not.toMatch(/Z$/);

    // Still the same instant, whatever the offset.
    expect(new Date(parsed.pairs[0]!.question.timestamp).toISOString()).toBe(
      '2026-07-26T09:31:12.000Z'
    );
  });

  it('indents with two spaces', async () => {
    const text = await render();
    expect(text).toMatch(/^\n?\{\n {2}"schemaVersion"/);
  });
});

describe('R-7: the UTC offset itself', () => {
  /**
   * The test environment pins the timezone to UTC — setting `TZ` does not reach
   * it — so every offset renders as `+00:00` and the sign/minutes branches never
   * run. Force a real offset by patching getTimezoneOffset; otherwise a
   * half-hour zone like +05:30, where `offsetMinutes % 60` is non-zero, is
   * entirely untested.
   *
   * Only the offset *rendering* is meaningful here. The patch does not move
   * `getHours()` et al, so the emitted instant is internally inconsistent by
   * construction — assert the suffix, never the instant, in these four cases.
   */
  const withOffset = async (minutesWestOfUtc: number): Promise<string> => {
    const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(minutesWestOfUtc);
    try {
      const pair = {
        id: 'p0',
        index: 0,
        selected: true,
        question: {
          id: 'q0',
          role: 'user',
          content: 'q',
          timestamp: new Date('2026-07-26T09:31:12Z'),
        },
        answer: {
          id: 'a0',
          role: 'assistant',
          content: 'a',
          timestamp: new Date('2026-07-26T09:32:00Z'),
        },
      } as unknown as QAPair;
      const conv = {
        id: 'c',
        title: 'T',
        platform: 'gemini',
        url: 'u',
        pairs: [pair],
      } as unknown as Conversation;
      const r = await new JsonExporter().export(conv, [pair], {
        format: 'json',
        filename: 't',
        showMetaInfo: true,
      } as unknown as ExportOptions);
      const parsed = JSON.parse(await blobToText(r.blob!)) as JsonExport;
      return parsed.pairs[0]!.question.timestamp!;
    } finally {
      spy.mockRestore();
    }
  };

  it('renders a whole-hour eastern offset as +HH:00', async () => {
    expect(await withOffset(-120)).toMatch(/\+02:00$/);
  });

  it('renders a half-hour eastern offset as +HH:30', async () => {
    expect(await withOffset(-330)).toMatch(/\+05:30$/);
  });

  it('renders a western offset as -HH:MM, minutes included', async () => {
    expect(await withOffset(570)).toMatch(/-09:30$/);
  });

  it('renders UTC as +00:00', async () => {
    expect(await withOffset(0)).toMatch(/\+00:00$/);
  });
});
