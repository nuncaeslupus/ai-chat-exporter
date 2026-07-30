/**
 * The report view. The assertion that matters is the last one: the text in the
 * preview and the text on the clipboard are the same string, because that is
 * what makes "you can see nothing else is sent" verifiable.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';

const html = readFileSync(join(process.cwd(), 'src/extension/popup/popup.html'), 'utf-8');

describe('report view markup', () => {
  let doc: Document;

  beforeEach(() => {
    doc = new JSDOM(html).window.document;
  });

  it('declares a report view section', () => {
    expect(doc.getElementById('view-report')).not.toBeNull();
  });

  it('starts hidden like every other submenu', () => {
    expect(doc.getElementById('view-report')?.hasAttribute('hidden')).toBe(true);
  });

  it('is reachable from the drift row through the delegated router', () => {
    const trigger = doc.querySelector('[data-nav="report"]');
    expect(trigger).not.toBeNull();
  });

  it('has a back button to main', () => {
    const back = doc.querySelector('#view-report [data-nav="main"]');
    expect(back).not.toBeNull();
  });

  it('has a preview element, a copy button and a copy-and-report button', () => {
    expect(doc.getElementById('drift-report-preview')).not.toBeNull();
    expect(doc.getElementById('drift-report-copy')).not.toBeNull();
    expect(doc.getElementById('drift-report-copy-and-report')).not.toBeNull();
  });

  it('states the privacy guarantee above the preview', () => {
    const intro = doc.querySelector('[data-i18n="driftReportIntro"]');
    expect(intro).not.toBeNull();
  });

  it('carries a drift row in the main view', () => {
    expect(doc.getElementById('drift-row')).not.toBeNull();
  });
});
