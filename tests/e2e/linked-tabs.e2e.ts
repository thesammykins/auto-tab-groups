import { type BrowserContext, expect, type Page, test } from "@playwright/test"
import {
  getExtensionId,
  launchExtensionContext,
  openPopup,
  sendMessage
} from "./helpers/extension-helpers"

let context: BrowserContext
let popup: Page

test.beforeEach(async () => {
  context = await launchExtensionContext()
  popup = await openPopup(context, await getExtensionId(context))
  expect(await sendMessage(popup, "getGroupByMode")).toEqual({ mode: "linked" })
})
test.afterEach(async () => {
  await context?.close()
})

async function openLinkedPages() {
  const source = await context.newPage()
  await source.goto("https://source.test/research")
  await source.evaluate(() => {
    const link = document.createElement("a")
    link.href = "https://destination.test/article"
    link.textContent = "Read article"
    document.body.append(link)
  })
  const opened = context.waitForEvent("page")
  await source.getByRole("link", { name: "Read article" }).click({ modifiers: ["ControlOrMeta"] })
  const child = await opened
  await child.waitForLoadState("domcontentloaded")
  await expect
    .poll(async () =>
      popup.evaluate(async () => {
        const tabs = await chrome.tabs.query({})
        const root = tabs.find(tab => tab.url?.includes("source.test"))
        const child = tabs.find(tab => tab.url?.includes("destination.test"))
        return root?.groupId !== -1 && root?.groupId === child?.groupId
      })
    )
    .toBe(true)
  const titles = await popup.evaluate(async () =>
    (await chrome.tabGroups.query({})).map(group => group.title)
  )
  expect(titles[0]).toMatch(/^🔎 /)
  return { source, child }
}

test("Command-click keeps links together across navigation and cleans up", async () => {
  const { child } = await openLinkedPages()
  const groupId = await popup.evaluate(async () => (await chrome.tabGroups.query({}))[0].id)
  await child.goto("https://third.test/redirected")
  await expect
    .poll(async () =>
      popup.evaluate(async () => {
        const tab = (await chrome.tabs.query({})).find(tab => tab.url?.includes("third.test"))
        return tab?.groupId
      })
    )
    .toBe(groupId)
  await child.close()
  await expect
    .poll(async () => popup.evaluate(async () => (await chrome.tabGroups.query({})).length))
    .toBe(0)
})

test("a renamed group survives cleanup", async () => {
  const { child } = await openLinkedPages()
  await popup.evaluate(async () => {
    const [group] = await chrome.tabGroups.query({})
    await chrome.tabGroups.update(group.id, { title: "Keep research" })
  })
  await child.close()
  await expect
    .poll(async () =>
      popup.evaluate(async () => (await chrome.tabGroups.query({})).map(group => group.title))
    )
    .toEqual(["Keep research"])
})

test("manual ungrouping survives navigation and a background worker restart", async () => {
  const { child } = await openLinkedPages()
  await popup.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.includes("destination.test"))!
    await chrome.tabs.ungroup(tab.id!)
  })
  const cdp = await context.newCDPSession(popup)
  await cdp.send("ServiceWorker.enable")
  await cdp.send("ServiceWorker.stopAllWorkers")
  await child.goto("https://after-restart.test")
  await sendMessage(popup, "getGroupByMode")
  await expect
    .poll(async () =>
      popup.evaluate(async () => {
        const tab = (await chrome.tabs.query({})).find(tab =>
          tab.url?.includes("after-restart.test")
        )
        return tab?.groupId
      })
    )
    .toBe(-1)
})

test("settings show linked mode and the smaller models", async ({ browserName }, testInfo) => {
  await popup.setViewportSize({ width: 460, height: 850 })
  await popup.reload()
  await expect(popup.locator('[data-value="linked"]')).toHaveClass(/active/)
  await expect(popup.getByRole("button", { name: "New tab in current group" })).toBeVisible()
  await popup.screenshot({
    path: testInfo.outputPath(`${browserName}-popup.png`),
    fullPage: true,
    animations: "disabled"
  })
  const response = await sendMessage(popup, "getAiState")
  expect(response).toMatchObject({
    availableModels: expect.arrayContaining([
      expect.objectContaining({ id: "SmolLM2-360M-Instruct-q4f16_1-MLC" }),
      expect.objectContaining({ id: "SmolLM2-135M-Instruct-q0f16-MLC" })
    ])
  })
})

