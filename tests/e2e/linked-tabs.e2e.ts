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
