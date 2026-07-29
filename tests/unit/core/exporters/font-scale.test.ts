/**
 * Three-step font size (C-4).
 *
 * The feature's point is the PAGE COUNT, not the font size, so that is what
 * gets asserted — an assertion on `w:sz` or `Tf` alone would pass just as
 * happily on a setting that changed nothing a reader would notice.
 *
 * How each format is measured, and how much that measurement is worth:
 *
 *   - **pdf** — a real page count, not a proxy. jsPDF runs under jsdom, so
 *     these tests export the actual .pdf bytes and read `/Count` off the
 *     document's own page-tree node (`/Type /Pages`), which is the page count
 *     any reader will see.
 *
 *   - **docx** — a proxy, and stated as one. Word paginates at render time;
 *     the file carries no page count at all (this exporter's `docProps/
 *     app.xml` is an empty `<Properties/>` — no `<Pages>` element to read,
 *     verified below so the claim cannot rot). The strongest thing measurable
 *     from the file is the input Word paginates FROM: every type size in it —
 *     the document default, all six built-in heading styles, and every
 *     explicit run — is compared step by step. Line height in Word follows the
 *     font size, so a document whose every size is strictly smaller occupies
 *     strictly less vertical space, hence no more pages. Pairwise rather than
 *     summed on purpose: a sum can be moved by one big heading while the body
 *     stays put, which is exactly the "ramp did not move together" bug.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import type { Conversation, ExportOptions, FontScale, QAPair } from '../../../../src/core/types';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import {
  DOCX_FONT_SIZE_PT,
  FONT_SIZE_PT,
  HTML_FONT_SIZE_PT,
  PDF_FONT_SIZE_PT,
  scaleFontSizes,
} from '../../../../src/core/exporters/style-tokens';

/**
 * Long enough that the page count has room to differ, and mixed enough
 * (headings, code, prose) that a scale which only moved body text would show
 * up as a much smaller difference than one that moved the whole ramp.
 */
const PROSE = 'The quick brown fox jumps over the lazy dog and keeps on running. ';

