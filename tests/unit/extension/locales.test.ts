/**
 * Locale parity and i18n key hygiene.
 *
 * Three things rot silently and none of them fail a build:
 *   1. a key added to `en` alone renders as the raw key for six locales;
 *   2. a key the popup *uses* but nobody declared renders as empty text;
 *   3. a key nobody uses any more just sits there getting translated forever.
 * Plus `$1` placeholders, which a translator can drop without anyone noticing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

const LOCALES = ['ca', 'de', 'en', 'es', 'fr', 'it', 'pt'] as const;

const ROOT = resolve(__dirname, '../../..');
const POPUP_HTML = join(ROOT, 'src/extension/popup/popup.html');

interface Message {
  message: string;
}

function bundle(locale: string): Record<string, Message> {
  return JSON.parse(
    readFileSync(join(ROOT, `_locales/${locale}/messages.json`), 'utf-8')
  ) as Record<string, Message>;
}

function keysOf(locale: string): string[] {
  return Object.keys(bundle(locale)).sort();
}

function read(path: string): string {
  return readFileSync(path, 'utf-8');
}

/** Every `.ts` under `src/`, so a key referenced anywhere counts as used. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const SOURCE = [
  ...tsFiles(join(ROOT, 'src')).map(read),
  read(POPUP_HTML),
  read(join(ROOT, 'manifests/manifest.base.json')),
].join('\n');

/**
 * Keys built at runtime rather than written out, so no literal exists to grep:
 * `getPlatformName` / `getRoleName` in `src/shared/i18n.ts` compose
 * `platform<Id>` / `role<Id>` from the platform id.
 */
const DYNAMIC_KEY_PREFIXES = ['platform', 'role'];

/**
 * Values of the small `Record<X, string>` key maps that funnel getMessage()
 * through a variable instead of a literal (`getMetadataLabel`'s local
 * `keyMap`, popup.ts's `FORMAT_NAME_KEYS`/`PIECE_LABEL_KEYS`) — the
 * literal-call regex below can't see through `getMessage(keyMap[field])`,
 * so those maps' declared values are collected separately.
 */
const KEY_MAP_NAMES = ['keyMap', 'FORMAT_NAME_KEYS', 'PIECE_LABEL_KEYS'];

function keyMapValues(): string[] {
  const blocks = KEY_MAP_NAMES.flatMap((name) => [
    ...SOURCE.matchAll(new RegExp(`\\b${name}[^={]*=\\s*{([^}]*)}`, 'g')),
  ]);
  return blocks.flatMap((block) =>
    [...(block[1] ?? '').matchAll(/:\s*'([a-zA-Z][a-zA-Z0-9]*)'/g)].map((m) => m[1]!)
  );
}

/**
 * Keys the extension asks for by name, anywhere in `src/**\/*.ts` or
 * popup.html — the set that must exist or render empty. Widened from a
 * popup.html/popup.ts-only scan (which let a typo'd key at any other call
 * site — base-exporter.ts, pdf-exporter.ts, service-worker.ts, ... — render
 * the raw key text into every export with the whole suite staying green).
 */
function popupKeys(): string[] {
  return [
    ...[...SOURCE.matchAll(/data-i18n(?:-label)?="([^"]+)"/g)].flatMap((m) => m[1] ?? []),
    ...[...SOURCE.matchAll(/getMessage(?:WithValues)?\(\s*'([^']+)'/g)].flatMap((m) => m[1] ?? []),
    ...keyMapValues(),
  ];
}

function isReferenced(key: string): boolean {
  if (DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  if (SOURCE.includes(`__MSG_${key}__`)) return true;
  return new RegExp(`["'\`]${key}["'\`]`).test(SOURCE);
}

describe('_locales bundles', () => {
  const reference = keysOf('en');

  it.each(LOCALES)('%s defines exactly the same message keys as en', (locale) => {
    expect(keysOf(locale)).toEqual(reference);
  });

  it('declares every key the popup asks for', () => {
    const declared = new Set(reference);
    expect([...new Set(popupKeys())].filter((key) => !declared.has(key))).toEqual([]);
  });

  it('declares no key the extension never references', () => {
    expect(reference.filter((key) => !isReferenced(key))).toEqual([]);
  });

  it.each(LOCALES)('%s keeps the same $n placeholders as en', (locale) => {
    const en = bundle('en');
    const translated = bundle(locale);
    const placeholders = (text: string): string[] => (text.match(/\$\d/g) ?? []).sort();

    // A key missing entirely is the parity test's job, not this one.
    const drift = Object.entries(en)
      .filter(([key, reference]) => {
        const candidate = translated[key];
        return (
          candidate !== undefined &&
          placeholders(candidate.message).join() !== placeholders(reference.message).join()
        );
      })
      .map(([key]) => key);
    expect(drift).toEqual([]);
  });
});
