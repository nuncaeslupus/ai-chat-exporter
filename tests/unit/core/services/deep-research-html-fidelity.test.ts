/**
 * D-31: lo-6333/#194 fixed capture (the Deep Research report reaches the
 * export instead of the placeholder), but the relay was flattened `innerText`,
 * so all structure was destroyed and several artifacts leaked into the export
 * -- observed on a real owner export:
 *
 *  1. An "odometer" digit dump (all ten digits of an animated citation/search
 *     counter, translated out of view by CSS, land in a text-based capture).
 *  2. The report title rendered twice in a row (widget chrome + the report's
 *     own heading).
 *  3. Tables flattened to tab-separated lines instead of real tables.
 *  4. A Mermaid diagram dumped as bare axis labels.
 *
 * The fix relays sanitized HTML instead, so the report goes through the same
 * ChatGPTParser -> ConversationStructureService -> HtmlContentParser path an
 * ordinary ChatGPT message already uses. This drives a trimmed, sanitized
 * HTML snippet reproducing all four artifacts through that whole pipeline --
 * parser, structured blocks, and all six registered exporters -- asserting
 * the artifacts are gone and the real structure (heading, table) survives.
 *
 * jsdom has no `innerText`, so this only exercises the HTML relay tier (the
 * plain-text fallback tier is covered separately in
 * tests/unit/extension/content/deep-research-frame.test.ts and
 * tests/unit/core/parsers/chatgpt.test.ts).
 */

import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ChatGPTParser } from '../../../../src/core/parsers/chatgpt/parser';
import { EMBEDDED_FRAME_REPORT_HTML_ATTR } from '../../../../src/core/parsers/chatgpt/selectors';
import { ConversationStructureService } from '../../../../src/core/services/conversation-structure-service';
import type {
  Conversation,
  ExportOptions,
  QAPair,
  StructuredContentBlock,
} from '../../../../src/core/types';
import { StructuredMarkdownExporter } from '../../../../src/core/exporters/structured-md-exporter';
import { TextExporter } from '../../../../src/core/exporters/txt-exporter';
import { JsonExporter } from '../../../../src/core/exporters/json-exporter';
import { PdfExporter } from '../../../../src/core/exporters/pdf-exporter';
import { DocxExporter } from '../../../../src/core/exporters/docx-exporter';
import { HtmlExporter } from '../../../../src/core/exporters/html-exporter';
import { blobToText } from '../../../utils/exporter-helpers';
import { extractDocxEntry, docxRunText } from '../../../utils/docx-helpers';

const TITLE = 'Uso de mangueras de agua en incendios grandes';

/**
 * A trimmed, sanitized snippet resembling the real captured report: a
 * duplicated title (chrome div + real heading), the ten-digit odometer
 * column for a citation counter, the "Research completed" stats line, a real
 * table, and an inline SVG standing in for the Mermaid timeline.
 */
const CAPTURED_REPORT_HTML = `
  <div class="chrome-header">${TITLE}</div>
  <h1>${TITLE}</h1>
  <p>Research completed in 8m ·</p>
  <div class="odometer">${Array.from({ length: 12 }, (_, i) => `<span>${i % 10}</span>`).join('')}</div>
  <p>citations ·  searches</p>
  <h2>Resumen ejecutivo</h2>
  <p>El agua enfria y sofoca las llamas en incendios de gran escala.</p>
  <table>
    <thead><tr><th>Tactica</th><th>Objetivo</th></tr></thead>
    <tbody><tr><td>Chorro directo</td><td>Enfriar el combustible</td></tr></tbody>
  </table>
  <svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="10">2006-01-01</text><text x="0" y="20">2026-01-01</text></svg>
`;

