/**
 * Background service worker for AI Chat Exporter extension
 * Handles background tasks and extension lifecycle events
 */

import { EXTENSION_NAME, DEFAULT_PREFERENCES } from '../../shared/constants';
import { StorageService } from '../../shared/storage';
import {
  createMessage,
  type ExportConversationMessage,
  type PrintConversationMessage,
} from '../../shared/messages';
import type { ExportFormat } from '../../core/types';
import { sendTabMessage } from '../../shared/tab-messaging';

/**
 * Extension installation handler
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[${EXTENSION_NAME}] Extension installed/updated`, details);

  // Compared as a string, not via chrome.runtime.OnInstalledReason: Firefox does
  // not expose that enum object at runtime.
  const reason: string = details.reason;

  if (reason === 'install') {
    // First time installation
    console.log(`[${EXTENSION_NAME}] First time installation`);

    // You could open a welcome page here if desired
    // chrome.tabs.create({ url: 'pages/welcome.html' });
  } else if (reason === 'update') {
    // Extension updated
    console.log(
      `[${EXTENSION_NAME}] Extension updated to version ${chrome.runtime.getManifest().version}`
    );
  }
});

/**
 * Extension startup handler
 */
chrome.runtime.onStartup.addListener(() => {
  console.log(`[${EXTENSION_NAME}] Extension started`);
  // Recreate context menus on startup
  createContextMenus();
});

/**
 * Message handler for communication between components
 */
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  console.log(`[${EXTENSION_NAME}] Background received message:`, message);

  // Handle Claude API data fetch
  if (isClaudeApiFetchMessage(message)) {
    handleClaudeApiFetch(message.data)
      .then((data) => {
        sendResponse({ success: true, data });
      })
      .catch((error) => {
        console.error(`[${EXTENSION_NAME}] Claude API fetch failed:`, error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    return true; // Keep channel open for async response
  }

  // Handle Claude organizations fetch (used to discover the org ID instead of
  // scraping the page for it — see claude-api-service.ts)
  if (isClaudeOrganizationsFetchMessage(message)) {
    handleClaudeOrganizationsFetch()
      .then((data) => {
        sendResponse({ success: true, data });
      })
      .catch((error) => {
        console.error(`[${EXTENSION_NAME}] Claude organizations fetch failed:`, error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    return true; // Keep channel open for async response
  }

  // Handle other message types here
  sendResponse({ success: true });
  return false;
});

interface ClaudeApiFetchMessage {
  type: 'fetch_claude_api_data';
  data: { organizationId: string; conversationId: string };
}

/**
 * SEC-1 (low): `organizationId` can come straight off `window.location.search`
 * (claude-api-service.ts's `orgIdParam`) with no UUID check, unlike every
 * other source. This is the trust boundary the value crosses into a
 * credentialed `claude.ai` fetch (`handleClaudeApiFetch` below), so both ids
 * are validated here rather than trusting the message shape.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isClaudeApiFetchMessage(message: unknown): message is ClaudeApiFetchMessage {
  if (
    typeof message !== 'object' ||
    message === null ||
    (message as { type?: unknown }).type !== 'fetch_claude_api_data'
  ) {
    return false;
  }
  const data = (message as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const { organizationId, conversationId } = data as {
    organizationId?: unknown;
    conversationId?: unknown;
  };
  return (
    typeof organizationId === 'string' &&
    UUID_RE.test(organizationId) &&
    typeof conversationId === 'string' &&
    UUID_RE.test(conversationId)
  );
}

interface ClaudeOrganizationsFetchMessage {
  type: 'fetch_claude_organizations';
}

function isClaudeOrganizationsFetchMessage(
  message: unknown
): message is ClaudeOrganizationsFetchMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'fetch_claude_organizations'
  );
}

/**
 * Fetch Claude conversation data from API
 */
async function handleClaudeApiFetch(request: {
  organizationId: string;
  conversationId: string;
}): Promise<unknown> {
  const { organizationId, conversationId } = request;

  const apiUrl = `https://claude.ai/api/organizations/${organizationId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true&consistency=strong`;

  console.log(`[${EXTENSION_NAME}] Fetching Claude API:`, apiUrl);

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include', // Include cookies for authentication
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
    console.log(`[${EXTENSION_NAME}] Claude API response received`);

    return data;
  } catch (error) {
    console.error(`[${EXTENSION_NAME}] Claude API fetch error:`, error);
    throw error;
  }
}

/**
 * Fetch the signed-in user's Claude organizations. Used to discover the
 * organization ID directly from the API instead of scraping it out of the
 * page — see `ClaudeApiService.resolveOrganizationIdViaApi`.
 *
 * ponytail: never logs or returns anything from the response beyond the raw
 * JSON needed by the caller — this is account data.
 */
async function handleClaudeOrganizationsFetch(): Promise<unknown> {
  const apiUrl = 'https://claude.ai/api/organizations';

  console.log(`[${EXTENSION_NAME}] Fetching Claude organizations:`, apiUrl);

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      credentials: 'include', // Include cookies for authentication
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
    console.log(`[${EXTENSION_NAME}] Claude organizations response received`);

    return data;
  } catch (error) {
    console.error(`[${EXTENSION_NAME}] Claude organizations fetch error:`, error);
    throw error;
  }
}

/**
 * Tab update handler - inject content script into supported pages
 */
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  // Only inject when page is fully loaded
  if (changeInfo.status !== 'complete' || !tab.url) {
    return;
  }

  // Check if URL matches supported platforms
  const supportedDomains = ['chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com'];

  const url = new URL(tab.url);
  if (supportedDomains.some((domain) => url.hostname.includes(domain))) {
    console.log(`[${EXTENSION_NAME}] Detected supported platform: ${url.hostname}`);
  }
});

