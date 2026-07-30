/**
 * Regression tests for the shared style-tokens module (lo-82e7 / C-1):
 * unit conversions stay correct, and none of pdf/docx/html reintroduce a
 * bare font-size literal now that they're wired to the token module.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  CODE_TOKEN_COLOR,
  COLOR,
  DOC_HEADING_LEVEL,
  FONT_SCALE_FACTOR,
  FONT_SIZE_PT,
  bodyHeadingLevel,
  hexToDocxColor,
  hexToRgbTuple,
  mmToPx,
  mmToTwips,
  ptToHalfPt,
  ptToPx,
  scaleFontSizes,
} from '../../../../src/core/exporters/style-tokens';

describe('R-1: the redesigned type system', () => {
  it('sets the body, code, meta and role-label sizes the design specifies', () => {
    expect(FONT_SIZE_PT.body).toBe(10.5);
    expect(FONT_SIZE_PT.code).toBe(9);
    expect(FONT_SIZE_PT.meta).toBe(8.5);
    expect(FONT_SIZE_PT.roleLabel).toBe(8.5);
  });

  it('keeps the three-step scale, which already yields the design steps from a 10.5 body', () => {
    // The design names compact 8.4 pt and large 13.1 pt. Those fall out of the
    // existing factors -- so the factors must not be touched, only the base.
    expect(FONT_SCALE_FACTOR).toEqual({ compact: 0.8, normal: 1, large: 1.25 });
    expect(scaleFontSizes(FONT_SIZE_PT, 'compact').body).toBe(8.4);
    expect(scaleFontSizes(FONT_SIZE_PT, 'large').body).toBe(13.13);
  });

  it('demotes the role label out of the heading outline, so body headings start at 2', () => {
    expect(DOC_HEADING_LEVEL.title).toBe(1);
    expect('roleLabel' in DOC_HEADING_LEVEL).toBe(false);
    expect(bodyHeadingLevel(1)).toBe(2);
    expect(bodyHeadingLevel(3)).toBe(4);
    expect(bodyHeadingLevel(6)).toBe(6); // clamped at the max
  });

  it('uses the neutral grey ink, not the blue-tinged Tailwind scale', () => {
    expect(COLOR.textPrimary).toBe('#14181A');
    expect(COLOR.textBody).toBe('#33393C');
    // The design names #6B7378, but that on the design's own #F6F7F6 turn fill
    // measures 4.496:1 — under AA by 0.004. Darkened ~1% to clear it; see the
    // comment on GRAY[500].
    expect(COLOR.textMuted).toBe('#6A7277');
    expect(COLOR.border).toBe('#E3E6E4');
    expect(COLOR.surfaceTurn).toBe('#F6F7F6');
  });

  it('declares exactly five code-token colours', () => {
    expect(Object.keys(CODE_TOKEN_COLOR).sort()).toEqual([
      'comment',
      'function',
      'keyword',
      'number',
      'string',
    ]);
    expect(CODE_TOKEN_COLOR.keyword).toBe('#9C3F63');
    expect(CODE_TOKEN_COLOR.function).toBe('#4C5FA8');
    expect(CODE_TOKEN_COLOR.string).toBe('#12665A');
    expect(CODE_TOKEN_COLOR.number).toBe('#8A5A1A');
    expect(CODE_TOKEN_COLOR.comment).toBe('#8D9598');
  });
});

describe('style-tokens unit conversions', () => {
  it('hexToRgbTuple converts #rrggbb to an [r,g,b] tuple', () => {
    expect(hexToRgbTuple('#112233')).toEqual([17, 34, 51]);
  });

  it('hexToDocxColor strips the leading # and uppercases', () => {
    expect(hexToDocxColor('#6b7280')).toBe('6B7280');
  });

  it('ptToHalfPt doubles points for docx TextRun.size', () => {
    // A literal, not a design token: a unit conversion is arithmetic and must
    // not start failing because the body size was retuned.
    expect(ptToHalfPt(12)).toBe(24);
    expect(ptToHalfPt(10.5)).toBe(21);
  });

  it('ptToPx converts at 96dpi (1pt = 4/3 px)', () => {
    expect(ptToPx(12)).toBe(16);
    expect(ptToPx(10.5)).toBe(14);
  });

  it('mmToTwips converts at 1in = 25.4mm = 1440 twips', () => {
    expect(mmToTwips(25.4)).toBe(1440);
  });

  it('mmToPx converts at 96dpi (1in = 25.4mm = 96px)', () => {
    expect(mmToPx(25.4)).toBe(96);
  });
});

describe('pdf/docx/html source no longer contains a bare font-size literal', () => {
  const pdfSrc = readFileSync(
    resolve(__dirname, '../../../../src/core/exporters/pdf-exporter.ts'),
    'utf-8'
  );
  const docxSrc = readFileSync(
    resolve(__dirname, '../../../../src/core/exporters/docx-exporter.ts'),
    'utf-8'
  );
  const htmlSrc = readFileSync(
    resolve(__dirname, '../../../../src/core/exporters/html-exporter.ts'),
    'utf-8'
  );

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
