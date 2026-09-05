import { vi, beforeEach } from 'vitest';

// D-18: exporters render timestamps in the reader's local time zone (fixed
// from a UTC-only bug). Pin the test-runner's zone so those assertions are
// deterministic across machines/CI instead of depending on whoever runs them;
// production has no such pin and genuinely uses the reader's own zone.
process.env.TZ = 'UTC';

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
  configurable: true, // lets vi.stubGlobal('chrome', ...) redefine it per-test
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

// TEST-3: `vi.waitFor` does not honour `testTimeout` -- it has its own 1000ms
// default. So the 15s ceiling vitest.config.ts sets for CPU starvation (see the
// comment there: tests measured at 2.6s alone and up to 6.6s while another run
// shares the machine) never applied to a single `waitFor`, and every one of them
// kept a 1s budget inside a suite that tolerates 15. Under a full-suite run
// `popup-states.test.ts` gave up while the popup was still in `detecting` --
// nothing was hung, the state machine simply had not been scheduled yet.
//
// Defaulting it here rather than per call site, for the reason vitest.config.ts
// already records: PR #150 opted in test-by-test and the flakes moved elsewhere.
// An explicit `timeout` at a call site still wins.
const waitForWithSuiteTimeout = vi.waitFor.bind(vi);
vi.waitFor = ((callback: never, options?: number | object) =>
  waitForWithSuiteTimeout(
    callback,
    typeof options === 'number' ? options : { timeout: 15_000, ...options }
  )) as typeof vi.waitFor;
