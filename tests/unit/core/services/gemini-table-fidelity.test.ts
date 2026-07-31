/**
 * D-38: a live Gemini capture (gemini.google.com, 2026-07, purpose-made
 * throwaway conversation with invented data) proves Gemini renders real
 * `<table>`/`<thead>`/`<th>`/`<tbody>`/`<td>` markup -- the D-38 payload's
 * premise ("Gemini has no table markup, a new selector is needed") was
 * wrong. `GEMINI_SELECTORS.messageContent` ('message-content .markdown')
 * already reaches the tables; no selector change was needed.
 *
 * The real bug lived in the SHARED parser, `HtmlContentParser.parseElement`:
 * its `switch (tagName)` only recursed into nested block content for the
 * `p`/`div` case. Gemini's real ancestry for a table is
 *   .markdown > div.horizontal-scroll-wrapper > div.table-block-component
 *     > response-element.no-md > table-block > div.table-block
 *     > div.table-content.md-content > table
 * -- the two `div`s recurse fine, but `response-element` and `table-block`
 * are CUSTOM elements, which fell into `default:` and were flattened to
 * (empty) inline text. This test guards the fix against the real captured
 * markup, not a hand-written approximation of it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HtmlContentParser } from '../../../../src/core/services/html-content-parser';
import type { TableBlock } from '../../../../src/core/types/structured-content';

const FIXTURE = join(__dirname, '../../../fixtures/dom-snapshots/gemini/table-2026-07.html');

function cellText(cell: readonly { text?: string }[] | undefined): string {
  return (cell ?? []).map((c) => c.text ?? '').join('');
}

describe('D-38: Gemini table capture survives the shared HTML parser', () => {
  let markdownHtml: string;

  beforeEach(() => {
    const html = readFileSync(FIXTURE, 'utf-8');
    const dom = new JSDOM(html);
    const markdown = dom.window.document.querySelector('message-content .markdown');
    if (!markdown) throw new Error('fixture selector drift: message-content .markdown not found');
    markdownHtml = markdown.innerHTML;
  });

  it('the fixture actually contains two real <table> elements (sanity check on the capture itself)', () => {
    const dom = new JSDOM(`<div>${markdownHtml}</div>`);
    expect(dom.window.document.querySelectorAll('table').length).toBe(2);
  });

  it('parses both tables as table blocks, not flattened paragraphs', () => {
    const blocks = HtmlContentParser.parse(markdownHtml);
    const tables = blocks.filter((b): b is TableBlock => b.type === 'table');

    // RED (pre-fix): both tables are nested under a `response-element`
    // custom element and hit the parser's `default:` branch, which had no
    // nested-block check -- both tables were flattened to empty paragraphs.
    expect(tables).toHaveLength(2);
  });

  it('the fund-rates table has the real headers and first-row values', () => {
    const blocks = HtmlContentParser.parse(markdownHtml);
    const tables = blocks.filter((b): b is TableBlock => b.type === 'table');
    const fundTable = tables.find((t) => cellText(t.headers[0]) === 'Fund');

    expect(fundTable).toBeDefined();
    expect(fundTable!.headers.map(cellText)).toEqual([
      'Fund',
      'Jurisdiction',
      'Base Rate',
      '5-Year Return',
    ]);
    expect(fundTable!.rows[0]?.map(cellText)).toEqual([
      'Aetherius Capital Alpha',
      'Cayman Islands',
      '3.50%',
      '42.8%',
    ]);
  });

  it('the glossary table has the real headers and first-row values', () => {
    const blocks = HtmlContentParser.parse(markdownHtml);
    const tables = blocks.filter((b): b is TableBlock => b.type === 'table');
    const glossaryTable = tables.find((t) => cellText(t.headers[0]) === 'Term');

    expect(glossaryTable).toBeDefined();
    expect(glossaryTable!.headers.map(cellText)).toEqual(['Term', 'Definition']);
    expect(cellText(glossaryTable!.rows[0]?.[0])).toBe('Quantisyncing');
  });
});
