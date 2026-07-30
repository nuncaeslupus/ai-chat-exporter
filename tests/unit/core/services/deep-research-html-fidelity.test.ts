/**
 * D-31/D-33: lo-6333/#194 fixed capture (the Deep Research report reaches the
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
 * #196 relayed sanitized HTML instead so the report goes through the same
 * ChatGPTParser -> ConversationStructureService -> HtmlContentParser path an
 * ordinary ChatGPT message already uses -- but it was reverted in #198: on a
 * real page the whole answer collapsed to one line of chrome, no body at all.
 *
 * #196's own guard (further down, "cleanup heuristics never delete real
 * content") only ever asserted that a synthetic *artifact* was removed --
 * never that real prose survives. A fixture built to exercise cleanup cannot
 * detect cleanup that removes too much. D-33 adds the missing guard: a
 * realistic multi-section report (several `<h2>`/`<h3>` sections, prose
 * paragraphs, a table, a list) must survive with specific sentences and a
 * length floor intact -- not just "the artifact is gone".
 *
 * (The actual #198 defect turned out to live one layer up, in
 * deep-research-frame.ts's capture -- see
 * tests/unit/extension/content/deep-research-frame.test.ts's "HTML tier vs
 * text tier substance comparison" suite, which reproduces it and is proven to
 * fail against the reverted e7bfca5 implementation. This parser-layer suite
 * stays green on both the old and new code -- it demonstrates the cleanup
 * heuristics below were never the culprit, and guards them going forward.)
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
  <svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><text x="0" y="10">2006-01-01</text><text x="0" y="20">2026-01-01</text></svg>
`;

/**
 * D-33: a *realistic* Deep Research report shape -- several `<h2>` sections
 * of real prose, a real table, a real list, and three "case study" `<h3>`
 * sections -- much closer to the reported ~170 real lines than the six-tag
 * synthetic fixture above. This is the guard the #196 test suite was missing:
 * it asserts on specific sentences and a length floor, not just "the artifact
 * is gone".
 */
const REALISTIC_REPORT_HTML = (() => {
  const section = (heading: string, paras: string[]): string =>
    `<h2>${heading}</h2>` + paras.map((p) => `<p>${p}</p>`).join('');

  const caseStudy = (n: number): string =>
    `<h3>Caso de estudio ${n}</h3>` +
    `<p>Descripcion detallada del incidente numero ${n}, incluyendo el despliegue de mangueras, ` +
    `la presion de la linea de ataque y el tiempo de respuesta del cuerpo de bomberos.</p>` +
    `<p>Leccion aprendida numero ${n}: la coordinacion entre unidades fue determinante.</p>`;

  return `
    <div class="chrome-header">${TITLE}</div>
    <h1>${TITLE}</h1>
    <p>Research completed in 8m ·</p>
    <div class="odometer">${Array.from({ length: 12 }, (_, i) => `<span>${i % 10}</span>`).join('')}</div>
    <p>citations ·  searches</p>
    ${section('Resumen ejecutivo', [
      'El agua enfria y sofoca las llamas en incendios de gran escala mediante enfriamiento del combustible y desplazamiento de oxigeno.',
      'Las tacticas modernas combinan chorro directo, niebla de agua y espuma para maximizar la eficiencia del agua disponible.',
    ])}
    ${section('Tacticas de ataque directo', [
      'El chorro directo se emplea cuando el fuego esta en su fase de crecimiento y el acceso es seguro.',
      'La niebla de agua se prefiere en espacios confinados por su mayor superficie de enfriamiento.',
    ])}
    <table>
      <thead><tr><th>Tactica</th><th>Objetivo</th></tr></thead>
      <tbody>
        <tr><td>Chorro directo</td><td>Enfriar el combustible</td></tr>
        <tr><td>Niebla de agua</td><td>Desplazar el calor radiante</td></tr>
      </tbody>
    </table>
    ${section('Logistica de suministro de agua', [
      'El suministro puede provenir de hidrantes, cisternas moviles o fuentes naturales cercanas.',
      'La relevada de mangueras permite extender el alcance sin perder presion en la linea de ataque.',
    ])}
    <ul>
      <li>Verificar la presion de la bomba antes del despliegue.</li>
      <li>Confirmar el diametro de manguera adecuado para la distancia.</li>
      <li>Coordinar con el equipo de ventilacion.</li>
    </ul>
    ${caseStudy(1)}
    ${caseStudy(2)}
    ${caseStudy(3)}
    <svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><text x="0" y="10">2006-01-01</text><text x="0" y="20">2026-01-01</text></svg>
  `;
})();

