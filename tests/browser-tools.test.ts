import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserManager } from '../src/backend/browser/browser-manager'
import { BROWSER_TOOLS, executeBrowserTool } from '../src/backend/browser/browser-tools'
import { MockBrowserDriver } from '../src/backend/browser/driver'

describe('Browser Tools (openbot_browser.*)', () => {
  let testDir: string
  let manager: BrowserManager

  beforeEach(() => {
    testDir = path.join(process.cwd(), `tmp-test-tools-${Date.now()}`)
    fs.mkdirSync(testDir, { recursive: true })
    manager = new BrowserManager(testDir, new MockBrowserDriver())
  })

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('declara catálogo completo de ferramentas openbot_browser.*', () => {
    const names = BROWSER_TOOLS.map((t) => t.name)
    expect(names).toContain('openbot_browser.open')
    expect(names).toContain('openbot_browser.inspect')
    expect(names).toContain('openbot_browser.click')
    expect(names).toContain('openbot_browser.fill')
    expect(names).toContain('openbot_browser.screenshot')
    expect(names).toContain('openbot_browser.close')
  })

  it('executa openbot_browser.open e openbot_browser.inspect', async () => {
    const openRes = (await executeBrowserTool(manager, 'agent-1', 'openbot_browser.open', {
      url: 'https://example.com',
    })) as { id: string; url: string }

    expect(openRes.id).toBeDefined()
    expect(openRes.url).toBe('https://example.com/')

    const inspectRes = (await executeBrowserTool(manager, 'agent-1', 'openbot_browser.inspect', {
      tabId: openRes.id,
    })) as { textSummary: string; links: unknown[] }

    expect(inspectRes.textSummary).toContain('Bem-vindo')
    expect(inspectRes.links.length).toBeGreaterThan(0)
  })

  it('executa openbot_browser.fill e openbot_browser.click', async () => {
    const openRes = (await executeBrowserTool(manager, 'agent-1', 'openbot_browser.open', {
      url: 'https://example.com',
    })) as { id: string }

    const fillRes = (await executeBrowserTool(manager, 'agent-1', 'openbot_browser.fill', {
      tabId: openRes.id,
      selector: '#search-box',
      value: 'Busca teste',
    })) as { success: boolean }

    expect(fillRes.success).toBe(true)

    const clickRes = (await executeBrowserTool(manager, 'agent-1', 'openbot_browser.click', {
      tabId: openRes.id,
      selector: '#submit-btn',
    })) as { success: boolean }

    expect(clickRes.success).toBe(true)
  })

  it('executa openbot_browser.screenshot e openbot_browser.close', async () => {
    const openRes = (await executeBrowserTool(manager, 'agent-1', 'openbot_browser.open', {
      url: 'https://example.com',
    })) as { id: string }

    const shotRes = (await executeBrowserTool(manager, 'agent-1', 'openbot_browser.screenshot', {
      tabId: openRes.id,
    })) as { screenshotAvailable: boolean }

    expect(shotRes.screenshotAvailable).toBe(true)

    const closeRes = (await executeBrowserTool(manager, 'agent-1', 'openbot_browser.close', {
      tabId: openRes.id,
    })) as { success: boolean }

    expect(closeRes.success).toBe(true)
    expect(manager.getTabs('agent-1')).toHaveLength(0)
  })
})