/**
 * Format information for context menus
 */
const EXPORT_FORMATS = [
  { id: 'pdf', labelKey: 'formatPDF' },
  { id: 'docx', labelKey: 'formatDOCX' },
  { id: 'md', labelKey: 'formatMarkdown' },
  { id: 'html', labelKey: 'formatHTML' },
  { id: 'txt', labelKey: 'formatTXT' },
  { id: 'json', labelKey: 'formatJSON' },
] as const;

/**
 * Printable formats (DOCX cannot be printed)
 */
const PRINT_FORMATS = [
  { id: 'pdf', labelKey: 'formatPDF' },
  { id: 'md', labelKey: 'formatMarkdown' },
  { id: 'html', labelKey: 'formatHTML' },
  { id: 'txt', labelKey: 'formatTXT' },
  { id: 'json', labelKey: 'formatJSON' },
] as const;

/**
 * URL patterns for supported chat platforms
 */
const SUPPORTED_URL_PATTERNS = [
  'https://chat.openai.com/*',
  'https://chatgpt.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*',
];

/**
 * Context menu setup with hierarchical structure
 */
chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

/**
 * Create all context menus
 */
function createContextMenus(): void {
  // Remove all existing menus first to ensure clean state
  chrome.contextMenus.removeAll(() => {
    console.log(`[${EXTENSION_NAME}] Creating context menus...`);

    // Create Export parent menu
    chrome.contextMenus.create(
      {
        id: 'export',
        title: chrome.i18n.getMessage('exportButton'),
        contexts: ['page'],
        documentUrlPatterns: SUPPORTED_URL_PATTERNS,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error(
            `[${EXTENSION_NAME}] Error creating Export menu:`,
            chrome.runtime.lastError
          );
        } else {
          console.log(`[${EXTENSION_NAME}] Created Export parent menu`);
        }
      }
    );

    // Create Export submenus for each format
    EXPORT_FORMATS.forEach((format) => {
      chrome.contextMenus.create(
        {
          id: `export-${format.id}`,
          parentId: 'export',
          title: chrome.i18n.getMessage(format.labelKey),
          contexts: ['page'],
          documentUrlPatterns: SUPPORTED_URL_PATTERNS,
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error(
              `[${EXTENSION_NAME}] Error creating Export submenu ${format.id}:`,
              chrome.runtime.lastError
            );
          } else {
            console.log(`[${EXTENSION_NAME}] Created Export submenu: ${format.id}`);
          }
        }
      );
    });

    // Create Print parent menu
    chrome.contextMenus.create(
      {
        id: 'print',
        title: chrome.i18n.getMessage('printButton'),
        contexts: ['page'],
        documentUrlPatterns: SUPPORTED_URL_PATTERNS,
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error(`[${EXTENSION_NAME}] Error creating Print menu:`, chrome.runtime.lastError);
        } else {
          console.log(`[${EXTENSION_NAME}] Created Print parent menu`);
        }
      }
    );

    // Create Print submenus for each format (excluding DOCX)
    PRINT_FORMATS.forEach((format) => {
      chrome.contextMenus.create(
        {
          id: `print-${format.id}`,
          parentId: 'print',
          title: chrome.i18n.getMessage(format.labelKey),
          contexts: ['page'],
          documentUrlPatterns: SUPPORTED_URL_PATTERNS,
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error(
              `[${EXTENSION_NAME}] Error creating Print submenu ${format.id}:`,
              chrome.runtime.lastError
            );
          } else {
            console.log(`[${EXTENSION_NAME}] Created Print submenu: ${format.id}`);
          }
        }
      );
    });

    console.log(`[${EXTENSION_NAME}] Context menu creation initiated`);
  });
}

