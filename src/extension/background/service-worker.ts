/**
 * Background service worker for AI Chat Exporter extension
 * Handles background tasks and extension lifecycle events
 */

import { EXTENSION_NAME, DEFAULT_PREFERENCES } from '../../shared/constants';
import { StorageService } from '../../shared/storage';

/**
 * Extension installation handler
 */
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[${EXTENSION_NAME}] Extension installed/updated`, details);

  if (details.reason === 'install') {
    // First time installation
    console.log(`[${EXTENSION_NAME}] First time installation`);

    // You could open a welcome page here if desired
    // chrome.tabs.create({ url: 'pages/welcome.html' });
  } else if (details.reason === 'update') {
    // Extension updated
    console.log(`[${EXTENSION_NAME}] Extension updated to version ${chrome.runtime.getManifest().version}`);
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
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log(`[${EXTENSION_NAME}] Background received message:`, message);

  // Handle Claude API data fetch
  if (message.type === 'fetch_claude_api_data') {
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

  // Forward messages to active tab if needed
  if (message.type === 'export_conversation' || message.type === 'print_conversation') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id) {
        chrome.tabs.sendMessage(activeTab.id, message, (response) => {
          sendResponse(response);
        });
      } else {
        sendResponse({ success: false, error: 'No active tab found' });
      }
    });
    return true; // Keep channel open for async response
  }

  // Handle other message types here
  sendResponse({ success: true });
  return false;
});

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

    const data = await response.json();
    console.log(`[${EXTENSION_NAME}] Claude API response received`);

    return data;
  } catch (error) {
    console.error(`[${EXTENSION_NAME}] Claude API fetch error:`, error);
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
  const supportedDomains = [
    'chat.openai.com',
    'chatgpt.com',
    'claude.ai',
    'gemini.google.com',
  ];

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
    chrome.contextMenus.create({
      id: 'export',
      title: chrome.i18n.getMessage('exportButton'),
      contexts: ['page'],
      documentUrlPatterns: SUPPORTED_URL_PATTERNS,
    }, () => {
      if (chrome.runtime.lastError) {
        console.error(`[${EXTENSION_NAME}] Error creating Export menu:`, chrome.runtime.lastError);
      } else {
        console.log(`[${EXTENSION_NAME}] Created Export parent menu`);
      }
    });

    // Create Export submenus for each format
    EXPORT_FORMATS.forEach((format) => {
      chrome.contextMenus.create({
        id: `export-${format.id}`,
        parentId: 'export',
        title: chrome.i18n.getMessage(format.labelKey),
        contexts: ['page'],
        documentUrlPatterns: SUPPORTED_URL_PATTERNS,
      }, () => {
        if (chrome.runtime.lastError) {
          console.error(`[${EXTENSION_NAME}] Error creating Export submenu ${format.id}:`, chrome.runtime.lastError);
        } else {
          console.log(`[${EXTENSION_NAME}] Created Export submenu: ${format.id}`);
        }
      });
    });

    // Create Print parent menu
    chrome.contextMenus.create({
      id: 'print',
      title: chrome.i18n.getMessage('printButton'),
      contexts: ['page'],
      documentUrlPatterns: SUPPORTED_URL_PATTERNS,
    }, () => {
      if (chrome.runtime.lastError) {
        console.error(`[${EXTENSION_NAME}] Error creating Print menu:`, chrome.runtime.lastError);
      } else {
        console.log(`[${EXTENSION_NAME}] Created Print parent menu`);
      }
    });

    // Create Print submenus for each format (excluding DOCX)
    PRINT_FORMATS.forEach((format) => {
      chrome.contextMenus.create({
        id: `print-${format.id}`,
        parentId: 'print',
        title: chrome.i18n.getMessage(format.labelKey),
        contexts: ['page'],
        documentUrlPatterns: SUPPORTED_URL_PATTERNS,
      }, () => {
        if (chrome.runtime.lastError) {
          console.error(`[${EXTENSION_NAME}] Error creating Print submenu ${format.id}:`, chrome.runtime.lastError);
        } else {
          console.log(`[${EXTENSION_NAME}] Created Print submenu: ${format.id}`);
        }
      });
    });

    console.log(`[${EXTENSION_NAME}] Context menu creation initiated`);
  });
}

/**
 * Send a message to a tab's content script and log a delivery failure
 * instead of swallowing it. `chrome.tabs.sendMessage` fails silently (no
 * callback invocation error, just a `chrome.runtime.lastError`) when the tab
 * has no content script — e.g. it was loaded before install, the extension
 * was reloaded, or the page is an unsupported one. There is no
 * "notifications" permission and no badge API used anywhere in this
 * extension to route the error through instead, so this reuses the
 * console.error(`[${EXTENSION_NAME}] ...`) pattern already used above for
 * chrome.contextMenus.create's own lastError checks — the established
 * error-surfacing path for this service worker.
 */
function sendMessageToTab(tabId: number, message: unknown): void {
  chrome.tabs.sendMessage(tabId, message, () => {
    if (chrome.runtime.lastError) {
      console.error(
        `[${EXTENSION_NAME}] Failed to deliver message to tab (no content script?):`,
        tabId,
        chrome.runtime.lastError.message,
      );
    }
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
    const format = menuId.replace('export-', '');
    console.log(`[${EXTENSION_NAME}] Export requested: ${format}`);

    sendMessageToTab(tab.id, {
      type: 'export_conversation',
      format: format,
      timestamp: Date.now(),
    });
  }
  // Handle Print actions
  else if (menuId.startsWith('print-')) {
    const format = menuId.replace('print-', '');
    console.log(`[${EXTENSION_NAME}] Print requested: ${format}`);

    sendMessageToTab(tab.id, {
      type: 'print_conversation',
      format: format,
      timestamp: Date.now(),
    });
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
          sendMessageToTab(tabId, {
            type: 'export_conversation',
            format: format ?? DEFAULT_PREFERENCES.defaultFormat,
            timestamp: Date.now(),
          });
        })
        .catch((error: unknown) => {
          console.error(`[${EXTENSION_NAME}] Failed to send export command:`, error);
        });
    });
  }
});

console.log(`[${EXTENSION_NAME}] Background service worker initialized`);
