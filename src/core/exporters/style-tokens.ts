/**
 * Shared typography tokens for the pdf, docx and html exporters.
 *
 * md and txt have no typographic surface (plain text) and do not use this module.
 *
 * Canonical units:
 *   - font size  -> points (pt)
 *   - colour     -> hex string ('#rrggbb')
 *   - spacing    -> millimetres (mm), pdf's native document unit
 *
 * Each exporter converts at its own boundary with the helpers below:
 *   - pdf:  pt directly (jsPDF's font-size unit is pt); hexToRgbTuple() for setTextColor/etc; mm directly
 *   - docx: ptToHalfPt() for TextRun.size (half-points); hexToDocxColor() for TextRun.color; mmToTwips() for indent
 *   - html: ptToPx() for CSS font-size; hex used as-is; mmToPx() for CSS padding
 *
 * `FONT_SIZE_PT` / `COLOR` / `SPACING` hold values that are deliberately shared
 * across two or more formats (the divergences called out in lo-82e7). The
 * `PDF_*` / `DOCX_*` / `HTML_*` constants hold values that stay format-specific
 * on purpose (e.g. heading-level sizing, which C-2 owns) — they are centralised
 * here too so no bare literal remains, but are not forced to numerically match.
 *
 * A later global scale factor (compact/normal/large, see C-4) can multiply
 * every entry of `FONT_SIZE_PT` (and the per-format size tables) uniformly
 * since they are plain numbers in one unit — no rewrite needed.
 */

// ---------------------------------------------------------------------------
// Unit conversion helpers
// ---------------------------------------------------------------------------

/** '#rrggbb' -> [r, g, b] for jsPDF's setTextColor/setDrawColor/setFillColor. */
export function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return [r, g, b];
}

/** '#rrggbb' -> 'RRGGBB' for docx's TextRun.color / shading.fill. */
export function hexToDocxColor(hex: string): string {
  return hex.replace('#', '').toUpperCase();
}

/** Points -> half-points, docx's TextRun.size unit. */
export function ptToHalfPt(pt: number): number {
  return Math.round(pt * 2);
}

/** Points -> CSS pixels (96dpi: 1pt = 4/3px), rounded to 2 decimals. */
export function ptToPx(pt: number): number {
  return Math.round(pt * (96 / 72) * 100) / 100;
}

/** Millimetres -> twips, docx's indent/spacing unit (1in = 25.4mm = 1440 twips). */
export function mmToTwips(mm: number): number {
  return Math.round((mm / 25.4) * 1440);
}

/** Millimetres -> CSS pixels (96dpi: 1in = 25.4mm = 96px). */
export function mmToPx(mm: number): number {
  return Math.round((mm / 25.4) * 96 * 100) / 100;
}

// ---------------------------------------------------------------------------
// Font families
// ---------------------------------------------------------------------------

export const FONT_FAMILY = {
  body: {
    pdf: 'helvetica',
    docx: 'Arial',
    css: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
  },
  code: {
    pdf: 'courier',
    docx: 'Courier New',
    css: "'Courier New', Courier, monospace",
  },
} as const;

// ---------------------------------------------------------------------------
// Colour palette (canonical hex — Tailwind's default gray scale, already what
// most of the literals it replaces resolved to)
// ---------------------------------------------------------------------------

const GRAY = {
  50: '#f9fafb',
  100: '#f3f4f6',
  200: '#e5e7eb',
  300: '#d1d5db',
  400: '#9ca3af',
  500: '#6b7280',
  700: '#374151',
  800: '#1f2937',
  900: '#111827',
} as const;

/**
 * A darker muted gray, required (not stylistic) on html's `surfaceMuted`
 * (#f3f4f6, the assistant-message background): `GRAY[500]` alone falls
 * just under the WCAG AA 4.5:1 threshold there (4.39:1), caught by
 * tests/unit/accessibility/contrast.test.ts. Kept distinct from
 * `COLOR.textMuted` on purpose — this is an accessibility floor, not drift.
 */
