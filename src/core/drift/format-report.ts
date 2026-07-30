/**
 * Renders a drift report into the single string that is both shown in the
 * preview and written to the clipboard.
 *
 * One function on purpose: "the preview is byte-identical to what is copied"
 * is only enforceable while there is exactly one place the text is produced.
 *
 * Deliberately English-only and free of `getMessage()`. This is a bug report
 * with one reader; a localised payload would be worse for that reader.
 */

import type { DriftReport } from './types';

export function formatDriftReport(
  report: DriftReport,
  skeleton: string | null,
  pageUrlOrigin: string
): string {
  const failing = report.selectorFindings.filter((f) => f.required && f.matched <= 0);

  const lines: string[] = [
    `drift ${report.fingerprint} — ${report.platform} page structure report`,
    '',
    `platform:  ${report.platform}`,
    `origin:    ${pageUrlOrigin}`,
    `version:   ${report.extensionVersion} (${report.buildTarget})`,
    `detected:  ${report.detectedAt}`,
    '',
    'Selectors not matching:',
  ];

  if (failing.length === 0) {
    lines.push('  (none — every required selector matched)');
  } else {
    for (const finding of failing) {
      const count = finding.matched < 0 ? 'invalid selector' : '0 matches';
      lines.push(`  ${finding.key}: ${finding.selector}  → ${count}`);
    }
  }

  lines.push('', 'Output checks that failed:');
  if (report.sanityFindings.length === 0) {
    lines.push('  (none)');
  } else {
    for (const finding of report.sanityFindings) {
      lines.push(`  ${finding.rule}: ${finding.detail}`);
    }
  }

  lines.push(
    '',
    'Page structure (tag names, classes and attribute names only —',
    'every text node is replaced by its character count):',
    ''
  );
  lines.push(skeleton && skeleton.length > 0 ? skeleton : '  (not available)');

  return lines.join('\n');
}
