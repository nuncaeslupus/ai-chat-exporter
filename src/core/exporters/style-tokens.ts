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
 * on purpose (e.g. per-format heading sizing) — they are centralised here too
 * so no bare literal remains, but are not forced to numerically match. The
 * heading *levels* they are indexed by, however, are canonical: see
 * `DOC_HEADING_LEVEL` / `bodyHeadingLevel` below.
 *
 * The global scale factor (compact/normal/large, C-4) multiplies every entry
 * of `FONT_SIZE_PT` and of the per-format size tables uniformly — see
 * `scaleFontSizes` below.
 */

import type { FontScale } from '../types';

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

/**
 * Neutral grey, not the blue-tinged Tailwind default scale this replaced (R-1).
 * The design's point: the only colour on an exported page is the platform's,
 * and only in the role-label rule and in links — so the ink itself must not
 * carry a hue of its own.
 */
const GRAY = {
  50: '#F6F7F6', // turn fill / subtle surface
  100: '#EDEFEE', // code-block background
  200: '#E3E6E4', // rules
  300: '#CBD0CD', // blockquote rule
  400: '#98A0A3', // page numbers and other de-emphasized chrome
  /**
   * Labels and footers. The design names `#6B7378`, but that value on the
   * design's own `#F6F7F6` turn fill measures **4.496:1** — short of WCAG AA
   * (4.5:1) by 0.004. Darkened ~1% to clear it, keeping the fill exactly as
   * designed since the fill is the more visible of the two. Caught by
   * tests/unit/accessibility/contrast.test.ts, not by eye.
   */
  500: '#6A7277',
  700: '#33393C', // body
  800: '#242A2C',
  900: '#14181A', // headings
} as const;

/**
 * A muted grey that clears WCAG AA on `surfaceMuted` specifically. `GRAY[500]`
 * on the old `#f3f4f6` fell just under 4.5:1 (4.39:1), caught by
 * tests/unit/accessibility/contrast.test.ts. Kept distinct from
 * `COLOR.textMuted` on purpose — this is an accessibility floor, not drift.
 * Re-derived for the R-1 neutral palette: hueless, and darker than the old
 * blue-tinged value so it holds against the slightly darker code background.
 */
const TEXT_MUTED_ON_SURFACE_MUTED = '#5C6366';

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
  /**
   * The fill that marks a *turn*. R-6 moves it from the answer to the question:
   * the background says who is asking, not who is answering.
   */
  surfaceTurn: GRAY[50],
  link: '#1F5FBF', // also the "user" role accent colour

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
  /**
   * Darkened brand variants for label TEXT on a light surface. Re-derived for
   * R-1: the previous values cleared AA on the old `#f3f4f6` but land at
   * 4.35-4.38:1 on the new, slightly darker `#EDEFEE` code surface. Each is
   * darkened the minimum needed to clear 4.5:1 there (2-3%), which keeps the
   * hue and still reads as the brand.
   */
  brandTextOnLight: {
    chatgpt: '#0C7B60',
    claude: '#A65532',
    gemini: '#1163EC',
    default: TEXT_MUTED_ON_SURFACE_MUTED,
  },
} as const;

/**
 * Look a platform id up in a brand palette, falling back to its neutral
 * `default` — so an unknown platform still yields a real colour and no format
 * ever emits an empty/undefined colour attribute.
 *
 * Pick the palette by surface: `COLOR.brand` is the accent (pdf's role label on
 * white, html's border-left rule); `COLOR.brandTextOnLight` is the darkened
 * variant for label TEXT on a light background (html's small-caps role label,
 * docx's role heading).
 */
export function brandColorFor(
  palette: typeof COLOR.brand | typeof COLOR.brandTextOnLight,
  platform: string
): string {
  return palette[platform as keyof typeof palette] ?? palette.default;
}

// ---------------------------------------------------------------------------
// Size scale — canonical, deliberately shared across the formats that use it
// (see lo-82e7 payload's ranked divergence list: body text, code blocks,
// metadata block, plus the caption-style text that inherits `meta`).
// ---------------------------------------------------------------------------

