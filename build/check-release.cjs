#!/usr/bin/env node
/**
 * Release-config checks, run in CI and via `make validate`.
 *
 * `version`  — package.json and manifests/manifest.base.json must agree on
 *              the extension version. They match today by luck; this makes
 *              drift a hard failure instead of a silent release bug.
 * `manifest` — the built chrome/firefox manifests (dist/*\/manifest.json)
 *              must actually diverge where the two platforms require it:
 *              Chrome MV3 uses a service_worker string; Firefox uses a
 *              scripts array plus browser_specific_settings.gecko. Run this
 *              after `pnpm build`.
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');

const ROOT = resolve(__dirname, '..');

function readJson(relPath) {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), 'utf-8'));
}

function checkVersion() {
  const pkgVersion = readJson('package.json').version;
  const manifestVersion = readJson('manifests/manifest.base.json').version;
  if (pkgVersion !== manifestVersion) {
    console.error(
      `Version mismatch: package.json is "${pkgVersion}" but ` +
        `manifests/manifest.base.json is "${manifestVersion}". ` +
        'Keep both in sync (see docs/dev/releasing.md step 1).'
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Version sync OK: ${pkgVersion}`);
}

function checkManifestDivergence() {
  let chrome, firefox;
  try {
    chrome = readJson('dist/chrome/manifest.json');
    firefox = readJson('dist/firefox/manifest.json');
  } catch (err) {
    console.error(`Could not read built manifests — run 'pnpm build' first. (${err.message})`);
    process.exitCode = 1;
    return;
  }

  const errors = [];
  if (typeof chrome.background?.service_worker !== 'string') {
    errors.push(
      'dist/chrome/manifest.json: background.service_worker must be a string (MV3 service worker).'
    );
  }
  if (chrome.browser_specific_settings) {
    errors.push(
      'dist/chrome/manifest.json: must not carry browser_specific_settings (that block is Firefox-only).'
    );
  }
  if (!Array.isArray(firefox.background?.scripts)) {
    errors.push(
      'dist/firefox/manifest.json: background.scripts must be an array (Firefox background-script format).'
    );
  }
  if (!firefox.browser_specific_settings?.gecko?.id) {
    errors.push('dist/firefox/manifest.json: browser_specific_settings.gecko.id is required.');
  }

  if (errors.length > 0) {
    console.error('Chrome/Firefox manifests did not diverge as expected:\n' + errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('Manifest divergence OK: chrome uses service_worker, firefox uses scripts[] + gecko settings.');
}

const mode = process.argv[2];
if (mode === 'version') {
  checkVersion();
} else if (mode === 'manifest') {
  checkManifestDivergence();
} else {
  console.error('Usage: node build/check-release.cjs <version|manifest>');
  process.exitCode = 2;
}
