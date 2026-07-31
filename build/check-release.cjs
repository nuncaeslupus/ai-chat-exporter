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
 *              node-version, and BUILD_INSTRUCTIONS.md's stated requirement
 *              must all agree, so the three can't quietly drift apart.
 * `pipeline` — the package.json scripts a release runs must build before
 *              packaging and must clean dist/ before each target rebuilds.
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');

const ROOT = resolve(__dirname, '..');

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

  console.log(
    `Node floor OK: engines.node="${engines}", CI node-version=${ciMatch[1]}, ` +
      'BUILD_INSTRUCTIONS.md agrees.'
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

const mode = process.argv[2];
if (mode === 'version') {
  checkVersion();
} else if (mode === 'manifest') {
  checkManifestDivergence();
} else if (mode === 'node') {
  checkNode();
} else if (mode === 'pipeline') {
  checkPipeline();
} else {
  console.error('Usage: node build/check-release.cjs <version|manifest|node|pipeline>');
  process.exitCode = 2;
}
