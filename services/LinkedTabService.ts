import type { Browser } from "wxt/browser"
import { getRandomTabGroupColor } from "../utils/Constants"
import { extractDomain } from "../utils/DomainUtils"
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
  pending: Record<string, number | null>
  domainExcluded: number[]
  groups: Record<string, LinkedGroup>
}

const SESSION_KEY = "linkedTabSession"

function readSession(value: unknown): LinkedSession {
  const result: LinkedSession = { pending: {}, groups: {}, domainExcluded: [] }
  if (!value || typeof value !== "object") return result
  const data = value as Record<string, unknown>
  if (data.pending && typeof data.pending === "object") {
    for (const [id, opener] of Object.entries(data.pending)) {
      if (
        /^\d+$/.test(id) &&
        (opener === null || (Number.isInteger(opener) && Number(opener) >= 0))
      ) {
        result.pending[id] = opener === null ? null : Number(opener)
      }
    }
  }
  if (Array.isArray(data.domainExcluded))
    result.domainExcluded = data.domainExcluded.filter(
      (id): id is number => Number.isInteger(id) && id >= 0
    )
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

/** New tabs use opener context first, then domain peers. Navigation never reclassifies them. */
export class LinkedTabService {
  // Serialize browser mutations, including rapid sibling opens and cleanup. Session
  // storage survives worker suspension, but never reuses tab IDs across browser sessions.
  private queue: Promise<unknown> = Promise.resolve()
  private automaticUngroups = new Set<number>()
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
      if (!this.enabled() || tab.id === undefined) return
      state.pending[tab.id] = tab.openerTabId ?? null
      await this.groupPending(tab.id, state)
    }).then(() => (tab.id === undefined ? undefined : this.scheduleName(tab.id)))
  }

  onUpdated(tabId: number, detached = false): Promise<void> {
    return this.run(async state => {
      if (!this.enabled()) return
      if (
        detached &&
        !this.automaticUngroups.delete(tabId) &&
        !state.domainExcluded.includes(tabId)
      )
        state.domainExcluded.push(tabId)
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
    if (
      !url ||
      /^about:(blank|newtab|home)$/.test(url) ||
      /^(chrome|edge):\/\/newtab/.test(url) ||
      /^chrome-extension:\/\/[^/]+\/newtab\.html/.test(url)
    )
      return
    // Consume once: dragging out, ungrouping, redirects and later navigation
    // must not pull this tab back into the opener's group.
    delete state.pending[tabId]
    if (tab.pinned || (tab.groupId !== undefined && tab.groupId !== -1)) return
    if (!/^https?:\/\//.test(url)) return
    if (await rulesService.findBlacklistMatch(url, tab.title)) return
    const opener = openerId === null ? null : await this.getTab(openerId)
    if (
      !opener ||
      opener.pinned ||
      opener.windowId !== tab.windowId ||
      !/^https?:\/\//.test(opener.url || "") ||
      (await rulesService.findBlacklistMatch(opener.url || "", opener.title))
    ) {
      await this.groupByDomain({ ...tab, url }, state)
      return
    }

    if (opener.groupId !== undefined && opener.groupId !== -1) {
      await withTabEditRetry(() => browser.tabs.group({ tabIds: [tabId], groupId: opener.groupId }))
      return
    }
    const title = createLinkedGroupTitle(opener.title, opener.url!)
    const groupId = await withTabEditRetry(() =>
      browser.tabs.group({ tabIds: [opener.id!, tabId] })
    )
    // Persist ownership before setting the title, so onUpdated can distinguish
    // our initial label from a subsequent user rename.
    state.groups[groupId] = { rootTabId: opener.id!, title, kept: false }
    await browser.storage.session.set({ [SESSION_KEY]: state })
    await withTabEditRetry(() =>
      browser.tabGroups.update(groupId, { title, color: getRandomTabGroupColor() })
    )
  }

  private async groupByDomain(tab: Browser.tabs.Tab, state: LinkedSession): Promise<void> {
    if (
      tab.id === undefined ||
      tab.pinned ||
      (tab.groupId !== undefined && tab.groupId !== -1) ||
      state.domainExcluded.includes(tab.id) ||
      !/^https?:\/\//.test(tab.url || "")
    )
      return
    const domain = extractDomain(tab.url || "")
    if (!domain || domain === "system") return
    if (await rulesService.findBlacklistMatch(tab.url || "", tab.title)) return
    const windowTabs = await browser.tabs.query({ windowId: tab.windowId })
    const peers: Browser.tabs.Tab[] = []
    for (const candidate of windowTabs) {
      if (
        candidate.id === tab.id ||
        candidate.id === undefined ||
        candidate.pinned ||
        state.domainExcluded.includes(candidate.id) ||
        !/^https?:\/\//.test(candidate.url || "") ||
        extractDomain(candidate.url || "") !== domain ||
        (await rulesService.findBlacklistMatch(candidate.url || "", candidate.title))
      )
        continue
      peers.push(candidate)
    }
    // Only extend an unambiguous automatic group entirely on this domain.
    // A single shared site must not merge distinct cross-site projects.
    const matchingGroups: number[] = []
    for (const groupId of new Set(
      peers.map(peer => peer.groupId).filter((id): id is number => id !== undefined && id !== -1)
    )) {
      const record = state.groups[groupId]
      if (!record || record.kept) continue
      const group = await browser.tabGroups.get(groupId)
      if (
        group.title !== record.title ||
        tabGroupState.protectedGroupTitles.includes(group.title || "")
      )
        continue
      if (
        windowTabs
          .filter(member => member.groupId === groupId)
          .every(
            member =>
              /^https?:\/\//.test(member.url || "") && extractDomain(member.url || "") === domain
          )
      )
        matchingGroups.push(groupId)
    }
    if (matchingGroups.length > 1) return
    if (matchingGroups.length === 1) {
      await withTabEditRetry(() =>
        browser.tabs.group({ tabIds: [tab.id!], groupId: matchingGroups[0] })
      )
      return
    }
    const ungrouped = peers.filter(peer => peer.groupId === undefined || peer.groupId === -1)
    if (ungrouped.length === 0) return
    const title = createLinkedGroupTitle(domain, tab.url!)
    const groupId = await withTabEditRetry(() =>
      browser.tabs.group({
        tabIds: [ungrouped[0].id!, ...ungrouped.slice(1).map(peer => peer.id!), tab.id!]
      })
    )
    state.groups[groupId] = { rootTabId: ungrouped[0].id!, title, kept: false }
    await browser.storage.session.set({ [SESSION_KEY]: state })
    await withTabEditRetry(() =>
      browser.tabGroups.update(groupId, { title, color: getRandomTabGroupColor() })
    )
  }

  async groupExistingTabs(): Promise<void> {
    const ids = await this.run(async state => {
      const tabs = await browser.tabs.query({ currentWindow: true })
      for (const tab of tabs) {
        if (tab.id === undefined) continue
        const current = await this.getTab(tab.id)
        if (current) await this.groupByDomain(current, state)
      }
      return tabs.map(tab => tab.id).filter((id): id is number => id !== undefined)
    })
    await Promise.all(ids.map(id => this.scheduleName(id)))
  }

  async renameExistingGroup(groupId: number): Promise<string> {
    if (!Number.isInteger(groupId) || groupId < 0) throw new Error("Choose a tab group first.")
    if (
      !aiService.isEnabled() ||
      aiService.getSelectedProvider() !== "apple" ||
      !(await appleFmProvider.isConnected())
    )
      throw new Error("Enable AI and connect Apple Foundation Models first.")
    if (this.namingInFlight.has(groupId))
      throw new Error("This group is already being named. Try again shortly.")
    this.namingInFlight.add(groupId)
    try {
      const group = await browser.tabGroups.get(groupId)
      if (tabGroupState.protectedGroupTitles.includes(group.title || ""))
        throw new Error("This group is protected. Remove its protection before renaming it.")
      const tabs = await browser.tabs.query({ groupId })
      const context = tabs.map(tab => ({
        title: tab.title || "",
        hostname: new URL(tab.url || "about:blank").hostname
      }))
      if (!context.length) throw new Error("This group has no tabs.")
      const fingerprint = JSON.stringify(context)
      const membership = JSON.stringify(tabs.map(tab => tab.id))
      const completion = await aiService.complete(groupNamingRequest(context, group.title))
      const title = parseGroupName(completion.content)
      await this.run(async state => {
        const currentGroup = await browser.tabGroups.get(groupId)
        const currentTabs = await browser.tabs.query({ groupId })
        const current = currentTabs.map(tab => ({
          title: tab.title || "",
          hostname: new URL(tab.url || "about:blank").hostname
        }))
        if (
          currentGroup.title !== group.title ||
          JSON.stringify(current) !== fingerprint ||
          JSON.stringify(currentTabs.map(tab => tab.id)) !== membership
        )
          throw new Error("The group changed while naming. Try again with its current tabs.")
        if (
          !aiService.isEnabled() ||
          aiService.getSelectedProvider() !== "apple" ||
          !(await appleFmProvider.isConnected())
        )
          throw new Error("Apple naming was disconnected.")
        if (tabGroupState.protectedGroupTitles.includes(currentGroup.title || ""))
          throw new Error("This group is now protected.")
        // Explicit naming does not claim ownership of pre-existing or manual groups.
        const record = state.groups[groupId]
        if (record) {
          record.title = title
          record.fingerprint = fingerprint
          await browser.storage.session.set({ [SESSION_KEY]: state })
        }
        if (title !== currentGroup.title)
          await withTabEditRetry(() => browser.tabGroups.update(groupId, { title }))
      })
      return title
    } finally {
      this.namingInFlight.delete(groupId)
      if (this.namingAgain.delete(groupId)) await this.nameGroup(groupId)
    }
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
      if (removedTabId !== undefined) {
        delete state.pending[removedTabId]
        state.domainExcluded = state.domainExcluded.filter(id => id !== removedTabId)
      }
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
          this.automaticUngroups.add(record.rootTabId)
          try {
            await withTabEditRetry(() => browser.tabs.ungroup([record.rootTabId]))
          } catch (error) {
            this.automaticUngroups.delete(record.rootTabId)
            throw error
          }
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
