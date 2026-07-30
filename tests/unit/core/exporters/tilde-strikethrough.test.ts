/**
 * D-29 (lo-dbc4): GFM's default strikethrough rule accepts a SINGLE `~` as a
 * delimiter, so prose using `~` to mean "approximately" (e.g. "~64 days") was
 * parsed as `<del>` and the tilde characters silently deleted -- content the
 * source page rendered literally came out of our export changed. Fixed by
 * `requireDoubleTildeStrikethrough` (src/core/utils/markdown-options.ts), a
 * `marked` tokenizer override applied once and shared by both call sites that
 * configure `marked` (`loadMarkdownRenderer` in code-highlight.ts, used by
 * pdf/docx/html to render prose artifacts, and content-script.ts's print
 * path) rather than pasted at each.
 *
 * `~~struck~~` (two tildes) must still produce real strikethrough -- the fix
 * narrows the delimiter, it does not turn GFM off.
 *
 * md/txt/json never run `marked` on artifact content (md IS markdown, so a
 * document artifact's source passes through verbatim; txt/json are raw) --
 * included anyway for completeness and because they must never regress.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Artifact, Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { JsonExporter } from '../../../../src/core/exporters/json-exporter';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import { blobToText } from '../../../utils/exporter-helpers';
import { extractDocxEntry, docxRunText } from '../../../utils/docx-helpers';

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
    addFileToVFS(...args: unknown[]) {
      this.record('addFileToVFS', args);
    }
    addFont(...args: unknown[]) {
      this.record('addFont', args);
    }
    getTextWidth(text: string) {
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

vi.mock('jspdf', () => ({ jsPDF: MockJsPDF }));

const OWNER_SENTENCE =
  'Some numbers vary by source and colony. Emperor incubation is quoted as anywhere ' +
  'from ~64 to ~75 days depending on colony; male mass loss (~20 kg) and total fast ' +
  '(~110–115 days) are typical figures, not universal constants.';

/** Only `type: 'document'` artifacts run through `marked` in html/pdf/docx. */
const proseArtifact: Artifact = {
  type: 'document',
  typeLabel: 'Document · MD',
  language: 'markdown',
  title: 'Emperor penguin notes',
  content: OWNER_SENTENCE,
};

const pairs: QAPair[] = [
  {
    id: 'p1',
    index: 0,
    selected: true,
    question: {
      id: 'q1',
      role: 'user',
      content: 'How long do emperor penguin eggs take to hatch?',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    },
    answer: {
      id: 'a1',
      role: 'assistant',
      content: 'Here are the details.',
      timestamp: new Date('2025-01-01T00:00:01Z'),
      metadata: { artifacts: [proseArtifact] },
    },
  },
] as unknown as QAPair[];

const conversation: Conversation = {
  id: 'c1',
  title: 'Emperor penguins',
  platform: 'claude',
  url: 'https://claude.ai/chat/1',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  pairs,
} as unknown as Conversation;

const options: ExportOptions = {
  format: 'md',
  filename: 'test',
  showMetaInfo: false,
};

function expectTildesSurvive(text: string): void {
  expect(text).toContain('~64');
  expect(text).toContain('~75');
  expect(text).toContain('~20');
  expect(text).toContain('~110–115');
  expect(text).not.toMatch(/<del[ >]/);
  expect(text).not.toContain('</del>');
}

describe("a lone '~' used for approximation survives export in all six formats", () => {
  it('md: passes the document artifact through as markdown source, tildes intact', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    expectTildesSurvive(await blobToText(result.blob!));
  });

  it('txt: never runs marked, tildes intact', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    expectTildesSurvive(await blobToText(result.blob!));
  });

  it('json: raw content, tildes intact', async () => {
    const result = await new JsonExporter().export(conversation, pairs, {
      ...options,
      format: 'json',
    });
    const parsed = JSON.parse(await blobToText(result.blob!)) as {
      pairs: { answer: { metadata: { artifacts: Artifact[] } } }[];
    };
    expectTildesSurvive(parsed.pairs[0]!.answer.metadata.artifacts[0]!.content!);
  });

  it('html: renders the prose artifact through marked, tildes intact, no <del>', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    expectTildesSurvive(await blobToText(result.blob!));
  });

  it('docx: renders the prose artifact through marked, tildes intact, no strike run', async () => {
    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    expectTildesSurvive(docxRunText(xml));
    expect(xml).not.toContain('w:strike');
  });

  it('pdf: draws the literal text -- this is the dangerous case, no styling hides the loss', async () => {
    instances.length = 0;
    const result = await new PdfExporter().export(conversation, pairs, {
      ...options,
      format: 'pdf',
    });
    expect(result.success).toBe(true);

    const drawn = instances
      .flatMap((doc) => doc.calls.filter((c) => c.method === 'text'))
      .map((c) => String(c.args[0]))
      .join('\n');
    expectTildesSurvive(drawn);
  });
});

describe('a real `~~strikethrough~~` still renders as strikethrough', () => {
  const strikeArtifact: Artifact = {
    type: 'document',
    typeLabel: 'Document · MD',
    language: 'markdown',
    title: 'Strikethrough sample',
    content: 'This is ~~struck~~ text.',
  };

  const strikePairs: QAPair[] = [
    {
      id: 'p2',
      index: 0,
      selected: true,
      question: {
        id: 'q2',
        role: 'user',
        content: 'Show me strikethrough.',
        timestamp: new Date('2025-01-01T00:00:00Z'),
      },
      answer: {
        id: 'a2',
        role: 'assistant',
        content: 'Here it is.',
        timestamp: new Date('2025-01-01T00:00:01Z'),
        metadata: { artifacts: [strikeArtifact] },
      },
    },
  ] as unknown as QAPair[];

  const strikeConversation: Conversation = {
    id: 'c2',
    title: 'Strikethrough',
    platform: 'claude',
    url: 'https://claude.ai/chat/2',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    pairs: strikePairs,
  } as unknown as Conversation;

  it('html: renders <del>struck</del>', async () => {
    const result = await new HtmlExporter().export(strikeConversation, strikePairs, {
      ...options,
      format: 'html',
    });
    const text = await blobToText(result.blob!);
    expect(text).toMatch(/<del[^>]*>struck<\/del>/);
  });

  it('docx: renders a struck-through run', async () => {
    const result = await new DocxExporter().export(strikeConversation, strikePairs, {
      ...options,
      format: 'docx',
    });
    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    expect(xml).toContain('w:strike');
    expect(docxRunText(xml)).toContain('struck');
  });
});
