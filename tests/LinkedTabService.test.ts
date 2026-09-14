import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Browser } from "wxt/browser"
import { aiService } from "../services/ai/AiService"
import { appleFmProvider } from "../services/ai/AppleFmProvider"
import { LinkedTabService } from "../services/LinkedTabService"
import { tabGroupState } from "../services/TabGroupState"
import { DEFAULT_STATE } from "../types/storage"
import { mockBrowser } from "./setup"

vi.mock("../services/RulesService", () => ({
  rulesService: { findBlacklistMatch: vi.fn().mockResolvedValue(null) }
}))
let service: LinkedTabService
let tabs: Map<number, Browser.tabs.Tab>
let groups: Map<number, Browser.tabGroups.TabGroup>
let saved: Record<string, unknown>
let nextGroup: number
function tab(id: number, openerTabId?: number): Browser.tabs.Tab {
  return {
    id,
    openerTabId,
    url: `https://site${id}.test/`,
    title: "Research",
    index: id,
    windowId: 1,
    groupId: -1,
    pinned: false,
    active: false,
    highlighted: false,
    incognito: false,
    frozen: false,
    selected: false,
    discarded: false,
    autoDiscardable: true
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(aiService, "isEnabled").mockReturnValue(false)
  vi.spyOn(aiService, "getSelectedProvider").mockReturnValue("apple")
  vi.spyOn(appleFmProvider, "isConnected").mockResolvedValue(true)
  service = new LinkedTabService()
  saved = {}
  tabs = new Map([
    [1, tab(1)],
    [2, tab(2, 1)],
    [3, tab(3, 1)]
  ])
  groups = new Map()
  nextGroup = 10
  tabGroupState.updateFromStorage({ ...DEFAULT_STATE, groupByMode: "linked" })
  mockBrowser.storage.session.get.mockImplementation(async () => structuredClone(saved))
  mockBrowser.storage.session.set.mockImplementation(async value => {
    Object.assign(saved, structuredClone(value))
  })
  mockBrowser.tabs.get.mockImplementation(async id => {
    const result = tabs.get(id)
    if (!result) throw new Error("Closed tab")
    return { ...result }
  })
  mockBrowser.tabs.query.mockImplementation(async query =>
    [...tabs.values()].filter(t => query.groupId === undefined || t.groupId === query.groupId)
  )
  mockBrowser.tabGroups.get.mockImplementation(async id => ({ ...groups.get(id)! }))
  mockBrowser.tabGroups.query.mockImplementation(async () => [...groups.values()])
  mockBrowser.tabs.group.mockImplementation(async ({ tabIds, groupId }) => {
    const id = groupId ?? nextGroup++
    if (!groups.has(id))
      groups.set(id, { id, windowId: 1, color: "blue", collapsed: false, shared: false, title: "" })
    for (const tabId of tabIds) tabs.get(tabId)!.groupId = id
    return id
  })
  mockBrowser.tabGroups.update.mockImplementation(async (id, update) => {
    Object.assign(groups.get(id)!, update)
    return groups.get(id)!
  })
  mockBrowser.tabs.ungroup.mockImplementation(async ids => {
    for (const id of ids) tabs.get(id)!.groupId = -1
  })
})
describe("Linked browsing", () => {
  it("groups cross-domain siblings once even when opened concurrently", async () => {
    await Promise.all([service.onCreated(tabs.get(2)!), service.onCreated(tabs.get(3)!)])
    expect(groups.size).toBe(1)
    expect([...tabs.values()].map(t => t.groupId)).toEqual([10, 10, 10])
  })
  it("leaves existing unrelated tabs alone", async () => {
    await service.onUpdated(2)
    expect(mockBrowser.tabs.group).not.toHaveBeenCalled()
  })
  it("waits for a destination across a worker restart", async () => {
    tabs.get(2)!.url = "about:blank"
    await service.onCreated(tabs.get(2)!)
    expect(groups.size).toBe(0)
    service = new LinkedTabService()
    tabs.get(2)!.url = "https://destination.test"
    await service.onUpdated(2)
    expect(tabs.get(2)!.groupId).toBe(tabs.get(1)!.groupId)
    expect(groups.size).toBe(1)
  })
  it("does not regroup a manually removed tab after navigation or restart", async () => {
    await service.onCreated(tabs.get(2)!)
    tabs.get(2)!.groupId = -1
    tabs.get(2)!.url = "https://elsewhere.test"
    service = new LinkedTabService()
    await service.onUpdated(2)
    expect(tabs.get(2)!.groupId).toBe(-1)
  })
  it("dissolves only when the original tab remains", async () => {
    await service.onCreated(tabs.get(2)!)
    tabs.delete(2)
    service = new LinkedTabService()
    await service.cleanup(2)
    expect(tabs.get(1)!.groupId).toBe(-1)
  })
  it("keeps a remaining child when the original closes", async () => {
    await service.onCreated(tabs.get(2)!)
    tabs.delete(1)
    await service.cleanup(1)
    expect(tabs.get(2)!.groupId).toBe(10)
  })
  it("keeps a renamed group even after the name is changed back", async () => {
    await service.onCreated(tabs.get(2)!)
    await service.onGroupUpdated({ ...groups.get(10)!, title: "Keep this" })
    tabs.delete(2)
    await service.cleanup(2)
    expect(tabs.get(1)!.groupId).toBe(10)
  })
  it("does not merge unrelated groups with the same name", async () => {
    tabs.set(4, tab(4))
    tabs.set(5, tab(5, 4))
    await service.onCreated(tabs.get(2)!)
    await service.onCreated(tabs.get(5)!)
    expect(groups.size).toBe(2)
    expect(tabs.get(2)!.groupId).not.toBe(tabs.get(5)!.groupId)
  })
  it.each(["pinned", "window", "closed"])("leaves links from a %s opener alone", async reason => {
    if (reason === "pinned") tabs.get(1)!.pinned = true
    if (reason === "window") tabs.get(1)!.windowId = 2
    if (reason === "closed") tabs.delete(1)
    await service.onCreated(tabs.get(2)!)
    expect(groups.size).toBe(0)
  })
  it("joins a user-created group without taking ownership", async () => {
    tabs.get(1)!.groupId = 40
    groups.set(40, {
      id: 40,
      title: "My project",
      color: "red",
      windowId: 1,
      collapsed: false,
      shared: false
    })
    await service.onCreated(tabs.get(2)!)
    tabs.delete(2)
    await service.cleanup(2)
    expect(tabs.get(1)!.groupId).toBe(40)
    expect(mockBrowser.tabGroups.update).not.toHaveBeenCalled()
  })
  it("honors pause", async () => {
    tabGroupState.autoGroupingEnabled = false
    await service.onCreated(tabs.get(2)!)
    expect(groups.size).toBe(0)
  })
})

