import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserManager } from '../src/backend/browser/browser-manager'
import { MockBrowserDriver } from '../src/backend/browser/driver'

describe('BrowserManager', () => {
  let testDir: string
  let manager: BrowserManager
  let driver: MockBrowserDriver

  beforeEach(() => {
    testDir = path.join(process.cwd(), `tmp-test-mgr-${Date.now()}`)
    fs.mkdirSync(testDir, { recursive: true })
    driver = new MockBrowserDriver()
    manager = new BrowserManager(testDir, driver)
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('abre aba web com sucesso e atualiza metadados', async () => {
    const tab = await manager.openTab('agent-1', 'https://example.com')
    expect(tab.id).toBeDefined()
    expect(tab.agentId).toBe('agent-1')
    expect(tab.url).toBe('https://example.com/')
    expect(tab.title).toContain('example.com')
    expect(tab.isLoading).toBe(false)

    const tabs = manager.getTabs('agent-1')
    expect(tabs).toHaveLength(1)
  })

  it('bloqueia abertura de URLs inseguras ou proibidas', async () => {
    await expect(manager.openTab('agent-1', 'file:///etc/hosts')).rejects.toThrow(
      'Protocolo proibido',
    )
    expect(manager.getTabs('agent-1')).toHaveLength(0)
  })

  it('permite navegação (reload, back, forward)', async () => {
    const tab = await manager.openTab('agent-1', 'https://orchbot.local')
    const reloaded = await manager.navigate('agent-1', tab.id, 'reload')
    expect(reloaded.id).toBe(tab.id)
    expect(reloaded.url).toBe('https://orchbot.local/')
  })

  it('inspeciona a página e extrai estrutura DOM sanitizada', async () => {
    const tab = await manager.openTab('agent-1', 'https://example.org')
    const content = await manager.inspect('agent-1', tab.id)

    expect(content.tabId).toBe(tab.id)
    expect(content.url).toBe('https://example.org/')
    expect(content.links.length).toBeGreaterThan(0)
    expect(content.inputs.length).toBeGreaterThan(0)
    expect(content.textSummary).toContain('Bem-vindo')
  })

  it('executa clique em elemento existente', async () => {
    const tab = await manager.openTab('agent-1', 'https://example.org')
    const clicked = await manager.click('agent-1', tab.id, '#submit-btn')
    expect(clicked).toBe(true)
  })

  it('falha ao tentar clicar em seletor inexistente', async () => {
    const tab = await manager.openTab('agent-1', 'https://example.org')
    await expect(manager.click('agent-1', tab.id, '#non-existent')).rejects.toThrow(
      'Elemento não encontrado no DOM',
    )
  })

  it('preenche campo de formulário', async () => {
    const tab = await manager.openTab('agent-1', 'https://example.org')
    const filled = await manager.fill('agent-1', tab.id, '#search-box', 'Orchbot test')
    expect(filled).toBe(true)
  })

  it('captura screenshot da aba', async () => {
    const tab = await manager.openTab('agent-1', 'https://example.org')
    const base64 = await manager.captureScreenshot('agent-1', tab.id)
    expect(base64).toMatch(/^data:image\/png;base64,/)
  })

  it('executa scripts na página', async () => {
    const tab = await manager.openTab('agent-1', 'https://example.org')
    const title = await manager.runScript('agent-1', tab.id, 'document.title')
    expect(title).toContain('example.org')
  })

  it('fecha aba e remove do armazenamento', async () => {
    const tab = await manager.openTab('agent-1', 'https://example.org')
    const closed = await manager.closeTab('agent-1', tab.id)
    expect(closed).toBe(true)
    expect(manager.getTabs('agent-1')).toHaveLength(0)
  })

  it('remove todas as abas ao deletar o agente', async () => {
    await manager.openTab('agent-1', 'https://example.org')
    await manager.openTab('agent-1', 'https://github.com')
    await manager.openTab('agent-2', 'https://google.com')

    expect(manager.getTabs('agent-1')).toHaveLength(2)
    expect(manager.getTabs('agent-2')).toHaveLength(1)

    await manager.removeAgent('agent-1')
    expect(manager.getTabs('agent-1')).toHaveLength(0)
    expect(manager.getTabs('agent-2')).toHaveLength(1)
  })
})
