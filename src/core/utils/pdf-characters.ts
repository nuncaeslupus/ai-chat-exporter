import { EMBEDDED_FONT_COVERAGE } from '../exporters/pdf-fonts.generated';

/**
 * Character replacements for PDF generation
 *
 * jsPDF's default fonts (Helvetica, Times, Courier) use WinAnsiEncoding (Windows-1252),
 * which only supports 256 characters (0x00-0xFF). Characters outside this range
 * will not render correctly or may cause PDF rendering issues in some viewers (especially Chrome).
 *
 * This file maps problematic Unicode characters to safe ASCII equivalents.
 *
 * References:
 * - Windows-1252: https://www.fileformat.info/info/charset/windows-1252/list.htm
 * - jsPDF Font Encoding: https://github.com/parallax/jsPDF/issues/2677
 */

/**
 * Characters that are not in Windows-1252 or cause rendering issues
 */
const PDF_CHARACTER_REPLACEMENTS: Record<string, string> = {
  // Currency symbols not in Windows-1252
  '฿': 'THB', // Thai Baht (U+0E3F)
  '₹': 'INR', // Indian Rupee (U+20B9)
  '₽': 'RUB', // Russian Ruble (U+20BD)
  '₴': 'UAH', // Ukrainian Hryvnia (U+20B4)
  '₩': 'KRW', // Korean Won (U+20A9)
  '₪': 'ILS', // Israeli Shekel (U+20AA)
  '₦': 'NGN', // Nigerian Naira (U+20A6)
  '₨': 'Rs', // Rupee (U+20A8)
  '₡': 'CRC', // Costa Rican Colon (U+20A1)
  '₱': 'PHP', // Philippine Peso (U+20B1)
  '₺': 'TRY', // Turkish Lira (U+20BA)
  '₸': 'KZT', // Kazakhstani Tenge (U+20B8)
  '₼': 'AZN', // Azerbaijani Manat (U+20BC)
  '₾': 'GEL', // Georgian Lari (U+20BE)

  // Mathematical operators not in Windows-1252
  '≈': '~', // Almost equal (U+2248) - not in Win-1252, visible tilde substitute
  '≠': '!=', // Not equal (U+2260)
  '≤': '<=', // Less than or equal (U+2264)
  '≥': '>=', // Greater than or equal (U+2265)
  '≡': '==', // Identical to (U+2261)
  '∼': '~', // Tilde operator (U+223C) - not in Win-1252, visible tilde substitute
  // '˜' Small tilde (U+02DC) - in Win-1252 (0x98), passes through unchanged
  '∽': '~', // Reversed tilde (U+223D) - not in Win-1252, visible tilde substitute
  '∾': '~', // Inverted lazy S (U+223E) - not in Win-1252, visible tilde substitute
  // '~' Regular tilde (U+007E) - in Win-1252 (ASCII), passes through unchanged
  '∞': 'infinity', // Infinity (U+221E)
  '∫': 'integral', // Integral (U+222B)
  '∑': 'sum', // N-ary summation (U+2211)
  '∏': 'product', // N-ary product (U+220F)
  '√': 'sqrt', // Square root (U+221A)
  '∂': 'd', // Partial differential (U+2202)
  '∆': 'delta', // Increment (U+2206)
  '∇': 'nabla', // Nabla (U+2207)
  '∈': 'in', // Element of (U+2208)
  '∉': 'not in', // Not an element of (U+2209)
  '∅': 'empty', // Empty set (U+2205)
  '⊂': 'subset', // Subset of (U+2282)
  '⊃': 'superset', // Superset of (U+2283)
  '∩': 'intersect', // Intersection (U+2229)
  '∪': 'union', // Union (U+222A)
  '∧': 'AND', // Logical AND (U+2227)
  '∨': 'OR', // Logical OR (U+2228)
  '¬': 'NOT', // Not sign (U+00AC) - Actually in Win-1252 but may cause issues
  '⊕': 'XOR', // Circled plus (U+2295)
  '⊗': 'tensor', // Circled times (U+2297)

  // Arrows not in Windows-1252
  '→': '->', // Rightwards arrow (U+2192)
  '←': '<-', // Leftwards arrow (U+2190)
  '↑': '^', // Upwards arrow (U+2191)
  '↓': 'v', // Downwards arrow (U+2193)
  '↔': '<->', // Left right arrow (U+2194)
  '⇒': '=>', // Rightwards double arrow (U+21D2)
  '⇐': '<=', // Leftwards double arrow (U+21D0)
  '⇔': '<=>', // Left right double arrow (U+21D4)
  '↗': '^->', // North east arrow (U+2197)
  '↘': 'v->', // South east arrow (U+2198)
  '↙': '<-v', // South west arrow (U+2199)
  '↖': '<-^', // North west arrow (U+2196)

  // Greek letters not in Windows-1252
  α: 'alpha', // Greek small alpha (U+03B1)
  β: 'beta', // Greek small beta (U+03B2)
  γ: 'gamma', // Greek small gamma (U+03B3)
  δ: 'delta', // Greek small delta (U+03B4)
  ε: 'epsilon', // Greek small epsilon (U+03B5)
  ζ: 'zeta', // Greek small zeta (U+03B6)
  η: 'eta', // Greek small eta (U+03B7)
  θ: 'theta', // Greek small theta (U+03B8)
  λ: 'lambda', // Greek small lambda (U+03BB)
  μ: 'mu', // Greek small mu (U+03BC)
  π: 'pi', // Greek small pi (U+03C0)
  ρ: 'rho', // Greek small rho (U+03C1)
  σ: 'sigma', // Greek small sigma (U+03C3)
  τ: 'tau', // Greek small tau (U+03C4)
  φ: 'phi', // Greek small phi (U+03C6)
  ψ: 'psi', // Greek small psi (U+03C8)
  ω: 'omega', // Greek small omega (U+03C9)
  Δ: 'Delta', // Greek capital delta (U+0394)
  Σ: 'Sigma', // Greek capital sigma (U+03A3)
  Π: 'Pi', // Greek capital pi (U+03A0)
  Ω: 'Omega', // Greek capital omega (U+03A9)

  // Superscripts and subscripts
  '⁰': '^0', // Superscript zero (U+2070)
  '¹': '^1', // Superscript one (U+00B9) - In Win-1252
  '²': '^2', // Superscript two (U+00B2) - In Win-1252
  '³': '^3', // Superscript three (U+00B3) - In Win-1252
  '⁴': '^4', // Superscript four (U+2074)
  '⁵': '^5', // Superscript five (U+2075)
  '⁶': '^6', // Superscript six (U+2076)
  '⁷': '^7', // Superscript seven (U+2077)
  '⁸': '^8', // Superscript eight (U+2078)
  '⁹': '^9', // Superscript nine (U+2079)
  '₀': '_0', // Subscript zero (U+2080)
  '₁': '_1', // Subscript one (U+2081)
  '₂': '_2', // Subscript two (U+2082)
  '₃': '_3', // Subscript three (U+2083)
  '₄': '_4', // Subscript four (U+2084)
  '₅': '_5', // Subscript five (U+2085)
  '₆': '_6', // Subscript six (U+2086)
  '₇': '_7', // Subscript seven (U+2087)
  '₈': '_8', // Subscript eight (U+2088)
  '₉': '_9', // Subscript nine (U+2089)

  // Special punctuation and symbols
  // '°' Degree sign (U+00B0) - in Win-1252, passes through unchanged
  // '·' Middle dot (U+00B7) - in Win-1252, passes through unchanged
  '…': '...', // Horizontal ellipsis (U+2026)
  '•': '*', // Bullet (U+2022) - In Win-1252 at 0x95
  '–': '-', // En dash (U+2013) - In Win-1252
  '—': '--', // Em dash (U+2014) - In Win-1252
  '\u2018': "'", // Left single quote (U+2018) - In Win-1252
  '\u2019': "'", // Right single quote (U+2019) - In Win-1252
  '\u201C': '"', // Left double quote (U+201C) - In Win-1252
  '\u201D': '"', // Right double quote (U+201D) - In Win-1252
  '‚': ',', // Single low-9 quote (U+201A) - In Win-1252
  '„': ',,', // Double low-9 quote (U+201E) - In Win-1252
  '‹': '<', // Single left angle quote (U+2039) - In Win-1252
  '›': '>', // Single right angle quote (U+203A) - In Win-1252
  '†': '+', // Dagger (U+2020) - In Win-1252
  '‡': '++', // Double dagger (U+2021) - In Win-1252
  '‰': 'o/oo', // Per mille (U+2030) - In Win-1252
  '′': "'", // Prime (U+2032)
  '″': '"', // Double prime (U+2033)
  '‴': "'''", // Triple prime (U+2034)
  '※': '*', // Reference mark (U+203B)
  '℃': 'C', // Degree Celsius (U+2103)
  '℉': 'F', // Degree Fahrenheit (U+2109)
  ºC: 'C', // Masculine ordinal + C (sometimes used for celsius)
  ºF: 'F', // Masculine ordinal + F (sometimes used for fahrenheit)

  // Box drawing and blocks
  '█': '#', // Full block (U+2588)
  '▓': '#', // Dark shade (U+2593)
  '▒': '#', // Medium shade (U+2592)
  '░': '.', // Light shade (U+2591)
  '▀': '-', // Upper half block (U+2580)
  '▄': '_', // Lower half block (U+2584)
  '■': '[#]', // Black square (U+25A0)
  '□': '[ ]', // White square (U+25A1)
  '▪': '*', // Black small square (U+25AA)
  '▫': '*', // White small square (U+25AB)
  '●': '(o)', // Black circle (U+25CF)
  '○': '( )', // White circle (U+25CB)
  '◆': '<>', // Black diamond (U+25C6)
  '◇': '<>', // White diamond (U+25C7)
  '★': '*', // Black star (U+2605)
  '☆': '*', // White star (U+2606)
  '♠': 'spades', // Black spade suit (U+2660)
  '♣': 'clubs', // Black club suit (U+2663)
  '♥': 'hearts', // Black heart suit (U+2665)
  '♦': 'diamonds', // Black diamond suit (U+2666)

  // Common emojis and emoticons (with text equivalents)
  '😀': ':)', // Grinning face (U+1F600)
  '😃': ':)', // Grinning face with big eyes (U+1F603)
  '😄': ':D', // Grinning face with smiling eyes (U+1F604)
  '😊': ':)', // Smiling face with smiling eyes (U+1F60A)
  '🙂': ':)', // Slightly smiling face (U+1F642)
  '😉': ';)', // Winking face (U+1F609)
  '😂': ':D', // Face with tears of joy (U+1F602)
  '😅': ':)', // Grinning face with sweat (U+1F605)
  '😆': 'XD', // Grinning squinting face (U+1F606)
  '😇': ':)', // Smiling face with halo (U+1F607)
  '😍': '<3', // Smiling face with heart-eyes (U+1F60D)
  '😎': '8)', // Smiling face with sunglasses (U+1F60E)
  '😢': ':(', // Crying face (U+1F622)
  '😭': ":'(", // Loudly crying face (U+1F62D)
  '😞': ':(', // Disappointed face (U+1F61E)
  '😔': ':(', // Pensive face (U+1F614)
  '😕': ':/', // Confused face (U+1F615)
  '😡': '>:(', // Pouting face (U+1F621)
  '😠': '>:(', // Angry face (U+1F620)
  '🤔': '?', // Thinking face (U+1F914)
  '🙄': '-_-', // Face with rolling eyes (U+1F644)
  '👍': '+1', // Thumbs up (U+1F44D)
  '👎': '-1', // Thumbs down (U+1F44E)
  '✓': 'v', // Check mark (U+2713)
  '✔': 'v', // Heavy check mark (U+2714)
  '✗': 'x', // Ballot X (U+2717)
  '✘': 'x', // Heavy ballot X (U+2718)
};

