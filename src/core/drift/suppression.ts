/**
 * Which drift fingerprints the user has already dealt with.
 *
 * No migration or cleanup job is needed: the fingerprint already contains the
 * extension version, so shipping a fix produces a new fingerprint and the
 * prompt returns on its own.
 */

export const DRIFT_SUPPRESSION_KEY = 'drift_suppressed_fingerprints';

type SuppressionMap = Record<string, true>;

async function read(): Promise<SuppressionMap> {
  try {
    const result = await chrome.storage.local.get(DRIFT_SUPPRESSION_KEY);
    const map: unknown = result?.[DRIFT_SUPPRESSION_KEY];
    return typeof map === 'object' && map !== null ? (map as SuppressionMap) : {};
  } catch {
    // No storage permission, no chrome global (tests), quota error: treat as
    // "nothing suppressed". The safety net must never break the popup.
    return {};
  }
}

export async function isDriftSuppressed(fingerprint: string): Promise<boolean> {
  return (await read())[fingerprint] === true;
}

export async function suppressDrift(fingerprint: string): Promise<void> {
  try {
    const map = await read();
    map[fingerprint] = true;
    await chrome.storage.local.set({ [DRIFT_SUPPRESSION_KEY]: map });
  } catch {
    // Failing to remember a dismissal only means the row reappears next time.
  }
}
