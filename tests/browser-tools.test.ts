import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserManager } from '../src/backend/browser/browser-manager'
import { BROWSER_TOOLS, executeBrowserTool } from '../src/backend/browser/browser-tools'
import { MockBrowserDriver } from '../src/backend/browser/driver'

describe('Browser Tools (orchbot_browser.*)', () => {
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

  it('declara catálogo completo de ferramentas orchbot_browser.*', () => {
    const names = BROWSER_TOOLS.map((t) => t.name)
    expect(names).toContain('orchbot_browser.open')
    expect(names).toContain('orchbot_browser.inspect')
    expect(names).toContain('orchbot_browser.click')
    expect(names).toContain('orchbot_browser.fill')
    expect(names).toContain('orchbot_browser.screenshot')
    expect(names).toContain('orchbot_browser.close')
  })

  it('executa orchbot_browser.open e orchbot_browser.inspect', async () => {
    const openRes = (await executeBrowserTool(manager, 'agent-1', 'orchbot_browser.open', {
      url: 'https://example.com',
    })) as { id: string; url: string }

    expect(openRes.id).toBeDefined()
    expect(openRes.url).toBe('https://example.com/')

    const inspectRes = (await executeBrowserTool(manager, 'agent-1', 'orchbot_browser.inspect', {
      tabId: openRes.id,
    })) as { textSummary: string; links: unknown[] }

    expect(inspectRes.textSummary).toContain('Bem-vindo')
    expect(inspectRes.links.length).toBeGreaterThan(0)
  })

  it('executa orchbot_browser.fill e orchbot_browser.click', async () => {
    const openRes = (await executeBrowserTool(manager, 'agent-1', 'orchbot_browser.open', {
      url: 'https://example.com',
    })) as { id: string }

    const fillRes = (await executeBrowserTool(manager, 'agent-1', 'orchbot_browser.fill', {
      tabId: openRes.id,
      selector: '#search-box',
      value: 'Busca teste',
    })) as { success: boolean }

    expect(fillRes.success).toBe(true)

    const clickRes = (await executeBrowserTool(manager, 'agent-1', 'orchbot_browser.click', {
      tabId: openRes.id,
      selector: '#submit-btn',
    })) as { success: boolean }

    expect(clickRes.success).toBe(true)
  })

  it('executa orchbot_browser.screenshot e orchbot_browser.close', async () => {
    const openRes = (await executeBrowserTool(manager, 'agent-1', 'orchbot_browser.open', {
      url: 'https://example.com',
    })) as { id: string }

    const shotRes = (await executeBrowserTool(manager, 'agent-1', 'orchbot_browser.screenshot', {
      tabId: openRes.id,
    })) as { screenshotAvailable: boolean }

    expect(shotRes.screenshotAvailable).toBe(true)

    const closeRes = (await executeBrowserTool(manager, 'agent-1', 'orchbot_browser.close', {
      tabId: openRes.id,
    })) as { success: boolean }

    expect(closeRes.success).toBe(true)
    expect(manager.getTabs('agent-1')).toHaveLength(0)
  })
})