/**
 * Flag (or clear) a failed request on the toolbar badge.
 *
 * The service worker has no UI of its own, so a `console.error` here is a
 * failure the user never sees. `chrome.action` is already in the manifest;
 * `notifications` is not, and is not worth a store re-review for an error path.
 *
 * ponytail: no auto-clear timer — an MV3 worker can be killed before one fires,
 * leaving the badge stuck. The next export attempt clears it instead.
 */
function setErrorBadge(failed: boolean): void {
  void chrome.action.setBadgeText({ text: failed ? '!' : '' });
  if (failed) {
    void chrome.action.setBadgeBackgroundColor({ color: '#D93025' });
  }
}

/**
 * Send a message to a tab's content script. A tab with no content script — one
 * loaded before install, or after an extension reload — is the common case, and
 * `sendTabMessage` recovers from it by injecting the script and retrying, so
 * the export goes through instead of dying.
 *
 * Fire-and-forget by design (callers do not await it); a failure that survives
 * the injection is surfaced on the badge.
 */
function sendMessageToTab(tabId: number, message: unknown): void {
  setErrorBadge(false);

  void sendTabMessage(tabId, message).then((result) => {
    if (result.ok) {
      return;
    }
    if (result.reason === 'failed') {
      console.error(`[${EXTENSION_NAME}] Failed to deliver message to tab ${tabId}:`, result.error);
    } else {
      // Not a fault: injection was refused, so the page is one this extension
      // cannot reach (restricted URL, revoked host access, dead tab).
      console.debug(`[${EXTENSION_NAME}] No content script in tab ${tabId}:`, result.error);
    }
    setErrorBadge(true);
  });
}

/**
 * Context menu click handler
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuId = info.menuItemId as string;

  if (!tab?.id) {
    console.error(`[${EXTENSION_NAME}] No tab ID available`);
    return;
  }

  // Handle Export actions
  if (menuId.startsWith('export-')) {
    // Safe cast: the menu id is built from EXPORT_FORMATS, whose `id`s are all
    // valid ExportFormat values.
    const format = menuId.replace('export-', '') as ExportFormat;
    console.log(`[${EXTENSION_NAME}] Export requested: ${format}`);

    sendMessageToTab(
      tab.id,
      createMessage<ExportConversationMessage>('export_conversation', { format })
    );
  }
  // Handle Print actions
  else if (menuId.startsWith('print-')) {
    // Safe cast: the menu id is built from PRINT_FORMATS, whose `id`s are all
    // valid ExportFormat values.
    const format = menuId.replace('print-', '') as ExportFormat;
    console.log(`[${EXTENSION_NAME}] Print requested: ${format}`);

    sendMessageToTab(
      tab.id,
      createMessage<PrintConversationMessage>('print_conversation', { format })
    );
  }
});

/**
 * Command handler for keyboard shortcuts
 */
chrome.commands.onCommand.addListener((command) => {
  console.log(`[${EXTENSION_NAME}] Command received:`, command);

  if (command === 'export-conversation') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) {
        return;
      }
      // No dialog exists to ask which format to use, so export in the last
      // format the user picked (same format the content script persists
      // after every export), falling back to the configured default.
      StorageService.getLastExportFormat()
        .then((format) => {
          sendMessageToTab(
            tabId,
            createMessage<ExportConversationMessage>('export_conversation', {
              // Safe cast: persisted by this extension from a previous export,
              // so it is always a valid ExportFormat when present.
              format: (format ?? DEFAULT_PREFERENCES.defaultFormat) as ExportFormat,
            })
          );
        })
        .catch((error: unknown) => {
          console.error(`[${EXTENSION_NAME}] Failed to send export command:`, error);
        });
    });
  }
});

console.log(`[${EXTENSION_NAME}] Background service worker initialized`);
