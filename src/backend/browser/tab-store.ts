import fs from 'node:fs'
import path from 'node:path'
import type { BrowserTab } from '../../shared/types'

export interface BrowserTabsFile {
  version: number
  updatedAt: string
  tabs: BrowserTab[]
}

export class BrowserTabStore {
  private filePath: string

  constructor(storageDir: string) {
    this.filePath = path.join(storageDir, 'browser-tabs.json')
  }

  public getFilePath(): string {
    return this.filePath
  }

  public load(): BrowserTabsFile {
    if (!fs.existsSync(this.filePath)) {
      return {
        version: 1,
        updatedAt: new Date().toISOString(),
        tabs: [],
      }
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const data = JSON.parse(raw) as BrowserTabsFile
      if (typeof data === 'object' && data !== null && Array.isArray(data.tabs)) {
        return {
          version: typeof data.version === 'number' ? data.version : 1,
          updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
          tabs: data.tabs,
        }
      }
    } catch {
      // Falha ao parsear ou arquivo corrompido: recupera estrutura limpa
    }

    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      tabs: [],
    }
  }

  public save(tabs: BrowserTab[]): void {
    const data: BrowserTabsFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      tabs,
    }

    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const tempPath = `${this.filePath}.tmp.${Date.now()}`
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tempPath, this.filePath)
  }

  public getTabs(agentId?: string): BrowserTab[] {
    const file = this.load()
    if (!agentId) {
      return file.tabs
    }
    return file.tabs.filter((t) => t.agentId === agentId)
  }

  public getTab(tabId: string): BrowserTab | undefined {
    const file = this.load()
    return file.tabs.find((t) => t.id === tabId)
  }

  public saveTab(tab: BrowserTab): void {
    const file = this.load()
    const index = file.tabs.findIndex((t) => t.id === tab.id)
    if (index >= 0) {
      file.tabs[index] = tab
    } else {
      file.tabs.push(tab)
    }
    this.save(file.tabs)
  }

  public removeTab(tabId: string): boolean {
    const file = this.load()
    const filtered = file.tabs.filter((t) => t.id !== tabId)
    if (filtered.length !== file.tabs.length) {
      this.save(filtered)
      return true
    }
    return false
  }

  public removeAgentTabs(agentId: string): void {
    const file = this.load()
    const filtered = file.tabs.filter((t) => t.agentId !== agentId)
    this.save(filtered)
  }
}
