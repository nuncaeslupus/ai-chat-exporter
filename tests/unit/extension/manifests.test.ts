import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

interface Manifest {
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

// Every array in the manifests that gates the extension on a host.
const hostArrays: [string, string[]][] = [
  ['base host_permissions', base.host_permissions ?? []],
  ['base content_scripts[0].matches', base.content_scripts?.[0].matches ?? []],
  [
    'chrome web_accessible_resources[0].matches',
    chrome.web_accessible_resources?.[0].matches ?? [],
  ],
  [
    'firefox web_accessible_resources[0].matches',
    firefox.web_accessible_resources?.[0].matches ?? [],
  ],
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
