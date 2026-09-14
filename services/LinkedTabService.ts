import type { Browser } from "wxt/browser"
import { getRandomTabGroupColor } from "../utils/Constants"
import { groupNamingRequest, type NamingTab, parseGroupName } from "../utils/GroupNaming"
import { createLinkedGroupTitle } from "../utils/LinkedGroupTitle"
import { withTabEditRetry } from "../utils/withTabEditRetry"
import { aiService } from "./ai/AiService"
import { appleFmProvider } from "./ai/AppleFmProvider"
import { rulesService } from "./RulesService"
import { tabGroupState } from "./TabGroupState"

interface LinkedGroup {
  rootTabId: number
  title: string
  kept: boolean
  fingerprint?: string
}
interface LinkedSession {
  pending: Record<string, number>
  groups: Record<string, LinkedGroup>
}

const SESSION_KEY = "linkedTabSession"

function readSession(value: unknown): LinkedSession {
  const result: LinkedSession = { pending: {}, groups: {} }
  if (!value || typeof value !== "object") return result
  const data = value as Record<string, unknown>
  if (data.pending && typeof data.pending === "object") {
    for (const [id, opener] of Object.entries(data.pending)) {
      if (/^\d+$/.test(id) && Number.isInteger(opener) && Number(opener) >= 0) {
        result.pending[id] = Number(opener)
      }
    }
  }
  if (data.groups && typeof data.groups === "object") {
    for (const [id, value] of Object.entries(data.groups)) {
      if (!/^\d+$/.test(id) || !value || typeof value !== "object") continue
      const group = value as Record<string, unknown>
      if (
        Number.isInteger(group.rootTabId) &&
        typeof group.title === "string" &&
        typeof group.kept === "boolean"
      ) {
        result.groups[id] = {
          rootTabId: Number(group.rootTabId),
          title: group.title,
          kept: group.kept,
          fingerprint: typeof group.fingerprint === "string" ? group.fingerprint : undefined
        }
      }
    }
  }
  return result
}

/** Only new link openings establish membership. Navigation never reclassifies a tab. */
export class LinkedTabService {
  // Serialize browser mutations, including rapid sibling opens and cleanup. Session
  // storage survives worker suspension, but never reuses tab IDs across browser sessions.
  private queue: Promise<unknown> = Promise.resolve()
  private namingTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private namingInFlight = new Set<number>()
  private namingAgain = new Set<number>()

