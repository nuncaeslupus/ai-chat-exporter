/**
 * Locale parity.
 *
 * Every new UI string has to land in all seven `_locales/*` bundles; a key
 * added to `en` alone renders as the raw key for six of them. This is the
 * cheapest check that catches it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const LOCALES = ['ca', 'de', 'en', 'es', 'fr', 'it', 'pt'] as const;

function keysOf(locale: string): string[] {
  const path = resolve(__dirname, `../../../_locales/${locale}/messages.json`);
  return Object.keys(JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>).sort();
}

describe('_locales bundles', () => {
  const reference = keysOf('en');

  it.each(LOCALES)('%s defines exactly the same message keys as en', (locale) => {
    expect(keysOf(locale)).toEqual(reference);
  });
});