function buildFixtureDocument(): Document {
  const dom = new JSDOM(
    `<main id="main">
       <section data-turn="user" data-testid="conversation-turn-1">
         <h4 class="sr-only select-none">You said:</h4>
         <div data-message-author-role="user" data-message-id="q1" class="min-h-8 text-message">
           <div class="user-message-bubble-color">
             <div class="whitespace-pre-wrap">Do deep research on firefighting with water hoses.</div>
           </div>
         </div>
       </section>
       <section data-turn="assistant" data-testid="conversation-turn-2">
         <h4 class="sr-only select-none">ChatGPT said:</h4>
         <div class="text-base">
           <div class="agent-turn">
             <button class="text-token-text-tertiary">Research completed in 8m· 18 fuentes· 60 búsquedas</button>
             <iframe title="internal://deep-research" src="https://connector-openai-deep-research.web-sandbox.oaiusercontent.com?app=chatgpt"></iframe>
           </div>
         </div>
       </section>
     </main>`,
    { url: 'https://chatgpt.com/c/test-deep-research-fidelity' }
  );

  const iframe = dom.window.document.querySelector('iframe');
  iframe?.setAttribute(EMBEDDED_FRAME_REPORT_HTML_ATTR, CAPTURED_REPORT_HTML);
  return dom.window.document;
}

describe('Deep Research report: captured HTML fidelity (D-31)', () => {
  const result = new ChatGPTParser(buildFixtureDocument()).parse();
  const answer = result.conversation?.pairs[0]?.answer;

  it('parses successfully with the real report as the answer', () => {
    expect(result.warnings).toBeUndefined();
    expect(answer).toBeDefined();
  });

  it('keeps the title once, not twice', () => {
    const occurrences = answer!.content.split(TITLE).length - 1;
    expect(occurrences).toBe(1);
  });

  it('drops the odometer digit dump entirely', () => {
    expect(answer!.content).not.toMatch(/(?:\b\d\b\s*){5,}/);
  });

  it('drops the "Research completed" stats residue from the relayed body (the real numbers come from metadata instead)', () => {
    expect(answer!.content.toLowerCase()).not.toContain('research completed in');
    expect(answer!.content).not.toContain('citations');
  });

  it('recovers the real duration/source/search counts from the outer page button', () => {
    expect(answer!.metadata?.research).toEqual({ duration: '8m', sources: 18, searches: 60 });
  });

  it('replaces the diagram with an honest marker instead of bare axis labels', () => {
    expect(answer!.content).toContain('[Diagram: not shown -- not representable in this export]');
    expect(answer!.content).not.toContain('2006-01-01');
  });

  it('carries htmlContent through so the structure parser sees real headings and a real table', () => {
    expect(answer!.htmlContent).toBeDefined();
    const blocks = ConversationStructureService.toStructured({
      id: 'c1',
      title: 'test',
      platform: 'chatgpt',
      url: 'https://chatgpt.com/c/1',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      pairs: [
        {
          id: 'p1',
          index: 0,
          selected: true,
          question: { id: 'q1', role: 'user', content: 'question' },
          answer: answer!,
        },
      ],
    } as unknown as Conversation).pairs[0]!.answer.blocks;

    const headings = blocks.filter((b) => b.type === 'heading');
    expect(headings.length).toBeGreaterThanOrEqual(2);
    const titleHeading = headings.find(
      (h) => h.type === 'heading' && h.content.some((c) => 'text' in c && c.text.includes(TITLE))
    );
    expect(titleHeading).toBeDefined();

    const tables = blocks.filter(
      (b): b is Extract<StructuredContentBlock, { type: 'table' }> => b.type === 'table'
    );
    expect(tables).toHaveLength(1);
    const table = tables[0]!;
    expect(
      table.headers.map((cell) => cell.map((c) => ('text' in c ? c.text : '')).join(''))
    ).toEqual(['Tactica', 'Objetivo']);
    expect(table.rows).toHaveLength(1);

    // The research marker paragraph, from metadata -- proves the outer-page
    // numbers (not the relayed odometer) are what actually reaches the export.
    const paragraphTexts = blocks.flatMap((b) =>
      b.type === 'paragraph' ? b.content.flatMap((c) => ('text' in c ? [c.text] : [])) : []
    );
    expect(paragraphTexts).toContain('[Deep Research: 8m, 18 sources, 60 searches]');
  });
});