  private run<T>(operation: (state: LinkedSession) => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      const stored = await browser.storage.session.get(SESSION_KEY)
      const state = readSession(stored[SESSION_KEY])
      const result = await operation(state)
      await browser.storage.session.set({ [SESSION_KEY]: state })
      return result
    })
    this.queue = task.catch(error => console.error("[Linked tabs]", error))
    return task
  }

  onCreated(tab: Browser.tabs.Tab): Promise<void> {
    return this.run(async state => {
      if (!this.enabled() || tab.id === undefined || tab.openerTabId === undefined) return
      state.pending[tab.id] = tab.openerTabId
      await this.groupPending(tab.id, state)
    }).then(() => (tab.id === undefined ? undefined : this.scheduleName(tab.id)))
  }

  onUpdated(tabId: number): Promise<void> {
    return this.run(async state => {
      if (!this.enabled()) return
      await this.groupPending(tabId, state)
    }).then(() => this.scheduleName(tabId))
  }

  private async scheduleName(tabId: number): Promise<void> {
    if (!this.enabled() || !aiService.isEnabled() || aiService.getSelectedProvider() !== "apple")
      return
    const tab = await this.getTab(tabId)
    const groupId = tab?.groupId
    if (groupId === undefined || groupId === -1) return
    clearTimeout(this.namingTimers.get(groupId))
    this.namingTimers.set(
      groupId,
      setTimeout(() => {
        this.namingTimers.delete(groupId)
        this.nameGroup(groupId).catch(error => console.warn("[Linked group naming]", error))
      }, 1000)
    )
  }

  /** Model inference never holds the grouping queue. Commit only a still-current result. */
  async nameGroup(groupId: number): Promise<void> {
    if (!this.enabled() || !aiService.isEnabled() || aiService.getSelectedProvider() !== "apple")
      return
    if (this.namingInFlight.has(groupId)) {
      this.namingAgain.add(groupId)
      return
    }
    this.namingInFlight.add(groupId)
    try {
      if (!(await appleFmProvider.isConnected())) return
      const snapshot = await this.run(async state => {
        const record = state.groups[groupId]
        if (!record || record.kept) return null
        const group = await browser.tabGroups.get(groupId)
        if (
          group.title !== record.title ||
          tabGroupState.protectedGroupTitles.includes(record.title)
        )
          return null
        const tabs = await browser.tabs.query({ groupId })
        const context = tabs.map(tab => ({
          title: tab.title || "",
          hostname: new URL(tab.url || "about:blank").hostname
        }))
        const fingerprint = JSON.stringify(context)
        return record.fingerprint === fingerprint
          ? null
          : {
              title: record.title,
              fingerprint,
              context: this.prioritizeChangedTabs(context, record.fingerprint)
            }
      })
      if (!snapshot) return
      const completion = await aiService.complete(
        groupNamingRequest(snapshot.context, snapshot.title)
      )
      const title = parseGroupName(completion.content)
      await this.run(async state => {
        const record = state.groups[groupId]
        if (
          !record ||
          record.kept ||
          record.title !== snapshot.title ||
          !this.enabled() ||
          !aiService.isEnabled() ||
          aiService.getSelectedProvider() !== "apple" ||
          !(await appleFmProvider.isConnected())
        )
          return
        const group = await browser.tabGroups.get(groupId)
        if (
          group.title !== snapshot.title ||
          tabGroupState.protectedGroupTitles.includes(group.title || "")
        )
          return
        const tabs = await browser.tabs.query({ groupId })
        const current = tabs.map(tab => ({
          title: tab.title || "",
          hostname: new URL(tab.url || "about:blank").hostname
        }))
        if (JSON.stringify(current) !== snapshot.fingerprint) return
        record.title = title
        record.fingerprint = snapshot.fingerprint
        await browser.storage.session.set({ [SESSION_KEY]: state })
        if (title !== group.title)
          await withTabEditRetry(() => browser.tabGroups.update(groupId, { title }))
      })
    } finally {
      this.namingInFlight.delete(groupId)
      if (this.namingAgain.delete(groupId)) await this.nameGroup(groupId)
    }
  }

  private prioritizeChangedTabs(tabs: NamingTab[], previous?: string): NamingTab[] {
    // Put new/changed subjects into the bounded prompt even in large groups.
    // The complete membership fingerprint still controls whether a result is stale.
    if (tabs.length <= 12) return tabs
    let old: unknown
    try {
      old = previous ? JSON.parse(previous) : []
    } catch {
      old = []
    }
    const known = new Set(Array.isArray(old) ? old.map(tab => JSON.stringify(tab)) : [])
    return [
      ...tabs.filter(tab => !known.has(JSON.stringify(tab))),
      ...tabs.filter(tab => known.has(JSON.stringify(tab)))
    ]
  }

  private enabled(): boolean {
    return tabGroupState.autoGroupingEnabled && tabGroupState.groupByMode === "linked"
  }

  private async getTab(id: number): Promise<Browser.tabs.Tab | null> {
    try {
      return await browser.tabs.get(id)
    } catch {
      // A closed opener or child is a normal race, not a reason to guess a group.
      return null
    }
  }

  private async groupPending(tabId: number, state: LinkedSession): Promise<void> {
    const openerId = state.pending[tabId]
    if (openerId === undefined) return
    const tab = await this.getTab(tabId)
    if (!tab) {
      delete state.pending[tabId]
      return
    }
    const url = tab.pendingUrl || tab.url || ""
    if (!url || url === "about:blank" || url.startsWith("chrome://newtab")) return
    // Consume once: dragging out, ungrouping, redirects and later navigation
    // must not pull this tab back into the opener's group.
    delete state.pending[tabId]
    if (tab.pinned || (tab.groupId !== undefined && tab.groupId !== -1)) return
    if (!/^https?:\/\//.test(url)) return
    const opener = await this.getTab(openerId)
    if (!opener || opener.pinned || opener.windowId !== tab.windowId) return
    if (!/^https?:\/\//.test(opener.url || "")) return
    if (await rulesService.findBlacklistMatch(url, tab.title)) return
    if (await rulesService.findBlacklistMatch(opener.url || "", opener.title)) return

    if (opener.groupId !== undefined && opener.groupId !== -1) {
      await withTabEditRetry(() => browser.tabs.group({ tabIds: [tabId], groupId: opener.groupId }))
      return
    }
    const title = createLinkedGroupTitle(opener.title, opener.url!)
    const groupId = await withTabEditRetry(() => browser.tabs.group({ tabIds: [openerId, tabId] }))
    // Persist ownership before setting the title, so onUpdated can distinguish
    // our initial label from a subsequent user rename.
    state.groups[groupId] = { rootTabId: openerId, title, kept: false }
    await browser.storage.session.set({ [SESSION_KEY]: state })
    await withTabEditRetry(() =>
      browser.tabGroups.update(groupId, { title, color: getRandomTabGroupColor() })
    )
  }

  onGroupUpdated(group: Browser.tabGroups.TabGroup): Promise<void> {
    return this.run(async state => {
      const record = state.groups[group.id]
      if (record && group.title && group.title !== record.title) record.kept = true
    })
  }

  clearPending(): Promise<void> {
    return this.run(async state => {
      state.pending = {}
    })
  }

  cleanup(removedTabId?: number): Promise<void> {
    return this.run(async state => {
      if (removedTabId !== undefined) delete state.pending[removedTabId]
      if (!this.enabled()) return
      const groups = await browser.tabGroups.query({})
      for (const [key, record] of Object.entries(state.groups)) {
        const groupId = Number(key)
        const group = groups.find(candidate => candidate.id === groupId)
        if (!group) {
          delete state.groups[key]
          continue
        }
        if (
          record.kept ||
          group.title !== record.title ||
          tabGroupState.protectedGroupTitles.includes(group.title || "")
        )
          continue
        const tabs = await browser.tabs.query({ groupId })
        if (tabs.length === 1 && tabs[0].id === record.rootTabId) {
          await withTabEditRetry(() => browser.tabs.ungroup([record.rootTabId]))
          delete state.groups[key]
        }
      }
    })
  }

  async newTabInGroup(): Promise<void> {
    const [active] = await browser.tabs.query({ active: true, currentWindow: true })
    if (!active || active.id === undefined) return
    const tab = await browser.tabs.create({
      windowId: active.windowId,
      openerTabId: active.id,
      index: active.index + 1
    })
    if (tab.id !== undefined && active.groupId !== undefined && active.groupId !== -1) {
      await withTabEditRetry(() =>
        browser.tabs.group({ tabIds: [tab.id!], groupId: active.groupId })
      )
    }
  }
}

export const linkedTabService = new LinkedTabService()