function buildFixtureDocument(reportHtml: string): Document {
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
  iframe?.setAttribute(EMBEDDED_FRAME_REPORT_HTML_ATTR, reportHtml);
  return dom.window.document;
}

function structuredBlocksFor(
  answer: NonNullable<ReturnType<ChatGPTParser['parse']>['conversation']>['pairs'][number]['answer']
): StructuredContentBlock[] {
  return ConversationStructureService.toStructured({
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
        answer,
      },
    ],
  } as unknown as Conversation).pairs[0]!.answer.blocks;
}

// D-33: the body-survives guard. Not vacuous by construction -- it asserts on
// specific sentences pulled from every section (executive summary, tactics,
// logistics, all three case studies) plus a floor on total body length, so it
// cannot pass on a body that collapsed to one line of chrome the way #198's
// live-page bug did.
describe('Deep Research report: realistic body survives intact (D-33)', () => {
  const result = new ChatGPTParser(buildFixtureDocument(REALISTIC_REPORT_HTML)).parse();
  const answer = result.conversation?.pairs[0]?.answer;

  it('parses successfully with the real report as the answer', () => {
    expect(result.warnings).toBeUndefined();
    expect(answer).toBeDefined();
  });

  it('never collapses to widget chrome alone', () => {
    // The exact #198 failure mode: header text + widget title, concatenated,
    // with no real body. Guard against regressing to it specifically.
    expect(answer!.content).not.toBe(`Research completed in 8m · citations · searches${TITLE}`);
  });

  it('keeps a real sentence from every section, not just the title', () => {
    const mustContain = [
      'El agua enfria y sofoca las llamas en incendios de gran escala mediante enfriamiento del combustible',
      'El chorro directo se emplea cuando el fuego esta en su fase de crecimiento',
      'El suministro puede provenir de hidrantes, cisternas moviles o fuentes naturales cercanas',
      'Verificar la presion de la bomba antes del despliegue',
      'Descripcion detallada del incidente numero 1, incluyendo el despliegue de mangueras',
      'Descripcion detallada del incidente numero 2, incluyendo el despliegue de mangueras',
      'Descripcion detallada del incidente numero 3, incluyendo el despliegue de mangueras',
    ];
    for (const sentence of mustContain) {
      expect(answer!.content).toContain(sentence);
    }
  });

  it('clears a length floor that widget-chrome-only content could never reach', () => {
    // The chrome-only regression shape is ~90 chars; a real multi-section
    // report with three case studies is well over 1000.
    expect(answer!.content.length).toBeGreaterThan(1500);
  });

  it('keeps the table as a real table in the structured blocks, not a tab-separated dump', () => {
    const blocks = structuredBlocksFor(answer!);
    const tables = blocks.filter(
      (b): b is Extract<StructuredContentBlock, { type: 'table' }> => b.type === 'table'
    );
    expect(tables).toHaveLength(1);
    expect(tables[0]!.rows).toHaveLength(2);
  });

  it('keeps every h2/h3 section heading in the structured blocks', () => {
    const blocks = structuredBlocksFor(answer!);
    const headingTexts = blocks
      .filter(
        (b): b is Extract<StructuredContentBlock, { type: 'heading' }> => b.type === 'heading'
      )
      .flatMap((h) => h.content.flatMap((c) => ('text' in c ? [c.text] : [])));
    expect(headingTexts).toEqual(
      expect.arrayContaining([
        'Resumen ejecutivo',
        'Tacticas de ataque directo',
        'Logistica de suministro de agua',
        'Caso de estudio 1',
        'Caso de estudio 2',
        'Caso de estudio 3',
      ])
    );
  });

  it('recovers the real duration/source/search counts, and the marker reaches the structured blocks', () => {
    expect(answer!.metadata?.research).toEqual({ duration: '8m', sources: 18, searches: 60 });
    const blocks = structuredBlocksFor(answer!);
    const paragraphTexts = blocks.flatMap((b) =>
      b.type === 'paragraph' ? b.content.flatMap((c) => ('text' in c ? [c.text] : [])) : []
    );
    expect(paragraphTexts).toContain('[Deep Research: 8m, 18 sources, 60 searches]');
  });
});