describe('Deep Research report: fidelity across all six export formats', () => {
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

  const result = new ChatGPTParser(buildFixtureDocument()).parse();
  const answer = result.conversation!.pairs[0]!.answer;

  const pairs: QAPair[] = [
    {
      id: 'p1',
      index: 0,
      selected: true,
      question: { id: 'q1', role: 'user', content: 'Do deep research on firefighting.' },
      answer,
    },
  ] as unknown as QAPair[];

  const conversation: Conversation = {
    id: 'c1',
    title: 'Firefighting with water hoses',
    platform: 'chatgpt',
    url: 'https://chatgpt.com/c/1',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    pairs,
  } as unknown as Conversation;

  const options: ExportOptions = { format: 'md', filename: 'test', showMetaInfo: false };

  it('md: renders the heading and a real pipe table, no tab-separated dump or digit soup', async () => {
    const exportResult = await new StructuredMarkdownExporter().export(conversation, pairs, {
      ...options,
      format: 'md',
    });
    const text = await blobToText(exportResult.blob!);
    expect(text).toContain(`## ${TITLE}`);
    expect(text).toContain('| Tactica | Objetivo |');
    expect(text).not.toMatch(/Tactica\tObjetivo/);
    expect(text).not.toMatch(/(?:\b\d\b\s*){5,}/);
    expect(text.split(TITLE).length - 1).toBe(1);
  });

  it('txt: renders the heading and a table, no tab-separated dump or digit soup', async () => {
    const exportResult = await new TextExporter().export(conversation, pairs, {
      ...options,
      format: 'txt',
    });
    const text = await blobToText(exportResult.blob!);
    expect(text).toContain(TITLE);
    expect(text).toContain('Tactica');
    expect(text).not.toMatch(/Tactica\tObjetivo/);
    expect(text).not.toMatch(/(?:\b\d\b\s*){5,}/);
    expect(text.split(TITLE).length - 1).toBe(1);
  });

  it('html: renders a real <table> and heading tag, no digit soup', async () => {
    const exportResult = await new HtmlExporter().export(conversation, pairs, {
      ...options,
      format: 'html',
    });
    const html = await blobToText(exportResult.blob!);
    expect(html).toContain('<table>');
    expect(html).toContain(TITLE);
    expect(html).not.toMatch(/(?:\b\d\b\s*){5,}/);
  });

  it('json: keeps the sanitized content and htmlContent', async () => {
    const exportResult = await new JsonExporter().export(conversation, pairs, {
      ...options,
      format: 'json',
    });
    const parsed = JSON.parse(await blobToText(exportResult.blob!)) as {
      pairs: { answer: { content: string; htmlContent?: string } }[];
    };
    expect(parsed.pairs[0]!.answer.content.split(TITLE).length - 1).toBe(1);
    expect(parsed.pairs[0]!.answer.content).not.toMatch(/(?:\b\d\b\s*){5,}/);
  });

  it('pdf: renders the title once and the table cell text, no digit soup', async () => {
    instances.length = 0;
    const exportResult = await new PdfExporter().export(conversation, pairs, {
      ...options,
      format: 'pdf',
    });
    expect(exportResult.success).toBe(true);
    const combined = instances
      .flatMap((doc) => doc.calls.filter((c) => c.method === 'text'))
      .map((c) => String(c.args[0]))
      .join('\n');
    expect(combined).toContain('Chorro directo');
    expect(combined.split(TITLE).length - 1).toBe(1);
  });

  it('docx: renders the title once and the table cell text, no digit soup', async () => {
    const exportResult = await new DocxExporter().export(conversation, pairs, {
      ...options,
      format: 'docx',
    });
    expect(exportResult.success).toBe(true);
    const xml = await extractDocxEntry(exportResult.blob!, 'word/document.xml');
    const text = docxRunText(xml);
    expect(text).toContain('Chorro directo');
    expect(text.split(TITLE).length - 1).toBe(1);
    expect(text).not.toMatch(/(?:\b\d\b\s*){5,}/);
  });
});