function buildConversation(): Conversation {
  const pairs = Array.from({ length: 8 }, (_, index) => ({
    id: `pair-${index}`,
    index,
    selected: true,
    question: {
      id: `q-${index}`,
      role: 'user',
      content: `Question ${index}: ${PROSE}`,
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
    answer: {
      id: `a-${index}`,
      role: 'assistant',
      content: PROSE.repeat(6),
      htmlContent:
        `<h2>Section ${index}</h2><p>${PROSE.repeat(6)}</p>` +
        `<pre><code class="language-js">const answer = ${index};</code></pre>`,
      timestamp: new Date('2025-01-01T12:00:00Z'),
    },
  })) as unknown as QAPair[];

  return {
    id: 'font-scale-fixture',
    title: 'Font scale fixture',
    platform: 'chatgpt',
    model: 'gpt-4',
    pairs,
    url: 'https://example.com/font-scale',
    createdAt: new Date('2025-01-01T12:00:00Z'),
  } as unknown as Conversation;
}

function optionsFor(format: 'pdf' | 'docx', fontScale?: FontScale): ExportOptions {
  return {
    format,
    filename: 'font-scale',
    includeMetadata: true,
    includeTimestamps: true,
    // Omitted, not set to undefined: "no step" here means the same absent
    // property a preference saved before this setting existed produces.
    ...(fontScale === undefined ? {} : { fontScale }),
  };
}

async function blobToBuffer(blob: Blob): Promise<Buffer> {
  return Buffer.from(await blob.arrayBuffer());
}

/** Page count as the PDF itself declares it, off the `/Type /Pages` node. */
async function pdfPageCount(fontScale?: FontScale): Promise<number> {
  const conversation = buildConversation();
  const result = await new PdfExporter().export(
    conversation,
    conversation.pairs,
    optionsFor('pdf', fontScale)
  );
  expect(result.success).toBe(true);

  const raw = (await blobToBuffer(result.blob!)).toString('latin1');
  const count = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/.exec(raw)?.[1];
  if (count === undefined) throw new Error('no page tree in the exported PDF');
  return Number(count);
}

async function docxZip(fontScale?: FontScale): Promise<JSZip> {
  const conversation = buildConversation();
  const result = await new DocxExporter().export(
    conversation,
    conversation.pairs,
    optionsFor('docx', fontScale)
  );
  expect(result.success).toBe(true);
  return JSZip.loadAsync(await blobToBuffer(result.blob!));
}

async function entry(zip: JSZip, name: string): Promise<string> {
  const file = zip.file(name);
  if (!file) throw new Error(`missing docx entry: ${name}`);
  return file.async('string');
}

/** Every `<w:sz>` in some XML, in document order, in half-points. */
function halfPointSizes(xml: string): number[] {
  return [...xml.matchAll(/<w:sz w:val="(\d+)"\s*\/>/g)].map((match) => Number(match[1]));
}

/** The six built-in heading styles' sizes, in level order. */
function headingStyleSizes(styles: string): number[] {
  return [...styles.matchAll(/w:styleId="Heading\d"[\s\S]{0,400}?<w:sz w:val="(\d+)"/g)]
    .map((match) => Number(match[1]))
    .slice(0, DOCX_FONT_SIZE_PT.headingByLevel.length);
}

/**
 * Every type size this exporter controls, in half-points: the document
 * default, the six heading styles, then every explicit run. Together these are
 * the numbers Word lays the pages out from.
 *
 * Scoped to what the exporter sets on purpose — `styles.xml` also carries the
 * `docx` library's own boilerplate styles (Title, ListParagraph, …), which
 * this document never applies, so sweeping the whole file would compare sizes
 * that reach no glyph on any page.
 */
async function docxTypeSizes(fontScale?: FontScale): Promise<number[]> {
  const zip = await docxZip(fontScale);
  const styles = await entry(zip, 'word/styles.xml');
  const document = await entry(zip, 'word/document.xml');

  const docDefaults = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(styles)?.[0];
  if (docDefaults === undefined) throw new Error('no w:docDefaults in the exported styles.xml');

  return [
    ...halfPointSizes(docDefaults),
    ...headingStyleSizes(styles),
    ...halfPointSizes(document),
  ];
}

describe('scaleFontSizes moves the whole type ramp', () => {
  it('leaves every size untouched at normal', () => {
    expect(scaleFontSizes(FONT_SIZE_PT, 'normal')).toEqual({ ...FONT_SIZE_PT });
    expect(scaleFontSizes(PDF_FONT_SIZE_PT, 'normal')).toEqual({
      ...PDF_FONT_SIZE_PT,
      headingByLevel: [...PDF_FONT_SIZE_PT.headingByLevel],
    });
  });

  it('treats an absent step as normal, so preferences predating it do not shift', () => {
    expect(scaleFontSizes(FONT_SIZE_PT)).toEqual(scaleFontSizes(FONT_SIZE_PT, 'normal'));
  });

  it.each([
    ['shared', FONT_SIZE_PT],
    ['pdf', PDF_FONT_SIZE_PT],
    ['docx', DOCX_FONT_SIZE_PT],
    ['html', HTML_FONT_SIZE_PT],
  ])('moves every entry of the %s table, headings and code included', (_name, table) => {
    const compact = scaleFontSizes(table, 'compact');
    const large = scaleFontSizes(table, 'large');

    const flatten = (scaled: Record<string, number | number[]>): number[] =>
      Object.values(scaled).flat();

    const compactSizes = flatten(compact);
    const largeSizes = flatten(large);
    expect(compactSizes).toHaveLength(largeSizes.length);
    // Every single entry, not the total: one entry left behind is the bug.
    for (const [index, size] of compactSizes.entries()) {
      expect(size).toBeLessThan(largeSizes[index]!);
    }
  });
});

describe('pdf page count (measured, not a proxy)', () => {
  it('needs fewer pages at compact than at large for the same conversation', async () => {
    const [compact, normal, large] = await Promise.all([
      pdfPageCount('compact'),
      pdfPageCount('normal'),
      pdfPageCount('large'),
    ]);

    expect(compact).toBeLessThan(normal);
    expect(normal).toBeLessThan(large);
  });

  it('paginates an unset step exactly like normal', async () => {
    expect(await pdfPageCount(undefined)).toBe(await pdfPageCount('normal'));
  });
});

describe('docx type sizes (proxy for page count — Word paginates at render time)', () => {
  it('carries no page count of its own, which is why the check below is a proxy', async () => {
    const app = await entry(await docxZip('compact'), 'docProps/app.xml');
    expect(app).not.toContain('<Pages>');
  });

  it('makes every size in the document smaller at compact than at large', async () => {
    const [compact, large] = await Promise.all([docxTypeSizes('compact'), docxTypeSizes('large')]);

    expect(compact.length).toBeGreaterThan(0);
    expect(compact).toHaveLength(large.length);
    for (const [index, size] of compact.entries()) {
      expect(size).toBeLessThan(large[index]!);
    }
  });

  it('scales the built-in heading styles too, so the outline never inverts', async () => {
    // Word's own default heading ramp (16/13/12/11/11/11 pt) at `large`, in
    // half-points. Written out rather than recomputed from the tokens: an
    // expectation derived from the code under test would agree with it even
    // when the scale is doing nothing.
    expect(headingStyleSizes(await entry(await docxZip('large'), 'word/styles.xml'))).toEqual([
      40, 33, 30, 28, 28, 28,
    ]);
    expect(headingStyleSizes(await entry(await docxZip('normal'), 'word/styles.xml'))).toEqual([
      32, 26, 24, 22, 22, 22,
    ]);
  });

  it('emits the same sizes for an unset step as for normal', async () => {
    expect(await docxTypeSizes(undefined)).toEqual(await docxTypeSizes('normal'));
  });
});
