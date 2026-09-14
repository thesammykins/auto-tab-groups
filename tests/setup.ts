/**
 * Vitest setup file for mocking browser extension APIs
 */
import { vi } from "vitest"

// Mock the browser API globally
const mockBrowser = {
  declarativeNetRequest: { updateSessionRules: vi.fn().mockResolvedValue(undefined) },
  permissions: {
    contains: vi.fn().mockResolvedValue(false),
    request: vi.fn().mockResolvedValue(false)
  },
  tabs: {
    create: vi.fn().mockResolvedValue({}),
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({}),
    group: vi.fn().mockResolvedValue(1),
    ungroup: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue({}),
    move: vi.fn().mockResolvedValue({})
  },
  tabGroups: {
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue({}),
    move: vi.fn().mockResolvedValue(undefined)
  },
  windows: {
    WINDOW_ID_CURRENT: -2,
    getCurrent: vi.fn().mockResolvedValue({ id: 1 })
  },
  runtime: {
    id: "test-extension-id",
    getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn()
    }
  },
  storage: {
    session: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined)
    },
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined)
    }
  }
}

// Assign to global
;(globalThis as unknown as { browser: typeof mockBrowser }).browser = mockBrowser

export { mockBrowser }
