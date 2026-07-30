/**
 * lo-2478: artifact type x export format completeness matrix.
 *
 * Claude artifacts were reaching the export with no `content` at all (the
 * parser matched a wrapper class that no longer exists, and never read the
 * side panel where the body lives). Every exporter except JSON filters on
 * `artifact.content`, so the whole artifact rendered nowhere.
 *
 * With the parser fixed, the remaining risk is per-type: `structured-md`
 * branches on `type`/`language` three ways, and a type that falls off the end
 * of one of those branches is a silent drop in exactly one format -- the
 * failure shape PR #112's matrix work found four of. This drives every type
 * the Claude parser can now emit through all six registered formats.
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

vi.mock('jspdf', () => ({ jsPDF: MockJsPDF }));

/**
 * One artifact per shape `resolveArtifactType` can produce. Bodies are plain
 * ASCII sentences on purpose: HTML escapes its artifact bodies and the SVG
 * branch of the markdown exporter base64-encodes them, so a marker made of
 * markup would not survive verbatim in every format and the assertion would be
 * testing the escaper rather than the drop.
 */
const ARTIFACTS: Artifact[] = [
  {
    type: 'document',
    typeLabel: 'Document · MD',
    language: 'markdown',
    title: 'Tide explainer',
    content: 'BODY-DOCUMENT explaining how to read the columns.',
  },
  {
    type: 'react',
    typeLabel: 'Code · JSX',
    language: 'react',
    title: 'Tide helper',
    content: 'BODY-REACT rendering the tide picker.',
  },
  {
    type: 'image',
    typeLabel: 'Image · SVG',
    language: 'svg',
    title: 'Tide curve',
    content: 'BODY-IMAGE drawing of a tide curve.',
  },
  {
    type: 'diagram',
    typeLabel: 'Diagram · Mermaid',
    language: 'mermaid',
    title: 'Tide states',
    content: 'BODY-DIAGRAM of the four tide states.',
  },
  {
    type: 'code',
    typeLabel: 'Code · HTML',
    language: 'html',
    title: 'Tide page',
    content: 'BODY-CODE markup for the standalone page.',
  },
];

const pairs: QAPair[] = [
  {
    id: 'p1',
    index: 0,
    selected: true,
    question: {
      id: 'q1',
      role: 'user',
      content: 'Give me every kind of artifact.',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    },
    answer: {
      id: 'a1',
      role: 'assistant',
      content: 'Here they are.',
      timestamp: new Date('2025-01-01T00:00:01Z'),
      metadata: { artifacts: ARTIFACTS },
    },
  },
] as unknown as QAPair[];

const conversation: Conversation = {
  id: 'c1',
  title: 'Artifact types',
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

/** Every artifact must contribute both its title and its body to the output. */
/**
 * Strip tags so an assertion sees what the reader sees.
 *
 * R-8 splits code into one span per highlighted token, so an artifact body is no
 * longer a contiguous substring of the markup — searching the raw HTML for it
 * silently stopped matching.
 */
function visibleText(rendered: string): string {
  return rendered
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function expectEveryArtifact(rendered: string): void {
  const text = visibleText(rendered);
  for (const artifact of ARTIFACTS) {
    expect(rendered.includes(artifact.title) || text.includes(artifact.title)).toBe(true);
    expect(rendered.includes(artifact.content!) || text.includes(artifact.content!)).toBe(true);
  }
}

describe('every Claude artifact type survives export in all six formats', () => {
  it('md: renders every type', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    expectEveryArtifact(await blobToText(result.blob!));
  });

  it('txt: renders every type', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    expectEveryArtifact(await blobToText(result.blob!));
  });

  it('html: renders every type', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    expectEveryArtifact(await blobToText(result.blob!));
  });

  it('docx: renders every type', async () => {
    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    expectEveryArtifact(await extractDocxEntry(result.blob!, 'word/document.xml'));
  });

  it('pdf: renders every type', async () => {
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
    expectEveryArtifact(drawn);
  });

  it('json: keeps every artifact field verbatim', async () => {
    const result = await new JsonExporter().export(conversation, pairs, {
      ...options,
      format: 'json',
    });
    const parsed = JSON.parse(await blobToText(result.blob!)) as {
      pairs: { answer: { metadata: { artifacts: Artifact[] } } }[];
    };
    expect(parsed.pairs[0]!.answer.metadata.artifacts).toEqual(ARTIFACTS);
  });
});
