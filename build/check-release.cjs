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
 * `node`     — package.json's engines.node floor, the CI workflow's
 *              node-version, BUILD_INSTRUCTIONS.md's stated requirement,
 *              README.md and docs/dev/building.md must all agree, so none
 *              of the five can quietly drift apart.
 * `pipeline` — the package.json scripts a release runs must build before
 *              packaging and must clean dist/ before each target rebuilds.
 * `permissions` — every `permissions`/`host_permissions` entry in
 *              manifests/manifest.base.json must be justified in the store
 *              listing file for the version currently in the manifest
 *              (docs/store-listings/{chrome-web-store,firefox-addons}-v<version>.txt).
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');

const ROOT = process.env.CHECK_RELEASE_ROOT
  ? resolve(process.env.CHECK_RELEASE_ROOT)
  : resolve(__dirname, '..');

// Firefox bug 1811443 ("Support type: 'module'") landed in the 112 branch --
// background.type: "module" is a later feature than MV3 itself (109).
const FIREFOX_MODULE_BACKGROUND_MIN_VERSION = [112, 0, 0];

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
  if (firefox.background?.type === 'module') {
    const minVersion = firefox.browser_specific_settings?.gecko?.strict_min_version;
    if (!minVersion || compareVersions(parseVersion(minVersion), FIREFOX_MODULE_BACKGROUND_MIN_VERSION) < 0) {
      errors.push(
        `dist/firefox/manifest.json: background.type is "module", which requires ` +
          `Firefox >= 112.0 (bug 1811443), but strict_min_version is "${minVersion}". ` +
          'Update manifests/manifest.firefox.json.'
      );
    }
  }

  if (errors.length > 0) {
    console.error('Chrome/Firefox manifests did not diverge as expected:\n' + errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('Manifest divergence OK: chrome uses service_worker, firefox uses scripts[] + gecko settings.');
}

function parseVersion(str) {
  return str
    .split('.')
    .map(Number)
    .concat([0, 0])
    .slice(0, 3);
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function checkNode() {
  const engines = readJson('package.json').engines?.node;
  const enginesMatch = /^>=\s*(\d+(?:\.\d+){0,2})$/.exec(engines ?? '');
  if (!enginesMatch) {
    console.error(
      `Could not parse package.json engines.node ("${engines}"); expected a ">=X.Y.Z" floor.`
    );
    process.exitCode = 1;
    return;
  }
  const enginesFloor = parseVersion(enginesMatch[1]);

  const ciYml = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf-8');
  const ciMatch = /node-version:\s*['"]?([\d.]+)['"]?/.exec(ciYml);
  if (!ciMatch) {
    console.error('Could not find a node-version in .github/workflows/ci.yml.');
    process.exitCode = 1;
    return;
  }
  const ciVersion = parseVersion(ciMatch[1]);
  if (compareVersions(ciVersion, enginesFloor) < 0) {
    console.error(
      `CI node-version (${ciMatch[1]}) does not satisfy package.json engines.node ("${engines}").`
    );
    process.exitCode = 1;
    return;
  }

  const buildInstructions = readFileSync(resolve(ROOT, 'BUILD_INSTRUCTIONS.md'), 'utf-8');
  const buildMatch = /Node\.js\s*>=\s*(\d+(?:\.\d+){0,2})/i.exec(buildInstructions);
  if (!buildMatch) {
    console.error('Could not find a Node.js requirement in BUILD_INSTRUCTIONS.md.');
    process.exitCode = 1;
    return;
  }
  if (compareVersions(parseVersion(buildMatch[1]), enginesFloor) !== 0) {
    console.error(
      `BUILD_INSTRUCTIONS.md requires Node.js >= ${buildMatch[1]}, but package.json ` +
        `engines.node is "${engines}". Keep both in sync.`
    );
    process.exitCode = 1;
    return;
  }

  for (const docPath of ['README.md', 'docs/dev/building.md']) {
    const doc = readFileSync(resolve(ROOT, docPath), 'utf-8');
    const docMatch = /Node\.js\s*>=\s*(\d+(?:\.\d+){0,2})/i.exec(doc);
    if (!docMatch) {
      console.error(`Could not find a Node.js requirement in ${docPath}.`);
      process.exitCode = 1;
      return;
    }
    if (compareVersions(parseVersion(docMatch[1]), enginesFloor) !== 0) {
      console.error(
        `${docPath} requires Node.js >= ${docMatch[1]}, but package.json ` +
          `engines.node is "${engines}". Keep both in sync.`
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    `Node floor OK: engines.node="${engines}", CI node-version=${ciMatch[1]}, ` +
      'BUILD_INSTRUCTIONS.md, README.md and docs/dev/building.md agree.'
  );
}

/**
 * `pipeline` — the scripts a release actually runs must not skip steps a
 * developer relies on by hand: `package:all` must build before zipping
 * (BUILD-1), each browser target's dist/ must be wiped before it is
 * rebuilt so an emptyOutDir:false build can't leave orphaned chunks behind
 * (BUILD-1), and the shared content bundle should compile once per build,
 * not once per browser target (it is byte-identical either way).
 */
function checkPipeline() {
  const scripts = readJson('package.json').scripts ?? {};
  const errors = [];

  const packageAll = scripts['package:all'] ?? '';
  if (!/\bbuild\b[\s\S]*package-all\.cjs/.test(packageAll)) {
    errors.push(
      `package.json "package:all" ("${packageAll}") does not build before packaging -- ` +
        'a release would zip whatever dist/ already had, not the version being released ' +
        '(see docs/dev/releasing.md).'
    );
  }

  const buildContent = scripts['build:content'] ?? '';
  const viteBuildCount = (buildContent.match(/vite build/g) ?? []).length;
  if (viteBuildCount !== 1) {
    errors.push(
      `package.json "build:content" runs "vite build" ${String(viteBuildCount)} time(s); ` +
        'expected exactly 1 (build once, copy the byte-identical output to the other ' +
        'target) instead of recompiling it redundantly on every full `pnpm build`.'
    );
  }

  for (const target of ['chrome', 'firefox']) {
    const pre = scripts[`prebuild:${target}`] ?? '';
    if (!new RegExp(`rm\\s+-rf\\s+dist/${target}\\b`).test(pre)) {
      errors.push(
        `package.json "prebuild:${target}" ("${pre}") does not clean dist/${target} -- ` +
          'stale/orphaned chunks from earlier builds would ship into the store zip.'
      );
    }
  }

  if (errors.length > 0) {
    console.error('Build pipeline check failed:\n' + errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(
    'Build pipeline OK: package:all builds first, dist/ is cleaned before each target ' +
      'rebuilds, content bundle compiles once.'
  );
}

function checkPermissions() {
  const manifest = readJson('manifests/manifest.base.json');
  const version = manifest.version;
  const required = [...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])];

  const listings = [
    `docs/store-listings/chrome-web-store-v${version}.txt`,
    `docs/store-listings/firefox-addons-v${version}.txt`,
  ];

  const errors = [];
  for (const listingPath of listings) {
    let text;
    try {
      text = readFileSync(resolve(ROOT, listingPath), 'utf-8');
    } catch {
      errors.push(`${listingPath}: no store listing for the current manifest version (${version}).`);
      continue;
    }
    for (const entry of required) {
      // Host permissions are URL match patterns (e.g. "https://*.claude.ai/*");
      // only the bare host needs to appear in the listing prose, and a
      // leading wildcard subdomain is dropped too -- justification text
      // names the domain, not the glob.
      const needle = entry
        .replace(/^https?:\/\//, '')
        .replace(/\/\*$/, '')
        .replace(/^\*\./, '');
      if (!text.includes(needle)) {
        errors.push(`${listingPath}: missing justification for "${entry}".`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('Store listing permissions do not match the manifest:\n' + errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`Permissions OK: every manifest permission is justified in the v${version} listings.`);
}

/**
 * Keyword density in the store listings.
 *
 * This is the single most common reason the Chrome Web Store rejects this
 * extension. v1.3.0 was refused on 2026-09-06 (violation "Yellow Argon",
 * "Spam and Placement in the Store"), and the reviewer quoted this block back
 * verbatim:
 *
 *     • PDF - Paginated documents with page numbers, code highlighting ...
 *     • Markdown - Clean, readable text with full formatting support
 *     • Word - Microsoft Word documents with proper structure
 *     • HTML, JSON, Plain text
 *
 * Two rules come out of that, and this enforces both so the next listing
 * cannot reintroduce them by hand:
 *
 *  - No bullet that opens with a format name and then describes it. That
 *    enumerate-and-expand shape is what reads as a keyword list.
 *  - No format name more than MAX_MENTIONS times across the whole file. The
 *    reviewer counts the description as a whole, not one section.
 */
const FORMAT_WORDS = ['PDF', 'Markdown', 'Word', 'DOCX', 'HTML', 'JSON', 'TXT', 'plain text'];

/*
 * Measured, not guessed. Counting the description prose of every listing this
 * project has shipped:
 *
 *   v1.0.0  accepted   7 mentions total, most-used name 3x, 0 enumerate bullets
 *   v1.1.0             14                                  3
 *   v1.1.1             16                                  3
 *   v1.2.0             17               most-used name 5x, 3
 *   v1.3.0  REJECTED   (carried v1.2.0's block forward)
 *
 * The per-format bullet list entered in v1.1.0 and density climbed from there.
 * 4 sits above the accepted listing's 3 and below the rejected one's 5.
 */
const MAX_MENTIONS = 4;

function checkKeywords() {
  const version = readJson('manifests/manifest.base.json').version;
  const listings = [
    `docs/store-listings/chrome-web-store-v${version}.txt`,
    `docs/store-listings/firefox-addons-v${version}.txt`,
  ];

  const errors = [];
  for (const listingPath of listings) {
    let text;
    try {
      text = readFileSync(resolve(ROOT, listingPath), 'utf-8');
    } catch {
      errors.push(`${listingPath}: no store listing for the current manifest version (${version}).`);
      continue;
    }

    // The TAGS block is a keyword field by design -- the store asks for a
    // comma-separated list there. It is not part of the description prose.
    const prose = text.split(/^TAGS$/m)[0];

    for (const word of FORMAT_WORDS) {
      const hits = prose.match(new RegExp(word.replace(/ /g, '\\s+'), 'gi'))?.length ?? 0;
      if (hits > MAX_MENTIONS) {
        errors.push(
          `${listingPath}: "${word}" appears ${hits} times (max ${MAX_MENTIONS}). ` +
            'The store counts the description as a whole.'
        );
      }
    }

    for (const line of prose.split('\n')) {
      const bullet = /^\s*[•\-*]\s*(PDF|Markdown|Word|DOCX|HTML|JSON|TXT)\b\s*[-–—:]/i.exec(line);
      if (bullet) {
        errors.push(
          `${listingPath}: bullet describes a format by name -- ${JSON.stringify(line.trim().slice(0, 60))}. ` +
            'This exact shape was quoted in the "Yellow Argon" rejection.'
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error(
      'Store listing reads as keyword stuffing:\n' +
        errors.join('\n') +
        '\nSee docs/dev/releasing.md -- this is the top recurring rejection cause.'
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Keyword density OK: v${version} listings name each format sparingly.`);
}

const mode = process.argv[2];
if (mode === 'version') {
  checkVersion();
} else if (mode === 'manifest') {
  checkManifestDivergence();
} else if (mode === 'node') {
  checkNode();
} else if (mode === 'pipeline') {
  checkPipeline();
} else if (mode === 'permissions') {
  checkPermissions();
} else if (mode === 'keywords') {
  checkKeywords();
} else {
  console.error(
    'Usage: node build/check-release.cjs <version|manifest|node|pipeline|permissions|keywords>'
  );
  process.exitCode = 2;
}
