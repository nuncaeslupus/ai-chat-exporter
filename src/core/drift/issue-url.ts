/**
 * Prefills the "Copy & report" issue link so it arrives titled and
 * self-explanatory instead of blank.
 *
 * The extension still posts nothing — the full report is copied to the
 * clipboard by the caller, this only builds the URL. A full structural dump
 * is several KB; naively stuffing it into `body=` can blow past what
 * browsers/servers accept for a URL and produce a mangled issue, which is
 * worse than the empty one this replaces. So the full report is inlined only
 * when the resulting URL comfortably fits `MAX_ISSUE_URL_LENGTH`; otherwise
 * the body carries just the (small, fixed-size) metadata and an instruction
 * to paste the clipboard contents below it.
 */

import type { DriftReport } from './types';

/**
 * Conservative budget for the whole generated URL, in characters. GitHub's
 * form itself tolerates more, but proxies/servers in front of it commonly cap
 * request-line/header length around 8KB — this stays well under that with
 * room for the fixed `https://…/issues/new?title=…&body=…&labels=…` scaffolding.
 */
export const MAX_ISSUE_URL_LENGTH = 6000;

/** Label applied so these are triageable; must already exist in the repo. */
const REPORT_LABEL = 'drift-report';

function metadataBlock(report: DriftReport): string {
  return [
    `platform:    ${report.platform}`,
    `version:     ${report.extensionVersion} (${report.buildTarget})`,
    `detected:    ${report.detectedAt}`,
    `fingerprint: ${report.fingerprint}`,
  ].join('\n');
}

function buildUrl(trackerUrl: string, title: string, body: string): string {
  const params = new URLSearchParams({ title, body, labels: REPORT_LABEL });
  return `${trackerUrl}?${params.toString()}`;
}

/**
 * Builds the prefilled issue URL. `reportText` is the same string already
 * written to the clipboard (see `formatDriftReport`); it is inlined here only
 * when it fits the budget, never as a lossy substitute for the clipboard copy.
 */
export function buildDriftIssueUrl(
  report: DriftReport,
  reportText: string,
  trackerUrl: string
): string {
  const title = `drift: ${report.platform} page structure (${report.extensionVersion})`;
  const metadata = metadataBlock(report);

  const fullBody = `${metadata}\n\n${reportText}`;
  const fullUrl = buildUrl(trackerUrl, title, fullBody);
  if (fullUrl.length <= MAX_ISSUE_URL_LENGTH) return fullUrl;

  const shortBody = [
    'Paste the report from your clipboard below this line — it was already',
    'copied when you clicked "Copy & report".',
    '',
    metadata,
    '',
    '---',
    '',
  ].join('\n');
  return buildUrl(trackerUrl, title, shortBody);
}