/**
 * Does every embedded face render this string?
 *
 * A single-character replacement is pointless once the font has the glyph — and
 * actively harmful, since it turns a correct `—` into `--`. Multi-character keys
 * (emoji sequences) are always replaced: coverage is checked per codepoint and a
 * sequence is about more than glyph presence.
 */
function embeddedFontRenders(char: string): boolean {
  const codepoints = [...char].map((c) => c.codePointAt(0) ?? 0);
  if (codepoints.length !== 1) return false;
  const cp = codepoints[0] ?? 0;
  return EMBEDDED_FONT_COVERAGE.some(([start, end]) => cp >= start && cp <= end);
}

/**
 * Visible stand-in for a codepoint the embedded faces have no glyph for at
 * all (CJK, Arabic, Hebrew, Cyrillic, ...). U+FFFD would be the conventional
 * choice, but it is not itself in `EMBEDDED_FONT_COVERAGE` — using it would
 * just swap one glyph-less codepoint for another, and jsPDF would drop it
 * from the content stream exactly like the character it replaced. '?' is
 * ASCII, always covered by the embedded faces, and unmistakably reads as
 * "something was lost here" instead of a blank page.
 */
export const UNSUPPORTED_SCRIPT_PLACEHOLDER = '?';

/**
 * Greek and Coptic block (U+0370-U+03FF): covers the letters
 * `PDF_CHARACTER_REPLACEMENTS` transliterates (as math symbols) plus every
 * other Greek letter the map doesn't cover.
 */