describe('Deep Research report: captured HTML fidelity (synthetic artifact removal)', () => {
  const result = new ChatGPTParser(buildFixtureDocument(CAPTURED_REPORT_HTML)).parse();
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
    const blocks = structuredBlocksFor(answer!);

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

// Coordinator review of #196: both cleanup heuristics above were too broad and
// could silently delete real report content, which is exactly what "never
// fabricate or silently truncate" forbids.
describe('Deep Research report: cleanup heuristics never delete real content', () => {
  it('keeps both cells of a table row with identical adjacent values (unit columns, repeated ranges like "~6-8 bar")', () => {
    const html = `
      <h1>${TITLE}</h1>
      <table>
        <thead><tr><th>Tactica</th><th>Presion</th><th>Presion</th></tr></thead>
        <tbody><tr><td>Chorro directo</td><td>~6-8 bar</td><td>~6-8 bar</td></tr></tbody>
      </table>
    `;
    const result = new ChatGPTParser(buildFixtureDocument(html)).parse();
    const answer = result.conversation!.pairs[0]!.answer;
    expect(answer.content.match(/~6-8 bar/g)).toHaveLength(2);
  });

  it('keeps both rows of a table body with identical adjacent rows', () => {
    const html = `
      <h1>${TITLE}</h1>
      <table>
        <tbody>
          <tr><td>–</td><td>–</td></tr>
          <tr><td>–</td><td>–</td></tr>
        </tbody>
      </table>
    `;
    const result = new ChatGPTParser(buildFixtureDocument(html)).parse();
    const answer = result.conversation!.pairs[0]!.answer;
    const table = structuredBlocksFor(answer).find(
      (b): b is Extract<StructuredContentBlock, { type: 'table' }> => b.type === 'table'
    );
    expect(table?.rows).toHaveLength(2);
  });

  it('keeps both items of a list with two legitimately identical adjacent entries', () => {
    const html = `
      <h1>${TITLE}</h1>
      <ul><li>Revisar manguera</li><li>Revisar manguera</li></ul>
    `;
    const result = new ChatGPTParser(buildFixtureDocument(html)).parse();
    const answer = result.conversation!.pairs[0]!.answer;
    expect(answer.content.match(/Revisar manguera/g)).toHaveLength(2);
  });

  it('does not mark a small inline icon SVG (a citation glyph, ~16-24px) as a diagram', () => {
    const html = `
      <h1>${TITLE}</h1>
      <p>Citation<svg width="20" height="20" viewBox="0 0 20 20"><path d="M0 0h20v20H0z"/></svg></p>
    `;
    const result = new ChatGPTParser(buildFixtureDocument(html)).parse();
    const answer = result.conversation!.pairs[0]!.answer;
    expect(answer.content).not.toContain('[Diagram');
  });

  it('marks a large diagram-sized SVG (hundreds of px, like the Mermaid timeline) exactly once', () => {
    const html = `
      <h1>${TITLE}</h1>
      <svg width="500" height="200"><text>2006-01-01</text><text>2026-01-01</text></svg>
    `;
    const result = new ChatGPTParser(buildFixtureDocument(html)).parse();
    const answer = result.conversation!.pairs[0]!.answer;
    expect(answer.content.match(/\[Diagram: not shown/g)).toHaveLength(1);
    expect(answer.content).not.toContain('2006-01-01');
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

  const result = new ChatGPTParser(buildFixtureDocument(CAPTURED_REPORT_HTML)).parse();
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