const TEXT_MUTED_ON_SURFACE_MUTED = '#686f7d';

export const COLOR = {
  textPrimary: GRAY[900], // titles, artifact/search-result headings
  textBody: GRAY[700], // paragraph / list / table-header text
  textStrong: GRAY[800], // headings & code text (pdf); code-on-dark bg (html)
  textMuted: GRAY[500], // canonical caption/fallback gray — see reconciliation notes below
  textMutedOnSurfaceMuted: TEXT_MUTED_ON_SURFACE_MUTED,
  textFaint: GRAY[400], // page numbers and other de-emphasized chrome
  border: GRAY[200],
  blockquoteBorder: GRAY[300], // canonical blockquote rule colour (pdf & html already agreed on this)
  surfaceSubtle: GRAY[50], // table header background, alternating row background
  surfaceMuted: GRAY[100], // pdf code-block background; html code-on-dark text colour
  link: '#2563eb', // also the "user" role accent colour

  /**
   * Canonical platform brand colours. pdf's original values are canonical —
   * html's border-left accent already matched them; only html's small-caps
   * role-LABEL text used a separately-darkened variant for contrast on a
   * light background, kept below as `brandTextOnLight` (still centralised,
   * just intentionally distinct from the accent colour).
   */
  brand: {
    chatgpt: '#10a37f',
    claude: '#cc7b58',
    gemini: '#4285f4',
    default: GRAY[500],
  },
  brandTextOnLight: {
    chatgpt: '#0c7e62',
    claude: '#ab5834',
    gemini: '#1165f1',
    default: TEXT_MUTED_ON_SURFACE_MUTED,
  },
} as const;

// ---------------------------------------------------------------------------
// Size scale — canonical, deliberately shared across the formats that use it
// (see lo-82e7 payload's ranked divergence list: body text, code blocks,
// metadata block, plus the caption-style text that inherits `meta`).
// ---------------------------------------------------------------------------

export const FONT_SIZE_PT = {
  body: 12, // paragraph / list-item / default document text
  meta: 10, // metadata block, timestamps baked into captions, artifact "Type:", search-result count, footer
  code: 10, // code block body text (and code-as-artifact content)
  codeLabel: 8, // language tag rendered above a code block
} as const;

// ---------------------------------------------------------------------------
// Per-format sizes kept intentionally format-specific (not part of this
// task's reconciliation — centralised so no bare literal remains, but not
// forced to numerically match across formats). Heading-level sizing in
// particular is C-2's job.
// ---------------------------------------------------------------------------

export const PDF_FONT_SIZE_PT = {
  title: 20,
  roleLabel: 12,
  /** Heading levels 1-6, index 0 = level 1. Unchanged from the previous max(16-level,11) formula. */
  headingByLevel: [15, 14, 13, 12, 11, 11],
  sectionLabel: 11, // "Artifacts:" / "Web Search Results:"
  artifactTitle: 10,
  small: 9, // page numbers, table header/body text, search-result title
} as const;

export const DOCX_FONT_SIZE_PT = {
  title: 16,
  artifactTitle: 13,
} as const;

export const HTML_FONT_SIZE_PT = {
  title: 24,
  /** Heading levels 1-6, index 0 = level 1. Unchanged. */
  headingByLevel: [22.5, 18, 15, 13.5, 12, 10.5],
  roleLabel: 10.5,
  timestamp: 9.75,
} as const;

// ---------------------------------------------------------------------------
// Spacing scale
// ---------------------------------------------------------------------------

export const SPACING = {
  /** Per-nesting-level list indent, in mm (pdf's native unit). */
  listIndentStepMm: 5,
  /** Blockquote left indent, in mm (0.5in, docx's original value — unchanged). */
  blockquoteIndentMm: 12.7,
} as const;
