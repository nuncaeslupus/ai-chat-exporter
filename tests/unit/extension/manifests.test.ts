import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

interface Manifest {
  name?: string;
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: { matches: string[] }[];
  web_accessible_resources?: { matches: string[] }[];
}

const rootDir = resolve(__dirname, '../../..');

function manifest(name: string): Manifest {
  return JSON.parse(readFileSync(resolve(rootDir, 'manifests', name), 'utf-8')) as Manifest;
}

const base = manifest('manifest.base.json');
const chrome = manifest('manifest.chrome.json');
const firefox = manifest('manifest.firefox.json');

// A missing array must fail loudly: defaulting to [] would let the "no legacy
// Bard" assertion pass vacuously on a manifest that lost the entry entirely.
function must(name: string, patterns: string[] | undefined): [string, string[]] {
  if (patterns === undefined) throw new Error(`manifest host array missing: ${name}`);
  return [name, patterns];
}

// Every array in the manifests that gates the extension on a host.
const hostArrays: [string, string[]][] = [
  must('base host_permissions', base.host_permissions),
  must('base content_scripts[0].matches', base.content_scripts?.[0]?.matches),
  must('chrome web_accessible_resources[0].matches', chrome.web_accessible_resources?.[0]?.matches),
  must(
    'firefox web_accessible_resources[0].matches',
    firefox.web_accessible_resources?.[0]?.matches
  ),
];

describe('manifest host patterns', () => {
  it.each(hostArrays)('%s includes Gemini', (_name, patterns) => {
    expect(patterns).toContain('https://gemini.google.com/*');
  });

  // Bard redirects to Gemini; no permission justification worth writing for it.
  it.each(hostArrays)('%s does not include legacy Bard', (_name, patterns) => {
    expect(patterns.some((p) => p.includes('bard.google.com'))).toBe(false);
  });
});

describe('manifest permissions', () => {
  // Without it `chrome.scripting.executeScript` is undefined at runtime and the
  // popup can only ever ask the user to reload the page by hand.
  it('declares scripting, which the missing-content-script recovery needs', () => {
    expect(base.permissions).toContain('scripting');
  });
});

describe('firefox manifest localized name', () => {
  it('does not override the base name with a hardcoded string', () => {
    // A hardcoded "name" here would win the build/vite.firefox.ts merge and
    // shadow __MSG_extensionName__, breaking localization for all locales.
    expect(firefox.name).toBeUndefined();
  });

  it('the built manifest uses the localized name after merging with base', () => {
    const merged = { ...base, ...firefox };
    expect(merged.name).toBe('__MSG_extensionName__');
  });
});