afterEach(() => vi.restoreAllMocks())
describe("Apple linked names", () => {
  it("names the current membership once and preserves manual renames", async () => {
    await service.onCreated(tabs.get(2)!)
    vi.mocked(aiService.isEnabled).mockReturnValue(true)
    const complete = vi.spyOn(aiService, "complete").mockResolvedValue({
      content: '{"emoji":"📚","title":"Swift learning"}',
      finishReason: "stop"
    })
    await service.nameGroup(10)
    expect(groups.get(10)!.title).toBe("📚 Swift learning")
    await service.nameGroup(10)
    expect(complete).toHaveBeenCalledTimes(1)
    groups.get(10)!.title = "My name"
    await service.onGroupUpdated(groups.get(10)!)
    tabs.get(2)!.title = "Changed"
    await service.nameGroup(10)
    expect(groups.get(10)!.title).toBe("My name")
    expect(complete).toHaveBeenCalledTimes(1)
  })
  it("discards a result when a manual rename happens during inference", async () => {
    await service.onCreated(tabs.get(2)!)
    vi.mocked(aiService.isEnabled).mockReturnValue(true)
    let finish!: (value: { content: string; finishReason: string }) => void
    const complete = vi.spyOn(aiService, "complete").mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    const naming = service.nameGroup(10)
    await vi.waitFor(() => expect(complete).toHaveBeenCalled())
    groups.get(10)!.title = "Keep this name"
    await service.onGroupUpdated(groups.get(10)!)
    finish({ content: '{"emoji":"📚","title":"Stale name"}', finishReason: "stop" })
    await naming
    expect(groups.get(10)!.title).toBe("Keep this name")
  })
  it("retries newer membership without applying a stale result", async () => {
    await service.onCreated(tabs.get(2)!)
    vi.mocked(aiService.isEnabled).mockReturnValue(true)
    let finish!: (value: { content: string; finishReason: string }) => void
    const complete = vi
      .spyOn(aiService, "complete")
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve
          })
      )
      .mockResolvedValue({
        content: '{"emoji":"🔎","title":"Current research"}',
        finishReason: "stop"
      })
    const naming = service.nameGroup(10)
    await vi.waitFor(() => expect(complete).toHaveBeenCalled())
    tabs.get(2)!.title = "New research topic"
    await service.nameGroup(10)
    finish({ content: '{"emoji":"📚","title":"Stale name"}', finishReason: "stop" })
    await naming
    expect(complete).toHaveBeenCalledTimes(2)
    expect(groups.get(10)!.title).toBe("🔎 Current research")
    expect(mockBrowser.tabGroups.update).not.toHaveBeenCalledWith(10, { title: "📚 Stale name" })
  })
})

it("retains a fitting label without rewriting the browser group", async () => {
  await service.onCreated(tabs.get(2)!)
  vi.mocked(aiService.isEnabled).mockReturnValue(true)
  const complete = vi
    .spyOn(aiService, "complete")
    .mockResolvedValue({ content: '{"emoji":"📚","title":"Swift learning"}', finishReason: "stop" })
  await service.nameGroup(10)
  const updates = mockBrowser.tabGroups.update.mock.calls.length
  tabs.get(2)!.title = "Another Swift tutorial"
  await service.nameGroup(10)
  expect(complete).toHaveBeenCalledTimes(2)
  expect(complete.mock.calls[1][0].messages[1].content).toContain("📚 Swift learning")
  expect(mockBrowser.tabGroups.update).toHaveBeenCalledTimes(updates)
})
