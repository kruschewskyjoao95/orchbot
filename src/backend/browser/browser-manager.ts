import { randomUUID } from 'node:crypto'
import type { BrowserBounds, BrowserPageContent, BrowserTab } from '../../shared/types'
import type { BrowserDriver } from './driver'
import { sanitizeUrl } from './sanitizer'
import { BrowserTabStore } from './tab-store'

export class BrowserManager {
  private tabStore: BrowserTabStore
  private driver: BrowserDriver
  private onTabUpdated?: (tab: BrowserTab) => void

  constructor(storageDir: string, driver: BrowserDriver) {
    this.tabStore = new BrowserTabStore(storageDir)
    this.driver = driver
  }

  public setOnTabUpdated(callback: (tab: BrowserTab) => void): void {
    this.onTabUpdated = callback
  }

  public getTabs(agentId: string): BrowserTab[] {
    return this.tabStore.getTabs(agentId)
  }

  public getTab(tabId: string): BrowserTab | undefined {
    return this.tabStore.getTab(tabId)
  }

  public async openTab(agentId: string, rawUrl: string): Promise<BrowserTab> {
    const validUrl = sanitizeUrl(rawUrl)
    const tabId = `tab-${randomUUID()}`
    const now = new Date().toISOString()

    const newTab: BrowserTab = {
      id: tabId,
      agentId,
      url: validUrl,
      title: 'Carregando...',
      isLoading: true,
      createdAt: now,
      updatedAt: now,
    }

    this.tabStore.saveTab(newTab)
    this.onTabUpdated?.(newTab)

    try {
      const navResult = await this.driver.openTab(agentId, tabId, validUrl)
      newTab.title = navResult.title
      newTab.url = navResult.url
      newTab.isLoading = false
      newTab.updatedAt = new Date().toISOString()

      this.tabStore.saveTab(newTab)
      this.onTabUpdated?.(newTab)
      return newTab
    } catch (err) {
      newTab.title = 'Erro ao carregar'
      newTab.isLoading = false
      newTab.updatedAt = new Date().toISOString()
      this.tabStore.saveTab(newTab)
      this.onTabUpdated?.(newTab)
      throw err
    }
  }

  public async closeTab(agentId: string, tabId: string): Promise<boolean> {
    const tab = this.tabStore.getTab(tabId)
    if (!tab || tab.agentId !== agentId) {
      return false
    }

    await this.driver.closeTab(tabId)
    const removed = this.tabStore.removeTab(tabId)
    return removed
  }

  public async navigate(
    agentId: string,
    tabId: string,
    action: 'back' | 'forward' | 'reload',
  ): Promise<BrowserTab> {
    const tab = this.tabStore.getTab(tabId)
    if (!tab || tab.agentId !== agentId) {
      throw new Error('Aba não encontrada ou não pertence ao agente')
    }

    tab.isLoading = true
    this.onTabUpdated?.(tab)

    try {
      const navResult = await this.driver.navigate(tabId, action)
      tab.title = navResult.title
      tab.url = navResult.url
      tab.isLoading = false
      tab.updatedAt = new Date().toISOString()
      this.tabStore.saveTab(tab)
      this.onTabUpdated?.(tab)
      return tab
    } catch (err) {
      tab.isLoading = false
      this.onTabUpdated?.(tab)
      throw err
    }
  }

  public async inspect(agentId: string, tabId: string): Promise<BrowserPageContent> {
    const tab = this.tabStore.getTab(tabId)
    if (!tab || tab.agentId !== agentId) {
      throw new Error('Aba não encontrada ou não pertence ao agente')
    }

    return await this.driver.inspect(tabId)
  }

  public async click(agentId: string, tabId: string, selector: string): Promise<boolean> {
    const tab = this.tabStore.getTab(tabId)
    if (!tab || tab.agentId !== agentId) {
      throw new Error('Aba não encontrada ou não pertence ao agente')
    }

    const res = await this.driver.click(tabId, selector)
    return res.clicked
  }

  public async fill(
    agentId: string,
    tabId: string,
    selector: string,
    value: string,
  ): Promise<boolean> {
    const tab = this.tabStore.getTab(tabId)
    if (!tab || tab.agentId !== agentId) {
      throw new Error('Aba não encontrada ou não pertence ao agente')
    }

    const res = await this.driver.fill(tabId, selector, value)
    return res.filled
  }

  public async captureScreenshot(agentId: string, tabId: string): Promise<string> {
    const tab = this.tabStore.getTab(tabId)
    if (!tab || tab.agentId !== agentId) {
      throw new Error('Aba não encontrada ou não pertence ao agente')
    }

    return await this.driver.captureScreenshot(tabId)
  }

  public async runScript(agentId: string, tabId: string, script: string): Promise<unknown> {
    const tab = this.tabStore.getTab(tabId)
    if (!tab || tab.agentId !== agentId) {
      throw new Error('Aba não encontrada ou não pertence ao agente')
    }

    return await this.driver.runScript(tabId, script)
  }

  public setPageWindowListener(
    listener: (tabId: string, state: 'visible' | 'hidden' | 'docked') => void,
  ): void {
    this.driver.setPageWindowListener?.(listener)
  }

  public pageWindowState(agentId: string, tabId: string): 'visible' | 'hidden' | 'none' {
    const tab = this.tabStore.getTab(tabId)
    if (!tab || tab.agentId !== agentId) return 'none'
    return this.driver.pageWindowState?.(tabId) ?? 'none'
  }

  public openPageWindow(agentId: string, tabId: string): void {
    this.requireOwnTab(agentId, tabId)
    if (!this.driver.openPageWindow) throw new Error('Janela da página indisponível nesta sessão.')
    this.driver.openPageWindow(tabId)
  }

  public showPageWindow(agentId: string, tabId: string): void {
    this.requireOwnTab(agentId, tabId)
    if (!this.driver.showPageWindow) throw new Error('Janela da página indisponível nesta sessão.')
    this.driver.showPageWindow(tabId)
  }

  public closePageWindows(): void {
    this.driver.closePageWindows?.()
  }

  public dockPageWindow(agentId: string, tabId: string): void {
    this.requireOwnTab(agentId, tabId)
    this.driver.dockPageWindow?.(tabId)
  }

  private requireOwnTab(agentId: string, tabId: string): void {
    const tab = this.tabStore.getTab(tabId)
    if (!tab || tab.agentId !== agentId) {
      throw new Error('Aba não encontrada ou não pertence ao agente')
    }
  }

  public setBounds(agentId: string, tabId: string, bounds: BrowserBounds | null): void {
    const tab = this.tabStore.getTab(tabId)
    if (!tab || tab.agentId !== agentId) return

    if (bounds) {
      this.driver.attachView?.(tabId, bounds)
    } else {
      this.driver.detachView?.(tabId)
    }
  }

  public async removeAgent(agentId: string): Promise<void> {
    const tabs = this.tabStore.getTabs(agentId)
    for (const tab of tabs) {
      await this.driver.closeTab(tab.id)
    }
    this.tabStore.removeAgentTabs(agentId)
  }
}
