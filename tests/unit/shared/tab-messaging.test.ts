/**
 * SEC-2: `injectContentScripts` used to flatten every manifest
 * `content_scripts` entry into every tab's top frame, ignoring each entry's
 * `matches` and `all_frames`. That meant (a) the sandbox-only Deep Research
 * frame script ran in top-level chat pages it is not scoped for, and (b) the
 * keyboard-shortcut export path -- which resolves whatever tab is active,
 * with no host check -- could inject the full content-script bundle into any
 * site at all, contradicting the "no access to any other site" privacy claim.
 *
 * These tests drive `sendTabMessage` (the only exported entry point;
 * `injectContentScripts` is internal) through the "no receiver, inject, then
 * retry" path and assert on what actually got injected.
 */

import { describe, it, expect, vi } from 'vitest';
import { sendTabMessage } from '../../../src/shared/tab-messaging';

/** Mirrors manifests/manifest.base.json's real two-entry content_scripts shape. */
const TWO_ENTRY_MANIFEST = {
  content_scripts: [
    {
      matches: [
        'https://chat.openai.com/*',
        'https://chatgpt.com/*',
        'https://claude.ai/*',
        'https://gemini.google.com/*',
      ],
      js: ['content/content-script.js'],
      css: ['content/styles.css'],
    },
    {
      matches: ['https://*.web-sandbox.oaiusercontent.com/*'],
      all_frames: true,
      js: ['content/deep-research-frame.js'],
    },
  ],
};

const NO_RECEIVER = new Error('Could not establish connection. Receiving end does not exist.');

function mockChromeForTab(
  tabUrl: string | undefined,
  sendMessageMock = vi.fn().mockRejectedValueOnce(NO_RECEIVER).mockResolvedValueOnce({ ok: true })
): { executeScriptMock: ReturnType<typeof vi.fn>; insertCSSMock: ReturnType<typeof vi.fn> } {
  const executeScriptMock = vi.fn().mockResolvedValue(undefined);
  const insertCSSMock = vi.fn().mockResolvedValue(undefined);

  vi.stubGlobal('chrome', {
    runtime: { getManifest: vi.fn(() => TWO_ENTRY_MANIFEST) },
    tabs: {
      get: vi.fn().mockResolvedValue({ url: tabUrl }),
      sendMessage: sendMessageMock,
    },
    scripting: { executeScript: executeScriptMock, insertCSS: insertCSSMock },
  });

  return { executeScriptMock, insertCSSMock };
}

describe('injectContentScripts honors manifest matches/all_frames', () => {
  it('injects content-script.js (not the sandbox frame script) into a top-level chat page', async () => {
    const { executeScriptMock, insertCSSMock } = mockChromeForTab('https://chatgpt.com/c/1');

    await sendTabMessage(1, { type: 'x' });

    expect(executeScriptMock).toHaveBeenCalledTimes(1);
    expect(executeScriptMock).toHaveBeenCalledWith({
      target: { tabId: 1, allFrames: false },
      files: ['content/content-script.js'],
    });
    expect(insertCSSMock).toHaveBeenCalledWith({
      target: { tabId: 1, allFrames: false },
      files: ['content/styles.css'],
    });
  });

  it('injects the Deep Research frame script with allFrames:true for the sandbox host', async () => {
    const { executeScriptMock, insertCSSMock } = mockChromeForTab(
      'https://connector.web-sandbox.oaiusercontent.com/widget'
    );

    await sendTabMessage(1, { type: 'x' });

    expect(executeScriptMock).toHaveBeenCalledTimes(1);
    expect(executeScriptMock).toHaveBeenCalledWith({
      target: { tabId: 1, allFrames: true },
      files: ['content/deep-research-frame.js'],
    });
    // The sandbox entry has no `css`, and the chat-host entry does not match
    // this URL, so nothing should have been inserted.
    expect(insertCSSMock).not.toHaveBeenCalled();
  });

  it('injects nothing into an unrelated site (the keyboard-shortcut command-path bug)', async () => {
    // No entry matches this host, so injection is a no-op and every retry
    // still finds nobody listening -- persistently reject rather than the
    // default "resolve after one rejection" (which assumes an injection
    // actually landed a listener).
    const sendMessageMock = vi.fn().mockRejectedValue(NO_RECEIVER);
    const { executeScriptMock, insertCSSMock } = mockChromeForTab(
      'https://mail.example.com/inbox',
      sendMessageMock
    );

    const result = await sendTabMessage(1, { type: 'x' });

    expect(executeScriptMock).not.toHaveBeenCalled();
    expect(insertCSSMock).not.toHaveBeenCalled();
    // No entry matched, so there was nothing to talk to -- a clean
    // "noContentScript" result, not a fault, and definitely not a script
    // that ran on a page outside the declared scope.
    expect(result).toMatchObject({ ok: false, reason: 'noContentScript' });
  });

  it('still recovers a missing content script on a supported host (lo-db20)', async () => {
    const sendMessageMock = vi
      .fn()
      .mockRejectedValueOnce(NO_RECEIVER)
      .mockResolvedValueOnce({ success: true });
    mockChromeForTab('https://claude.ai/chat/1', sendMessageMock);

    const result = await sendTabMessage(1, { type: 'x' });

    expect(result).toEqual({ ok: true, response: { success: true } });
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
  });
});
