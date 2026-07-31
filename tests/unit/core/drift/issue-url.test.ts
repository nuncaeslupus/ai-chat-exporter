/**
 * The prefilled issue URL. The two things that matter: it is titled from the
 * real report (not a hardcoded placeholder), and a realistic full-size dump
 * never blows the length budget — a truncated/mangled URL is worse than the
 * empty issue this replaces.
 */
import { describe, it, expect } from 'vitest';
import { buildDriftIssueUrl, MAX_ISSUE_URL_LENGTH } from '../../../../src/core/drift/issue-url';
import type { DriftReport } from '../../../../src/core/drift/types';

const TRACKER_URL = 'https://github.com/nuncaeslupus/ai-chat-exporter/issues/new';

const report: DriftReport = {
  fingerprint: '1pkkhkr6swnc',
  platform: 'claude',
  extensionVersion: '1.1.1',
  buildTarget: 'chrome',
  detectedAt: '2026-07-31',
  selectorFindings: [],
  sanityFindings: [{ rule: 'turns-dropped', detail: '2 pair(s) from 5 turn container(s)' }],
};

/**
 * A realistic-sized page skeleton, shaped like the real one attached to
 * https://github.com/nuncaeslupus/ai-chat-exporter/issues/220 (~12KB of
 * repeated nested divs with long Tailwind class lists) rather than a
 * three-line stub. Real reports are this big or bigger.
 */
function largeSkeletonFixture(): string {
  const turn = [
    'div[role="article"][tabindex][aria-setsize][aria-posinset][aria-label]',
    '  div[data-test-render-count]',
    '    div.group group/message-row[style]',
    '      div.contents',
    '        div.font-claude-response relative leading-[1.65rem] [&_pre>div]:bg-bg-000/50 [&_pre>div]:border-0.5 [&_pre>div]:border-border-400',
    '          text(342)',
    '        div.flex justify-start ml-0.5 opacity-0 group-hover:opacity-100[data-message-action-bar]',
    '          div.text-text-300',
    '            div.text-text-300 flex select-none items-stretch justify-between[role="toolbar"][aria-label]',
  ].join('\n');
  return Array.from({ length: 40 }, () => turn).join('\n');
}

describe('buildDriftIssueUrl', () => {
  it('titles the issue from the real platform and version, not a placeholder', () => {
    const url = buildDriftIssueUrl(report, 'a short report body', TRACKER_URL);
    const title = new URL(url).searchParams.get('title');

    expect(title).toBeTruthy();
    expect(title).toContain('claude');
    expect(title).toContain('1.1.1');
    expect(title).not.toBe('');
  });

  it('applies the drift-report label', () => {
    const url = buildDriftIssueUrl(report, 'a short report body', TRACKER_URL);
    expect(new URL(url).searchParams.get('labels')).toBe('drift-report');
  });

  it('stays under the length budget for a realistic large report, and does not truncate the report mid-stream into the URL', () => {
    const skeleton = largeSkeletonFixture();
    expect(skeleton.length).toBeGreaterThan(10_000); // realistic, per issue #220

    const url = buildDriftIssueUrl(report, skeleton, TRACKER_URL);

    expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
    // The body must not contain a truncated fragment of the skeleton - either
    // the whole thing is inlined (impossible here, it would blow the budget)
    // or none of it is.
    const body = new URL(url).searchParams.get('body') ?? '';
    expect(body).not.toContain('div[role="article"]');
  });

  it('tells the user to paste the clipboard contents when the report does not fit', () => {
    const skeleton = largeSkeletonFixture();
    const url = buildDriftIssueUrl(report, skeleton, TRACKER_URL);
    const body = new URL(url).searchParams.get('body') ?? '';

    expect(body.toLowerCase()).toContain('paste');
    expect(body).toContain(report.fingerprint);
  });

  it('inlines a small report in full when it comfortably fits the budget', () => {
    const skeleton = 'main#main\n  div[data-turn="user"]\n    text(12)';
    const url = buildDriftIssueUrl(report, skeleton, TRACKER_URL);
    const body = new URL(url).searchParams.get('body') ?? '';

    expect(body).toContain(skeleton);
    expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH);
  });
});
