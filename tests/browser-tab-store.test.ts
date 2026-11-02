import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserTabStore } from '../src/backend/browser/tab-store'
import type { BrowserTab } from '../src/shared/types'

describe('BrowserTabStore', () => {
  let testDir: string
  let store: BrowserTabStore

  beforeEach(() => {
    testDir = path.join(process.cwd(), `tmp-test-tabs-${Date.now()}`)
    fs.mkdirSync(testDir, { recursive: true })
    store = new BrowserTabStore(testDir)
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('inicia com lista vazia de abas quando arquivo não existe', () => {
    const file = store.load()
    expect(file.version).toBe(1)
    expect(file.tabs).toEqual([])
  })

  it('salva e recupera abas com persistência versionada no browser-tabs.json', () => {
    const tab: BrowserTab = {
      id: 'tab-1',
      agentId: 'agent-a',
      url: 'https://example.com',
      title: 'Example Domain',
      isLoading: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    store.saveTab(tab)

    const tabsA = store.getTabs('agent-a')
    expect(tabsA).toHaveLength(1)
    expect(tabsA[0].id).toBe('tab-1')
    expect(tabsA[0].url).toBe('https://example.com')

    // Confere que arquivo físico existe fora do DB
    expect(fs.existsSync(store.getFilePath())).toBe(true)

    // Atualiza aba existente
    tab.title = 'Novo Título'
    store.saveTab(tab)
    const updated = store.getTab('tab-1')
    expect(updated?.title).toBe('Novo Título')
  })

  it('filtra abas por agentId corretamente', () => {
    store.saveTab({
      id: 'tab-1',
      agentId: 'agent-a',
      url: 'https://example.com',
      title: 'A',
      isLoading: false,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })
    store.saveTab({
      id: 'tab-2',
      agentId: 'agent-b',
      url: 'https://github.com',
      title: 'B',
      isLoading: false,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })

    expect(store.getTabs('agent-a')).toHaveLength(1)
    expect(store.getTabs('agent-b')).toHaveLength(1)
    expect(store.getTabs()).toHaveLength(2)
  })

  it('remove aba individual e limpa abas do agente', () => {
    store.saveTab({
      id: 'tab-1',
      agentId: 'agent-a',
      url: 'https://example.com',
      title: 'A',
      isLoading: false,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })
    store.saveTab({
      id: 'tab-2',
      agentId: 'agent-a',
      url: 'https://orchbot.org',
      title: 'A2',
      isLoading: false,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    })

    const removed = store.removeTab('tab-1')
    expect(removed).toBe(true)
    expect(store.getTabs('agent-a')).toHaveLength(1)

    store.removeAgentTabs('agent-a')
    expect(store.getTabs('agent-a')).toHaveLength(0)
  })

  it('recupera graciosamente se browser-tabs.json for corrompido', () => {
    fs.writeFileSync(store.getFilePath(), '{ corrupt json content ...', 'utf-8')
    const loaded = store.load()
    expect(loaded.version).toBe(1)
    expect(loaded.tabs).toEqual([])
  })
})
