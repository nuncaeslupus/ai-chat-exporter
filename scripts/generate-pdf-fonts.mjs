/**
 * Generate the base64 font module the PDF exporter embeds (R-2b).
 *
 * jsPDF's `addFileToVFS` needs TrueType. `@fontsource` ships woff/woff2 only, so
 * each face is decompressed back to its sfnt with `wawoff2` — woff2 is a
 * container around the same TrueType tables, so this is a lossless unwrap, not a
 * re-encode.
 *
 * The output is NOT committed. Fonts arrive as versioned dependencies and the
 * base64 is derived from them at build time, so there are no font bytes in git
 * and no licence provenance tracked by hand. `pnpm prebuild` / `pretest` run this.
 *
 * Only the four faces the exporter actually calls `setFont` with are emitted —
 * body normal/bold/italic and code normal. Adding a fifth means adding a
 * `setFont` call that needs it.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import wawoff2 from 'wawoff2';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/core/exporters/pdf-fonts.generated.ts');

/** jsPDF identifies a face by (family, style); these are the four we register. */
const FACES = [
  {
    constant: 'SOURCE_SANS_3_NORMAL',
    file: '@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff2',
    vfs: 'SourceSans3-Regular.ttf',
    family: 'SourceSans3',
    style: 'normal',
  },
  {
    constant: 'SOURCE_SANS_3_BOLD',
    file: '@fontsource/source-sans-3/files/source-sans-3-latin-600-normal.woff2',
    vfs: 'SourceSans3-SemiBold.ttf',
    family: 'SourceSans3',
    style: 'bold',
  },
  {
    constant: 'SOURCE_SANS_3_ITALIC',
    file: '@fontsource/source-sans-3/files/source-sans-3-latin-400-italic.woff2',
    vfs: 'SourceSans3-Italic.ttf',
    family: 'SourceSans3',
    style: 'italic',
  },
  {
    constant: 'IBM_PLEX_MONO_NORMAL',
    file: '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
    vfs: 'IBMPlexMono-Regular.ttf',
    family: 'IBMPlexMono',
    style: 'normal',
  },
];


/**
 * Codepoint ranges an sfnt's cmap covers (format 4 and 12).
 *
 * Emitted so the PDF's character transliteration can ask what the embedded font
 * actually renders instead of assuming Windows-1252. Hardcoding a list would
 * rot the moment a font version changes its subset.
 */
function cmapRanges(sfnt) {
  const numTables = sfnt.readUInt16BE(4);
  let cmapOff = 0;
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    if (sfnt.subarray(o, o + 4).toString('latin1') === 'cmap') cmapOff = sfnt.readUInt32BE(o + 8);
  }
  if (!cmapOff) return [];

  const n = sfnt.readUInt16BE(cmapOff + 2);
  let fmt4 = 0;
  let fmt12 = 0;
  for (let i = 0; i < n; i++) {
    const o = cmapOff + 4 + i * 8;
    const off = cmapOff + sfnt.readUInt32BE(o + 4);
    const format = sfnt.readUInt16BE(off);
    if (format === 4 && !fmt4) fmt4 = off;
    if (format === 12) fmt12 = off;
  }

  const ranges = [];
  if (fmt12) {
    const groups = sfnt.readUInt32BE(fmt12 + 12);
    for (let i = 0; i < groups; i++) {
      const o = fmt12 + 16 + i * 12;
      ranges.push([sfnt.readUInt32BE(o), sfnt.readUInt32BE(o + 4)]);
    }
    return ranges;
  }
  if (fmt4) {
    const segX2 = sfnt.readUInt16BE(fmt4 + 6);
    for (let i = 0; i < segX2 / 2; i++) {
      const end = sfnt.readUInt16BE(fmt4 + 14 + i * 2);
      const start = sfnt.readUInt16BE(fmt4 + 16 + segX2 + i * 2);
      if (start <= end && start !== 0xffff) ranges.push([start, end]);
    }
  }
  return ranges;
}

/** A codepoint every face renders — the intersection, since all four are used. */
function intersectCoverage(perFace) {
  const covered = (ranges, cp) => ranges.some(([a, b]) => cp >= a && cp <= b);
  const lo = Math.min(...perFace.flat(1).map(([a]) => a));
  const hi = Math.max(...perFace.flat(1).map(([, b]) => b));
  const out = [];
  let start = null;
  for (let cp = lo; cp <= Math.min(hi, 0xffff); cp++) {
    const all = perFace.every((r) => covered(r, cp));
    if (all && start === null) start = cp;
    if (!all && start !== null) {
      out.push([start, cp - 1]);
      start = null;
    }
  }
  if (start !== null) out.push([start, Math.min(hi, 0xffff)]);
  return out;
}

/** woff2 -> TrueType sfnt, asserting the result really is TrueType. */
async function toTrueType(relativePath) {
  const buffer = await readFile(resolve(ROOT, 'node_modules', relativePath));
  const sfnt = Buffer.from(await wawoff2.decompress(buffer));
  const tag = sfnt.subarray(0, 4).toString('hex');
  if (tag !== '00010000') {
    throw new Error(`${relativePath}: expected a TrueType sfnt, got tag 0x${tag}`);
  }
  return sfnt;
}

const entries = [];
const perFaceRanges = [];
let total = 0;
for (const face of FACES) {
  const sfnt = await toTrueType(face.file);
  total += sfnt.length;
  perFaceRanges.push(cmapRanges(sfnt));
  entries.push({ ...face, base64: sfnt.toString('base64') });
}
const coverage = intersectCoverage(perFaceRanges);

const body = entries
  .map(
    (e) => `  {
    vfsName: '${e.vfs}',
    family: '${e.family}',
    style: '${e.style}',
    base64:
      '${e.base64}',
  },`
  )
  .join('\n');

const source = `/* eslint-disable */
/**
 * GENERATED by scripts/generate-pdf-fonts.mjs — do not edit, do not commit.
 *
 * Base64 TrueType for the faces the PDF exporter embeds. Regenerate with
 * \`pnpm generate:pdf-fonts\`; it runs automatically before build and test.
 */

export interface EmbeddedFont {
  /** Name inside jsPDF's virtual file system. */
  vfsName: string;
  /** Family passed to \`doc.setFont(family, style)\`. */
  family: string;
  /** jsPDF style slot: 'normal' | 'bold' | 'italic'. */
  style: string;
  /** The TrueType file, base64-encoded. */
  base64: string;
}

export const EMBEDDED_FONTS: EmbeddedFont[] = [
${body}
];

/**
 * Inclusive codepoint ranges every embedded face renders.
 *
 * The INTERSECTION across all four: a character only survives if body
 * normal/bold/italic and the mono face all have it, since any of them may be
 * selected when it is drawn.
 */
export const EMBEDDED_FONT_COVERAGE: readonly (readonly [number, number])[] = [
${coverage.map(([a, b]) => `  [${a}, ${b}],`).join('\n')}
];
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, source, 'utf-8');
console.log(
  `generate-pdf-fonts: ${String(entries.length)} faces, ${String(Math.round(total / 1024))} KB TrueType, ` +
    `${String(coverage.length)} covered ranges -> ${OUT}`
);
