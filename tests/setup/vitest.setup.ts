import { vi, beforeEach } from 'vitest';

// Mock browser APIs not available in jsdom
const mockStorage = {
  local: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  },
  sync: {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  },
};

const mockRuntime = {
  sendMessage: vi.fn().mockResolvedValue(undefined),
  onMessage: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
    hasListener: vi.fn().mockReturnValue(false),
  },
  getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
};

// Set up chrome global with partial mock (type assertion needed for partial implementation)
Object.defineProperty(globalThis, 'chrome', {
  value: {
    storage: mockStorage,
    runtime: mockRuntime,
  },
  writable: true,
});

// Mock window.location for URL pattern tests
const mockLocation = {
  href: 'https://chat.openai.com/c/test-conversation',
  hostname: 'chat.openai.com',
  pathname: '/c/test-conversation',
  origin: 'https://chat.openai.com',
};

Object.defineProperty(window, 'location', {
  value: mockLocation,
  writable: true,
});

// Helper to change URL for tests
export function setMockUrl(url: string) {
  const urlObj = new URL(url);
  Object.assign(window.location, {
    href: url,
    hostname: urlObj.hostname,
    pathname: urlObj.pathname,
    origin: urlObj.origin,
  });
}

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
