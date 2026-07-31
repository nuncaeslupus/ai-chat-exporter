/**
 * Talking to a tab's content script.
 *
 * `chrome.tabs.sendMessage` rejects with "Receiving end does not exist" whenever
 * nothing is listening in that tab — the normal state of every chat tab that was
 * already open when the extension was installed, updated or reloaded. That is a
 * condition to recover from, not an error to log: MV3 can put the content script
 * there and ask again.
 *
 * Callers get a typed result instead of a rejection, so each surface decides for
 * itself what to do with a failure — the popup paints a state, the service
 * worker has nothing to paint into.
 */

/**
 * "Could not establish connection. Receiving end does not exist." — matched
 * loosely on purpose: the exact sentence has been reworded between Chrome
 * versions and differs again in Firefox, and there is no error code to key on.
 */
const NO_RECEIVER = /receiving end|could not establish connection/i;

/** How long to keep asking after an injection, before giving up on the tab. */
const RETRIES = 5;
const RETRY_DELAY_MS = 100;

export type TabMessageResult<T> =
  | { ok: true; response: T }
  /** Nothing is listening in that tab and no script could be put there. */
  | { ok: false; reason: 'noContentScript'; error: string }
  /** Something else went wrong — a real fault, worth surfacing. */
  | { ok: false; reason: 'failed'; error: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Test a URL against a manifest `content_scripts` match pattern
 * (`<scheme>://<host>/<path>`). Chrome's `*.host` form also matches the bare
 * host with no subdomain.
 *
 * ponytail: covers the https-with-optional-wildcard-subdomain shape every
 * pattern in manifest.base.json uses (path is always `/*`); extend if a
 * scheme wildcard or path restriction is ever added.
 */
function matchesPattern(url: string, pattern: string): boolean {
  try {
    const target = new URL(url);
    const patternUrl = new URL(pattern.replace(/\*+$/, ''));
    if (target.protocol !== patternUrl.protocol) {
      return false;
    }
    const host = patternUrl.hostname;
    if (host.startsWith('*.')) {
      const suffix = host.slice(2);
      return target.hostname === suffix || target.hostname.endsWith(`.${suffix}`);
    }
    return target.hostname === host;
  } catch {
    return false;
  }
}

/**
 * Inject the content scripts the manifest declares, honoring each entry's
 * `matches` and `all_frames` instead of flattening every entry into every
 * tab's top frame. The manifest is the single source of the file list, so a
 * renamed bundle needs no second edit here.
 *
 * This is what keeps the extension's declared scope real: without the
 * `matches` filter, a tab-messaging call on any host (e.g. the keyboard
 * shortcut, which runs on whatever tab is active) would inject
 * content-script.js into pages outside the four chat hosts it is scoped to.
 */
async function injectContentScripts(tabId: number): Promise<void> {
  const { url } = await chrome.tabs.get(tabId);
  for (const entry of chrome.runtime.getManifest().content_scripts ?? []) {
    if (!url || !entry.matches?.some((pattern) => matchesPattern(url, pattern))) {
      continue;
    }
    const target = { tabId, allFrames: entry.all_frames === true };
    if (entry.css?.length) {
      await chrome.scripting.insertCSS({ target, files: entry.css });
    }
    if (entry.js?.length) {
      await chrome.scripting.executeScript({ target, files: entry.js });
    }
  }
}

/**
 * Send `message` to `tabId`, injecting the content script and retrying once if
 * nobody answers. Never throws and never logs: the result says what happened.
 */
export async function sendTabMessage<T>(
  tabId: number,
  message: unknown
): Promise<TabMessageResult<T>> {
  try {
    return { ok: true, response: (await chrome.tabs.sendMessage(tabId, message)) as T };
  } catch (error) {
    if (!NO_RECEIVER.test(messageOf(error))) {
      return { ok: false, reason: 'failed', error: messageOf(error) };
    }
  }

  try {
    await injectContentScripts(tabId);
  } catch (error) {
    // Restricted page, revoked host access, no `scripting` permission: there is
    // nothing to talk to and no way to create it. Still not a fault.
    return { ok: false, reason: 'noContentScript', error: messageOf(error) };
  }

  // The injected file is a loader that `import()`s the real bundle, so the
  // message listener is not necessarily registered by the time `executeScript`
  // resolves — asking once here would lose that race on a cold cache.
  //
  // ponytail: fixed poll, half a second of patience. Have the loader post a
  // ready signal if a slow machine ever needs longer.
  for (let attempt = 0; ; attempt++) {
    try {
      return { ok: true, response: (await chrome.tabs.sendMessage(tabId, message)) as T };
    } catch (error) {
      const text = messageOf(error);
      if (!NO_RECEIVER.test(text)) return { ok: false, reason: 'failed', error: text };
      if (attempt === RETRIES - 1) return { ok: false, reason: 'noContentScript', error: text };
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}
