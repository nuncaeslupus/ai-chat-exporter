/**
 * Regression tests for the shared style-tokens module (lo-82e7 / C-1):
 * unit conversions stay correct, and none of pdf/docx/html reintroduce a
 * bare font-size literal now that they're wired to the token module.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  FONT_SIZE_PT,
  hexToDocxColor,
  hexToRgbTuple,
  mmToPx,
  mmToTwips,
  ptToHalfPt,
  ptToPx,
} from '../../../../src/core/exporters/style-tokens';

describe('style-tokens unit conversions', () => {
  it('hexToRgbTuple converts #rrggbb to an [r,g,b] tuple', () => {
    expect(hexToRgbTuple('#112233')).toEqual([17, 34, 51]);
  });

  it('hexToDocxColor strips the leading # and uppercases', () => {
    expect(hexToDocxColor('#6b7280')).toBe('6B7280');
  });

  it('ptToHalfPt doubles points for docx TextRun.size', () => {
    expect(ptToHalfPt(FONT_SIZE_PT.body)).toBe(24);
  });

  it('ptToPx converts at 96dpi (1pt = 4/3 px)', () => {
    expect(ptToPx(FONT_SIZE_PT.body)).toBe(16);
  });

  it('mmToTwips converts at 1in = 25.4mm = 1440 twips', () => {
    expect(mmToTwips(25.4)).toBe(1440);
  });

  it('mmToPx converts at 96dpi (1in = 25.4mm = 96px)', () => {
    expect(mmToPx(25.4)).toBe(96);
  });
});

describe('pdf/docx/html source no longer contains a bare font-size literal', () => {
  const pdfSrc = readFileSync(resolve(__dirname, '../../../../src/core/exporters/pdf-exporter.ts'), 'utf-8');
  const docxSrc = readFileSync(resolve(__dirname, '../../../../src/core/exporters/docx-exporter.ts'), 'utf-8');
  const htmlSrc = readFileSync(resolve(__dirname, '../../../../src/core/exporters/html-exporter.ts'), 'utf-8');

  it('pdf never calls setFontSize with a bare number', () => {
    expect(pdfSrc).not.toMatch(/setFontSize\(\s*\d/);
  });

  it('docx never assigns TextRun.size a bare number', () => {
    // `size:` also appears on docx's Border objects (line-thickness) and
    // Table width (WidthType.PERCENTAGE) — neither is a font size, and both
    // are out of this task's scope. Exclude any match sitting within a few
    // lines of those non-font-size markers.
    const nonFontSizeMarkers = ['BorderStyle', 'WidthType'];
    const bareSizeMatches = [...docxSrc.matchAll(/size:\s*(\d+)/g)];
    const fontSizeLiterals = bareSizeMatches.filter((m) => {
      const windowStart = Math.max(0, m.index - 80);
      const windowEnd = Math.min(docxSrc.length, m.index + 80);
      const context = docxSrc.slice(windowStart, windowEnd);
      return !nonFontSizeMarkers.some((marker) => context.includes(marker));
    });
    expect(fontSizeLiterals).toEqual([]);
  });

  it('html CSS never sets a bare numeric absolute font-size outside its documented exceptions', () => {
    // Relative units (em/%) are ratios of an already-tokenized size, not a
    // literal needing its own token. The @media breakpoints (mobile /
    // print) apply fixed responsive overrides on top of the base scale and
    // are intentionally out of this task's scope — see html-exporter.ts's
    // generateCSS().
    const [baseCss] = htmlSrc.split('@media');
    expect(baseCss).not.toMatch(/font-size:\s*\d+(?:\.\d+)?(rem|px|pt);/);
  });
});