export const FONT_SIZE_PT = {
  body: 10.5, // paragraph / list-item / default document text — "a document has to fit"
  meta: 8.5, // metadata block, artifact "Type:", search-result count, footer
  code: 9, // code block body text (and code-as-artifact content)
  codeLabel: 8, // language tag rendered above a code block
  /**
   * The role label ("User" / the assistant's name). R-1's central change: this
   * used to be a level-2 *heading* at 15 pt, which is why it rendered enormous
   * and outranked the body headings underneath it. It is a label now.
   */
  roleLabel: 8.5,
} as const;

/**
 * Five token classes, not twenty (R-1). Dark and low-saturation so each clears
 * WCAG AA on the code-block background and they stay distinguishable printed in
 * greyscale — both asserted in tests/unit/accessibility/contrast.test.ts.
 *
 * `highlight.js` (already a dependency) produces far more scopes than this; R-8
 * maps them down onto these five rather than adding a palette per language.
 */
export const CODE_TOKEN_COLOR = {
  keyword: '#9C3F63',
  function: '#4C5FA8', // functions and class names
  string: '#12665A',
  number: '#8A5A1A', // numbers and constants
  comment: '#8D9598',
} as const;

// ---------------------------------------------------------------------------
// Canonical document outline (C-2)
// ---------------------------------------------------------------------------

/**
 * An exported document spends exactly ONE heading level on chrome: level 1, the
 * conversation title. Body headings therefore start at level 2 — the offset is
 * not arbitrary, it is `DOC_HEADING_LEVEL.title`.
 *
 * R-1 removed `roleLabel` from this table. The role label used to sit at level
 * 2, which cost body headings the two highest levels *and* rendered the label
 * itself as a heading (15 pt in pdf, Word's `Heading 2` in docx). It is styled
 * as a label now — see `FONT_SIZE_PT.roleLabel` — so the level it used to
 * occupy goes back to the body, and Markdown's `##` becomes available for a
 * real heading again.
 *
 * txt and json have no heading-level surface: json passes the source markup
 * through losslessly, txt collapses every heading to an underlined line.
 */
export const DOC_HEADING_LEVEL = {
  title: 1,
  max: 6,
} as const;

/** Source heading level (1-6) -> document heading level, clamped to 6. */
export function bodyHeadingLevel(sourceLevel: number): number {
  const source = Math.max(sourceLevel, 1);
  return Math.min(source + DOC_HEADING_LEVEL.title, DOC_HEADING_LEVEL.max);
}

// ---------------------------------------------------------------------------
// Per-format sizes kept intentionally format-specific (not part of this
// task's reconciliation — centralised so no bare literal remains, but not
// forced to numerically match across formats).
// ---------------------------------------------------------------------------

/**
 * pdf has no structural heading levels — font size is its only level surface,
 * so this table is indexed by DOCUMENT level (index 0 = level 1 = title) and
 * must stay monotonic. Body headings now read off levels 2-6.
 *
 * R-1 pulled the role label out of this ramp. It was index 1 (15 pt), which
 * made it the second-largest thing on the page and forced body headings down to
 * levels 3-6. Its size comes from `FONT_SIZE_PT.roleLabel` (8.5 pt) now — a
 * label, not a heading — so the ramp below is body headings only, and the
 * design's 13 pt body H1 lands at index 1.
 */
const PDF_HEADING_SCALE_PT = [20, 13, 12, 11.5, 11, 10.5] as const;

export const PDF_FONT_SIZE_PT = {
  headingByLevel: PDF_HEADING_SCALE_PT,
  title: PDF_HEADING_SCALE_PT[0], // DOC_HEADING_LEVEL.title
  sectionLabel: 10, // "Artifacts:" / "Web Search Results:"
  artifactTitle: 9.5,
  small: 8.5, // page numbers, table header/body text, search-result title
} as const;

export const DOCX_FONT_SIZE_PT = {
  title: 16,
  artifactTitle: 13,
  /**
   * Document heading levels 1-6, index 0 = level 1. docx renders headings
   * through Word's built-in `Heading N` styles, whose sizes live in Word's
   * default stylesheet rather than here — which would leave them *fixed* while
   * the C-4 font scale moved the body text, inverting the hierarchy at
   * `large`. So the ramp is declared (Word's own default sizes, unchanged at
   * `normal`) and written into the document's default heading styles, where
   * the scale reaches it like every other size.
   */
  headingByLevel: [16, 13, 12, 11, 11, 11],
} as const;

