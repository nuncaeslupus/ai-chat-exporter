import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

interface Manifest {
  name?: string;
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: { matches: string[]; js?: string[] }[];
  web_accessible_resources?: { resources?: string[]; matches: string[] }[];
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

// D-28. Every content script is a one-line loader that `import()`s its real
// module out of `assets/` (see build/vite.content.ts). Chrome refuses that
// import unless `assets/*` is web-accessible **to the origin the loader is
// running on** -- so a host listed under `content_scripts` but missing from
// `web_accessible_resources[].matches` gets a script that loads and then dies
// with "Failed to fetch dynamically imported module".
//
// That is exactly how ChatGPT Deep Research broke: the sandboxed iframe host
// `https://*.web-sandbox.oaiusercontent.com/*` was added to `content_scripts`
// for the frame reader but never to `web_accessible_resources`, so the reader
// never ran and every export silently fell back to the placeholder. The build
// still succeeded and every other test still passed.
//
// The old assertions here only checked `content_scripts[0]` and only for
// Gemini/Bard, so neither the second entry nor this coupling was covered.
describe('web_accessible_resources covers every content-script host', () => {
  const perBrowser: [string, Manifest][] = [
    ['chrome', chrome],
    ['firefox', firefox],
  ];

  it.each(perBrowser)('%s exposes assets/* to all content-script hosts', (_name, browser) => {
    const [, scriptHosts] = must(
      'base content_scripts matches (all entries)',
      base.content_scripts?.flatMap((entry) => entry.matches)
    );
    const assetEntry = browser.web_accessible_resources?.find((entry) =>
      entry.resources?.includes('assets/*')
    );
    if (assetEntry === undefined) {
      throw new Error('no web_accessible_resources entry exposes assets/*');
    }

    expect(scriptHosts.length).toBeGreaterThan(1);
    for (const host of scriptHosts) {
      expect(assetEntry.matches).toContain(host);
    }
  });

  // Named explicitly so a future manifest edit that drops it fails on the
  // reason rather than on an opaque set difference.
  it.each(perBrowser)('%s keeps the Deep Research sandbox host', (_name, browser) => {
    const assetEntry = browser.web_accessible_resources?.find((entry) =>
      entry.resources?.includes('assets/*')
    );
    expect(assetEntry?.matches).toContain('https://*.web-sandbox.oaiusercontent.com/*');
  });
});