const GREEK_LETTER = /[Ͱ-Ͽ]/;

/**
 * Transliterate a Greek letter to its English name ONLY when it is isolated
 * -- a stray math/physics symbol (`α` in a formula) with no other Greek
 * letter next to it. A letter adjacent to another Greek letter is part of a
 * word, i.e. Greek prose, and must be left alone: `sanitizeTextForPDF`'s
 * generic uncovered-codepoint pass (below) then degrades the whole word to
 * the visible unsupported-script placeholder instead of this function
 * silently rewriting it into unreadable English fragments
 * (`'Καλημέρα'` -> `'Κalphalambdaetamuέrhoalpha'` was the bug this fixes).
 * Letters the replacement map doesn't cover (κ, ά, most capitals, ...) were
 * never touched by the old blind loop either -- they already fell through to
 * the placeholder pass, so this only changes behavior for the mapped subset.
 */
function transliterateIsolatedGreekLetters(text: string): string {
  return text.replace(/[Ͱ-Ͽ]/g, (match: string, offset: number, str: string) => {
    const prev = str[offset - 1];
    const next = str[offset + 1];
    const prevIsGreek = prev !== undefined && GREEK_LETTER.test(prev);
    const nextIsGreek = next !== undefined && GREEK_LETTER.test(next);
    const isolated = !prevIsGreek && !nextIsGreek;
    if (!isolated) return match;
    return PDF_CHARACTER_REPLACEMENTS[match] ?? match;
  });
}