export const HTML_FONT_SIZE_PT = {
  /** The shared 20pt document title (R-6), down from a screen-sized 24. */
  title: 20,
  /**
   * Document heading levels 1-6, index 0 = level 1 — maps 1:1 onto
   * `.message-content hN`. Same ramp as `PDF_HEADING_SCALE_PT`: the design asks
   * every format to share one scale, and a body H1 is 13pt in both now.
   */
  headingByLevel: [20, 13, 12, 11.5, 11, 10.5],
  /**
   * The role label stays 10.5 here while pdf uses 8.5. Deliberate: this is a
   * screen document read at arm's length, not a printed page, and 8.5pt
   * small-caps is uncomfortably small on a monitor.
   */
  roleLabel: 10.5,
  timestamp: 9,
} as const;

// ---------------------------------------------------------------------------
// Global type scale (C-4)
// ---------------------------------------------------------------------------

/**
 * The three steps, as multipliers over the tables above.
 *
 * Three steps, deliberately — not a size input. The user-facing point is
 * "fewer pages", so the useful control is a coarse one, and a coarse one can
 * be applied to the *whole* ramp at once without a designer in the loop.
 *
 * `compact` / `large` are far enough apart (0.8 / 1.25, a factor of ~1.6) that
 * the page count of a real conversation actually moves; anything tighter is a
 * setting the user cannot see the effect of.
 */
export const FONT_SCALE_FACTOR = {
  compact: 0.8,
  normal: 1,
  large: 1.25,
} as const satisfies Record<FontScale, number>;

/**
 * Factor for a step, defaulting to `normal` — preferences stored before this
 * setting existed carry no `fontScale`, and they must keep exporting exactly
 * as they did.
 */
export function fontScaleFactor(scale?: FontScale): number {
  return FONT_SCALE_FACTOR[scale ?? 'normal'];
}

/**
 * Same table, every size multiplied. The heading ramps keep their tuple shape
 * so a fixed-length lookup stays a `number`, not a `number | undefined`.
 */
type ScaledRamp<A> = { -readonly [I in keyof A]: number };
type Scaled<T> = {
  [K in keyof T]: T[K] extends readonly number[] ? ScaledRamp<T[K]> : number;
};

/**
 * Multiply a pt size table by a step's factor.
 *
 * One pass over the table is enough because every entry is a plain number in
 * one unit — which is why headings, code, metadata and body cannot drift apart
 * under the scale: there is no per-entry decision to get wrong.
 */
export function scaleFontSizes<T extends Record<string, number | readonly number[]>>(
  table: T,
  scale?: FontScale
): Scaled<T> {
  const factor = fontScaleFactor(scale);
  const round = (pt: number): number => Math.round(pt * factor * 100) / 100;
  return Object.fromEntries(
    Object.entries(table).map(([key, value]) => [
      key,
      typeof value === 'number' ? round(value) : value.map(round),
    ])
  ) as Scaled<T>;
}

// ---------------------------------------------------------------------------
// Spacing scale
// ---------------------------------------------------------------------------

export const SPACING = {
  /** Per-nesting-level list indent, in mm (pdf's native unit). */
  listIndentStepMm: 5,
  /** Blockquote left indent, in mm (0.5in, docx's original value — unchanged). */
  blockquoteIndentMm: 12.7,
} as const;

// ---------------------------------------------------------------------------
// Pagination policy (C-5)
// ---------------------------------------------------------------------------

/**
 * Typographic pagination policy, in LINES, for the three formats that have
 * pages. Each expresses it in its own idiom:
 *   - pdf:  measured against the remaining page height before drawing, since
 *           its layout is hand-rolled (there is no property to set)
 *   - docx: `keepNext` / `keepLines` on paragraphs, `cantSplit` on table rows
 *   - html: `orphans` / `widows` / `break-*: avoid` inside `@media print`
 *
 * md, txt and json have no pagination — the concept is meaningless there and
 * they deliberately do not import this.
 */
export const PAGINATION = {
  /** Fewest lines of a straddling paragraph that may be left at a page foot. */
  orphans: 2,
  /** Fewest lines of a straddling paragraph that may be carried to the next page. */
  widows: 2,
  /**
   * Lines of following content a heading or role label must keep with it, so a
   * label never strands alone at the foot of a page with its message overleaf.
   */
  keepWithNextLines: 2,
} as const;
