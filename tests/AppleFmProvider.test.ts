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