/**
 * Apply character replacements to text for PDF compatibility
 * First replaces known characters (including emojis) with safe equivalents,
 * then strips any remaining emojis that don't have a good replacement
 */
export function sanitizeTextForPDF(text: string, onUnsupportedScript?: () => void): string {
  // First apply character replacements (including emojis with text equivalents)
  // Sort by length (longest first) to handle multi-character sequences properly
  // Greek letters are excluded here -- they go through
  // transliterateIsolatedGreekLetters() below instead, which is context-aware.
  const sortedReplacements = Object.entries(PDF_CHARACTER_REPLACEMENTS)
    .filter(([char]) => !GREEK_LETTER.test(char))
    .sort(([a], [b]) => b.length - a.length);

  let sanitized = transliterateIsolatedGreekLetters(text);
  for (const [char, replacement] of sortedReplacements) {
    // R-2b: skip anything the embedded fonts actually render. This map exists
    // because jsPDF's built-in fonts are WinAnsi-only; with Source Sans 3 and
    // IBM Plex Mono embedded, most of it is now a downgrade rather than a fix.
    // Coverage is read from the fonts' own cmap, so it tracks the subset instead
    // of a hardcoded guess.
    if (embeddedFontRenders(char)) continue;

    // Escape special regex characters
    const escapedChar = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    sanitized = sanitized.replace(new RegExp(escapedChar, 'g'), replacement);
  }

  // Then strip any remaining emojis that weren't in our replacement map
  sanitized = stripRemainingEmojis(sanitized);

  // EXP-2: anything still uncovered by the embedded faces (CJK, Arabic,
  // Hebrew, Cyrillic, ...) would otherwise reach jsPDF as a codepoint with no
  // cmap entry and vanish from the content stream — no glyph, no error, no
  // trace, an entire non-Latin conversation exporting as blank pages while
  // reporting success. Map it to a visible placeholder instead, one codepoint
  // at a time, reusing the same `embeddedFontRenders()` check the replacement
  // loop above uses rather than a second coverage table. Control characters
  // (tab, newline, ...) are left alone — they carry no glyph to lose and this
  // function otherwise only ever sees them pre-split onto their own lines.
  let sawUnsupported = false;
  sanitized = [...sanitized]
    .map((char) => {
      const cp = char.codePointAt(0) ?? 0;
      if (cp < 0x20 || embeddedFontRenders(char)) return char;
      sawUnsupported = true;
      return UNSUPPORTED_SCRIPT_PLACEHOLDER;
    })
    .join('');
  if (sawUnsupported) onUnsupportedScript?.();

  return sanitized;
}

/**
 * Remove emojis that weren't replaced by the character mapping
 * This catches any emojis that don't have good text equivalents
 */
function stripRemainingEmojis(text: string): string {
  // Remove emojis and other special Unicode characters
  // This regex removes most emoji and special symbols
  return text.replace(
    /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{231A}-\u{231B}]|[\u{23E9}-\u{23EC}]|[\u{23F0}]|[\u{23F3}]|[\u{25FD}-\u{25FE}]|[\u{2614}-\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}-\u{26AB}]|[\u{26BD}-\u{26BE}]|[\u{26C4}-\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}-\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2705}]|[\u{270A}-\u{270B}]|[\u{2728}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2795}-\u{2797}]|[\u{27B0}]|[\u{27BF}]|[\u{2B1B}-\u{2B1C}]|[\u{2B50}]|[\u{2B55}]/gu,
    ''
  );
}
