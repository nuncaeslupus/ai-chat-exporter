/**
 * The report text. It is simultaneously the preview and the clipboard payload,
 * so its content-free-ness is user-verifiable: what they read is what they send.
 */
import { describe, it, expect } from 'vitest';
import { formatDriftReport } from '../../../../src/core/drift/format-report';
import type { DriftReport } from '../../../../src/core/drift/types';

const report: DriftReport = {
  fingerprint: 'a1b2c3d4',
  platform: 'chatgpt',
  extensionVersion: '1.2.0',
  buildTarget: 'chrome',
  detectedAt: '2026-07-29',
  selectorFindings: [
    { key: 'messageContent', selector: '.markdown.prose', matched: 0, required: true },
    { key: 'messageElement', selector: '[data-turn]', matched: 6, required: true },
    { key: 'custom.webSearch', selector: '.web-search', matched: 0, required: false },
  ],
  sanityFindings: [{ rule: 'content-shortfall', detail: 'pair 0: extracted 13 of 529 chars' }],
};

describe('formatDriftReport', () => {
  it('leads with the fingerprint so duplicates collapse in a tracker', () => {
    expect(formatDriftReport(report, null, 'https://chatgpt.com')).toMatch(/^drift a1b2c3d4/m);
  });

  it('lists only the failing required selectors under "not matching"', () => {
    const text = formatDriftReport(report, null, 'https://chatgpt.com');
    expect(text).toContain('messageContent');
    expect(text).toContain('.markdown.prose');
    // A required selector that DID match is not a failure and must not be listed
    // as one; a zero-match optional selector is not a failure either.
    const failing = text.split('not matching:')[1]?.split('\n\n')[0] ?? '';
    expect(failing).not.toContain('messageElement');
    expect(failing).not.toContain('custom.webSearch');
  });

  it('lists the sanity rules that fired', () => {
    const text = formatDriftReport(report, null, 'https://chatgpt.com');
    expect(text).toContain('content-shortfall');
    expect(text).toContain('extracted 13 of 529 chars');
  });

  it('includes the build identity but never a user agent', () => {
    const text = formatDriftReport(report, null, 'https://chatgpt.com');
    expect(text).toContain('1.2.0');
    expect(text).toContain('chrome');
    expect(text).not.toMatch(/Mozilla|AppleWebKit/);
  });

  it('carries the origin only, never a full conversation URL', () => {
    const text = formatDriftReport(report, null, 'https://chatgpt.com');
    expect(text).toContain('https://chatgpt.com');
    expect(text).not.toContain('/c/');
  });

  it('renders the skeleton when present', () => {
    const text = formatDriftReport(
      report,
      'main#main\n  div[data-turn="user"]',
      'https://chatgpt.com'
    );
    expect(text).toContain('div[data-turn="user"]');
  });

  it('says so explicitly when the skeleton is unavailable', () => {
    expect(formatDriftReport(report, null, 'https://chatgpt.com')).toContain('(not available)');
  });

  it('is English regardless of UI locale', () => {
    // No getMessage() call anywhere in the module — the report has one reader.
    const text = formatDriftReport(report, null, 'https://chatgpt.com');
    expect(text).toContain('page structure report');
  });
});