test("new tab command continues inside the active group", async () => {
  const { source } = await openLinkedPages()
  await source.bringToFront()
  const groupId = await popup.evaluate(async () => (await chrome.tabGroups.query({}))[0].id)
  const before = await popup.evaluate(async () => (await chrome.tabs.query({})).length)
  await sendMessage(popup, "newTabInGroup")
  await expect
    .poll(async () => popup.evaluate(async () => (await chrome.tabs.query({})).length))
    .toBe(before + 1)
  await expect
    .poll(async () =>
      popup.evaluate(async () => {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
        return active.groupId
      })
    )
    .toBe(groupId)
})

test("temporary group cleanup survives a worker restart", async () => {
  const { child } = await openLinkedPages()
  const cdp = await context.newCDPSession(popup)
  await cdp.send("ServiceWorker.enable")
  await cdp.send("ServiceWorker.stopAllWorkers")
  await child.close()
  await expect
    .poll(async () => popup.evaluate(async () => (await chrome.tabGroups.query({})).length))
    .toBe(0)
})

test("hybrid mode groups independent domain tabs and preserves a manual detach", async () => {
  const first = await context.newPage()
  await first.goto("https://www.example.test/one")
  const second = await context.newPage()
  await second.goto("https://docs.example.test/two")
  await expect
    .poll(async () =>
      popup.evaluate(async () => {
        const tabs = (await chrome.tabs.query({})).filter(tab => tab.url?.includes("example.test"))
        return tabs.length === 2 && tabs[0].groupId !== -1 && tabs[0].groupId === tabs[1].groupId
      })
    )
    .toBe(true)
  const detachedId = await popup.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.includes("/two"))!
    await chrome.tabs.ungroup(tab.id!)
    return tab.id!
  })
  const third = await context.newPage()
  await third.goto("https://example.test/three")
  await expect
    .poll(async () =>
      popup.evaluate(async () => {
        const tabs = await chrome.tabs.query({})
        const first = tabs.find(tab => tab.url?.includes("/one"))!
        const third = tabs.find(tab => tab.url?.includes("/three"))!
        return first.groupId !== -1 && first.groupId === third.groupId
      })
    )
    .toBe(true)
  expect(await popup.evaluate(async id => (await chrome.tabs.get(id)).groupId, detachedId)).toBe(-1)
})

test("Group Tabs organizes existing tabs and lists manual groups for naming", async () => {
  await sendMessage(popup, "toggleAutoGroup", { enabled: false })
  const first = await context.newPage()
  await first.goto("https://existing.test/one")
  const second = await context.newPage()
  await second.goto("https://existing.test/two")
  const third = await context.newPage()
  await third.goto("https://manual.test/project")
  const manualGroupId = await popup.evaluate(async () => {
    const tab = (await chrome.tabs.query({})).find(tab => tab.url?.includes("manual.test"))!
    const groupId = await chrome.tabs.group({ tabIds: [tab.id!] })
    await chrome.tabGroups.update(groupId, { title: "My saved project" })
    return groupId
  })
  await popup.bringToFront()
  await popup.reload()
  await popup.locator("#group").click()
  await expect
    .poll(async () =>
      popup.evaluate(async () => {
        const tabs = (await chrome.tabs.query({})).filter(tab => tab.url?.includes("existing.test"))
        return tabs.length === 2 && tabs[0].groupId !== -1 && tabs[0].groupId === tabs[1].groupId
      })
    )
    .toBe(true)
  const response = await sendMessage(popup, "getNamingGroups")
  expect(response).toMatchObject({
    groups: expect.arrayContaining([{ id: manualGroupId, title: "My saved project" }])
  })
  await sendMessage(popup, "setAiModelId", { modelId: "apple-system" })
  await sendMessage(popup, "setAiEnabled", { enabled: true })
  await popup.locator(".ai-toggle").click()
  await expect(
    popup.locator("#aiRenameGroupSelect option").filter({ hasText: "My saved project" })
  ).toHaveCount(1)
  await expect(popup.locator("#aiRenameGroupButton")).toBeVisible()
  await expect(popup.locator("#aiRenameGroupButton")).toBeDisabled()
})
