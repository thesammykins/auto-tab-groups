import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppleFmProvider } from "../services/ai/AppleFmProvider"
import { groupNamingRequest, parseGroupName } from "../utils/GroupNaming"
import { mockBrowser } from "./setup"

let provider: AppleFmProvider
let saved: Record<string, unknown>
const fetchMock = vi.fn()
const models = () => new Response(JSON.stringify({ data: [{ id: "system" }] }))
beforeEach(() => {
  vi.clearAllMocks()
  mockBrowser.declarativeNetRequest.updateSessionRules.mockResolvedValue(undefined)
  mockBrowser.declarativeNetRequest.getSessionRules.mockResolvedValue([])
  provider = new AppleFmProvider()
  saved = {}
  vi.stubGlobal("fetch", fetchMock)
  mockBrowser.permissions.contains.mockResolvedValue(true)
  mockBrowser.storage.session.get.mockImplementation(async () => ({ ...saved }))
  mockBrowser.storage.session.set.mockImplementation(async value => {
    Object.assign(saved, value)
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
describe("Apple built-in server", () => {
  it("leaves loading when the browser stalls a rule update and allows retry", async () => {
    vi.useFakeTimers()
    let finishRule!: () => void
    mockBrowser.declarativeNetRequest.updateSessionRules.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishRule = resolve
        })
    )
    const first = provider.loadModel("apple-system")
    const rejected = expect(first).rejects.toThrow("browser did not finish")
    await vi.advanceTimersByTimeAsync(10000)
    await rejected
    expect(provider.getStatus()).toBe("error")
    expect(fetchMock).not.toHaveBeenCalled()
    finishRule()
    await Promise.resolve()
    expect(provider.getStatus()).toBe("error")
    expect(saved.appleFmConnected).not.toBe(true)
    fetchMock.mockResolvedValueOnce(models())
    await provider.loadModel("apple-system")
    expect(provider.getStatus()).toBe("ready")
  })
  it("reuses the exact installed session rule after a worker restart", async () => {
    fetchMock.mockImplementation(async () => models())
    await provider.loadModel("apple-system")
    const rule = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0].addRules![0]
    mockBrowser.declarativeNetRequest.getSessionRules.mockResolvedValue([{ ...rule, priority: 1 }])
    mockBrowser.declarativeNetRequest.updateSessionRules.mockClear()
    const restarted = new AppleFmProvider()
    await restarted.loadModel("apple-system")
    expect(restarted.getStatus()).toBe("ready")
    expect(mockBrowser.declarativeNetRequest.updateSessionRules).not.toHaveBeenCalled()
  })
  it("replaces a rule with a broader initiator scope", async () => {
    fetchMock.mockImplementation(async () => models())
    await provider.loadModel("apple-system")
    const rule = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0].addRules![0]
    mockBrowser.declarativeNetRequest.getSessionRules.mockResolvedValue([
      {
        ...rule,
        condition: { ...rule.condition, initiatorDomains: undefined }
      }
    ])
    await provider.loadModel("apple-system")
    expect(mockBrowser.declarativeNetRequest.updateSessionRules).toHaveBeenCalledTimes(2)
  })
  it("shares one connection attempt between simultaneous callers", async () => {
    fetchMock.mockImplementation(async () => models())
    await Promise.all([provider.loadModel("apple-system"), provider.loadModel("apple-system")])
    expect(mockBrowser.declarativeNetRequest.updateSessionRules).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("disconnects after an in-flight connection finishes", async () => {
    fetchMock.mockImplementation(async () => models())
    const connecting = provider.loadModel("apple-system")
    const disconnecting = provider.unloadModel()
    await Promise.all([connecting, disconnecting])
    expect(provider.getStatus()).toBe("idle")
    expect(saved.appleFmConnected).toBe(false)
    expect(mockBrowser.declarativeNetRequest.updateSessionRules).toHaveBeenLastCalledWith({
      removeRuleIds: [1976]
    })
  })
  it("bounds a stalled rule read without starting another mutation", async () => {
    vi.useFakeTimers()
    mockBrowser.declarativeNetRequest.getSessionRules.mockImplementationOnce(
      () => new Promise(() => {})
    )
    const attempt = expect(provider.loadModel("apple-system")).rejects.toThrow(
      "browser did not finish"
    )
    await vi.advanceTimersByTimeAsync(10000)
    await attempt
    expect(provider.getStatus()).toBe("error")
    expect(mockBrowser.declarativeNetRequest.updateSessionRules).not.toHaveBeenCalled()
  })
  it("requires explicit localhost permission before making requests", async () => {
    mockBrowser.permissions.contains.mockResolvedValue(false)
    await expect(provider.loadModel("apple-system")).rejects.toThrow("localhost access")
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("connects, uses Apple's JSON schema format, and disconnects without stopping the server", async () => {
    fetchMock.mockResolvedValueOnce(models()).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: '{"emoji":"📚","title":"Swift learning"}' },
              finish_reason: "stop"
            }
          ]
        })
      )
    )
    await provider.loadModel("apple-system")
    const request = groupNamingRequest([
      { title: "Swift tutorial", hostname: "developer.apple.com" }
    ])
    const result = await provider.complete(request)
    expect(parseGroupName(result.content)).toBe("📚 Swift learning")
    const [url, options] = fetchMock.mock.calls[1]
    expect(url).toBe("http://127.0.0.1:1976/v1/chat/completions")
    expect(JSON.parse(options.body).response_format.type).toBe("json_schema")
    expect(options.redirect).toBe("error")
    const rule = mockBrowser.declarativeNetRequest.updateSessionRules.mock.calls[0][0].addRules![0]
    expect(rule.condition.initiatorDomains).toEqual([mockBrowser.runtime.id])
    expect(rule.condition.requestMethods).toEqual(["post"])
    const endpoint = new RegExp(rule.condition.regexFilter!)
    expect(endpoint.test(url)).toBe(true)
    expect(endpoint.test("http://127.0.0.1:1976/v1/chat/completions/other")).toBe(false)
    expect(endpoint.test("http://127.0.0.1:1977/v1/chat/completions")).toBe(false)
    await provider.unloadModel()
    expect(mockBrowser.declarativeNetRequest.updateSessionRules).toHaveBeenLastCalledWith({
      removeRuleIds: [1976]
    })
    await expect(provider.complete(request)).rejects.toThrow("Connect to Apple")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it("reconnects after a worker restart only when the user connected this session", async () => {
    saved.appleFmConnected = true
    fetchMock
      .mockResolvedValueOnce(models())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "Ready" } }] }))
      )
    expect((await provider.complete({ messages: [] })).content).toBe("Ready")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it("surfaces an unavailable server with the launch command", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await expect(provider.loadModel("apple-system")).rejects.toThrow("fm serve")
    expect(provider.getStatus()).toBe("error")
  })
  it("rejects malformed completion responses", async () => {
    fetchMock
      .mockResolvedValueOnce(models())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: 123 } }] }))
      )
    await provider.loadModel("apple-system")
    await expect(provider.complete({ messages: [] })).rejects.toThrow("invalid content")
  })
  it.each([
    "{}",
    '{"emoji":"hello","title":"Topic"}',
    '{"emoji":"📚📚","title":"Topic"}',
    '{"emoji":"📚","title":""}'
  ])("rejects unsafe or unusable group names: %s", content => {
    expect(() => parseGroupName(content)).toThrow()
  })
})

it("bounds labels by visible characters without splitting emoji", () => {
  const title = parseGroupName(
    JSON.stringify({ emoji: "👩🏽‍💻", title: "Detailed programming reference examples ".repeat(5) })
  )
  expect(
    [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(title)].length
  ).toBeLessThanOrEqual(48)
  expect(title.startsWith("👩🏽‍💻 ")).toBe(true)
  expect(title.endsWith("examples")).toBe(true)
})
