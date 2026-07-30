/**
 * lo-6fe5: generated video / audio (Gemini "Create video", "Create music") had
 * no representation in the model at all, so it was dropped whatever the parser
 * did. `metadata.media` carries it now; this drives all six registered formats
 * end-to-end with a message carrying one generated video and one generated
 * audio clip and asserts each format represents both.
 *
 * lo-8e3d: the video also carries `duration: 8`, which `mediaLabel()` used to
 * ignore, so it reached no format. Every label assertion below now pins the
 * "(0:08)" suffix; the audio clip has no duration and must stay bare.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Conversation, ExportOptions, QAPair } from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { JsonExporter } from '../../../../src/core/exporters/json-exporter';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import { ConversationStructureService } from '../../../../src/core/services/conversation-structure-service';
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

const VIDEO_URL = 'https://gemini.example.test/generated/clip.mp4';
const AUDIO_URL = 'https://gemini.example.test/generated/track.m4a';

const pairs: QAPair[] = [
  {
    id: 'p1',
    index: 0,
    selected: true,
    question: {
      id: 'q1',
      role: 'user',
      content: 'Make me a video and a song about a lighthouse',
      timestamp: new Date('2025-01-01T00:00:00Z'),
    },
    answer: {
      id: 'a1',
      role: 'assistant',
      content: 'Here you go.',
      htmlContent: '<p>Here you go.</p>',
      timestamp: new Date('2025-01-01T00:00:01Z'),
      metadata: {
        media: [
          {
            kind: 'video',
            src: VIDEO_URL,
            alt: 'Lighthouse timelapse',
            mimeType: 'video/mp4',
            duration: 8,
          },
          { kind: 'audio', src: AUDIO_URL, alt: 'Lighthouse song', mimeType: 'audio/mp4' },
        ],
      },
    },
  },
] as unknown as QAPair[];

const conversation: Conversation = {
  id: 'c1',
  title: 'Generated media',
  platform: 'gemini',
  url: 'https://gemini.google.com/app/1',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  pairs,
} as unknown as Conversation;

const options: ExportOptions = {
  format: 'md',
  filename: 'test',
  includeMetadata: false,
  includeTimestamps: false,
};

describe('generated video and audio survive export in all six formats', () => {
  it('model: media becomes video/audio blocks in the structured conversation', () => {
    const blocks = ConversationStructureService.toStructured(conversation).pairs[0]!.answer.blocks;
    const media = blocks.filter((b) => b.type === 'media');
    expect(media).toHaveLength(2);
    expect(media[0]).toMatchObject({
      kind: 'video',
      url: VIDEO_URL,
      alt: 'Lighthouse timelapse',
      duration: 8,
    });
    expect(media[1]).toMatchObject({ kind: 'audio', url: AUDIO_URL, alt: 'Lighthouse song' });
  });

  it('md: links both clips with a labelled link', async () => {
    const result = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain(`[Video: Lighthouse timelapse (0:08)](${VIDEO_URL})`);
    expect(text).toContain(`[Audio: Lighthouse song](${AUDIO_URL})`);
  });

  it('txt: labels both clips and keeps the URL', async () => {
    const result = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain(`[Video: Lighthouse timelapse (0:08)] ${VIDEO_URL}`);
    expect(text).toContain(`[Audio: Lighthouse song] ${AUDIO_URL}`);
  });

  it('html: emits real <video>/<audio> players with a link fallback', async () => {
    const result = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    const text = await blobToText(result.blob!);
    expect(text).toContain(`<video controls src="${VIDEO_URL}"`);
    expect(text).toContain(`<audio controls src="${AUDIO_URL}"`);
    // Fallback link, so the clip is still reachable where playback fails.
    expect(text).toContain(`<a href="${VIDEO_URL}">Video: Lighthouse timelapse (0:08)</a>`);
    expect(text).toContain(`<a href="${AUDIO_URL}">Audio: Lighthouse song</a>`);
  });

  it('json: records the raw media fields', async () => {
    const result = await new JsonExporter().export(conversation, pairs, {
      ...options,
      format: 'json',
    });
    const text = await blobToText(result.blob!);
    const parsed = JSON.parse(text) as {
      pairs: { answer: { metadata: { media: { kind: string; src: string }[] } } }[];
    };
    expect(parsed.pairs[0]!.answer.metadata.media).toEqual([
      {
        kind: 'video',
        src: VIDEO_URL,
        alt: 'Lighthouse timelapse',
        mimeType: 'video/mp4',
        duration: 8,
      },
      { kind: 'audio', src: AUDIO_URL, alt: 'Lighthouse song', mimeType: 'audio/mp4' },
    ]);
  });

  it('pdf: writes a labelled placeholder with the URL', async () => {
    instances.length = 0;
    const result = await new PdfExporter().export(conversation, pairs, {
      ...options,
      format: 'pdf',
    });
    expect(result.success).toBe(true);

    const combined = instances
      .flatMap((doc) => doc.calls.filter((c) => c.method === 'text'))
      .map((c) => String(c.args[0]))
      .join('\n');
    expect(combined).toContain(`[Video: Lighthouse timelapse (0:08)] ${VIDEO_URL}`);
    expect(combined).toContain(`[Audio: Lighthouse song] ${AUDIO_URL}`);
  });

  it('docx: writes a labelled placeholder with the URL', async () => {
    const result = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    expect(result.success).toBe(true);

    const xml = await extractDocxEntry(result.blob!, 'word/document.xml');
    expect(xml).toContain(`[Video: Lighthouse timelapse (0:08)] ${VIDEO_URL}`);
    expect(xml).toContain(`[Audio: Lighthouse song] ${AUDIO_URL}`);
  });
});

/**
 * lo-8e3d: `mediaLabel()` is the single place all six formats derive the label
 * from, so the seconds -> clock conversion only needs pinning once. Driven
 * through txt because it renders the label verbatim.
 */
describe('media duration formatting', () => {
  const labelFor = async (duration?: number): Promise<string> => {
    const durationPairs = [
      {
        ...pairs[0],
        answer: {
          ...pairs[0]!.answer,
          metadata: {
            media: [
              {
                kind: 'audio',
                src: AUDIO_URL,
                alt: 'Clip',
                ...(duration === undefined ? {} : { duration }),
              },
            ],
          },
        },
      },
    ] as unknown as QAPair[];
    const result = await new TextExporter().export(
      { ...conversation, pairs: durationPairs },
      durationPairs,
      { ...options, format: 'txt' }
    );
    const text = await blobToText(result.blob!);
    return /\[(Audio[^\]]*)\]/.exec(text)?.[1] ?? '';
  };

  it.each([
    [undefined, 'Audio: Clip'],
    [0, 'Audio: Clip'], // 0 says nothing — stay bare rather than print "(0:00)"
    [8, 'Audio: Clip (0:08)'],
    [134, 'Audio: Clip (2:14)'],
    [3600, 'Audio: Clip (1:00:00)'],
    [3725, 'Audio: Clip (1:02:05)'],
  ])('duration %s renders as %s', async (duration, expected) => {
    expect(await labelFor(duration)).toBe(expected);
  });
});
