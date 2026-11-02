import type {
  BrowserBounds,
  BrowserPageContent,
  BrowserPageInput,
  BrowserPageLink,
} from '../../shared/types'
import { parsePageDomSummary, sanitizeUrl } from './sanitizer'

export interface TabNavigationResult {
  title: string
  url: string
}

export interface BrowserDriver {
  openTab(agentId: string, tabId: string, url: string): Promise<TabNavigationResult>
  closeTab(tabId: string): Promise<void>
  navigate(tabId: string, action: 'back' | 'forward' | 'reload'): Promise<TabNavigationResult>
  inspect(tabId: string): Promise<BrowserPageContent>
  click(tabId: string, selector: string): Promise<{ clicked: boolean }>
  fill(tabId: string, selector: string, value: string): Promise<{ filled: boolean }>
  captureScreenshot(tabId: string): Promise<string>
  runScript(tabId: string, script: string): Promise<unknown>
  attachView?(tabId: string, bounds: BrowserBounds): void
  detachView?(tabId: string): void
}

interface MockTabState {
  agentId: string
  url: string
  title: string
  history: string[]
  historyIndex: number
  bodyText: string
  links: BrowserPageLink[]
  inputs: BrowserPageInput[]
  inputValues: Record<string, string>
}

export class MockBrowserDriver implements BrowserDriver {
  private tabs = new Map<string, MockTabState>()

  public async openTab(
    agentId: string,
    tabId: string,
    rawUrl: string,
  ): Promise<TabNavigationResult> {
    const url = sanitizeUrl(rawUrl)
    const title = `Página de ${new URL(url).hostname}`

    const state: MockTabState = {
      agentId,
      url,
      title,
      history: [url],
      historyIndex: 0,
      bodyText: `<h1>${title}</h1><p>Bem-vindo a ${url}</p><form><input id="search-box" name="q" placeholder="Buscar..." /><button id="submit-btn" type="submit">Enviar</button></form><a href="${url}/about">Sobre nós</a>`,
      links: [{ text: 'Sobre nós', href: `${url}/about` }],
      inputs: [
        {
          id: 'search-box',
          name: 'q',
          type: 'text',
          placeholder: 'Buscar...',
          selector: '#search-box',
        },
        { id: 'submit-btn', type: 'submit', selector: '#submit-btn' },
      ],
      inputValues: {},
    }

    this.tabs.set(tabId, state)
    return { title, url }
  }

  public async closeTab(tabId: string): Promise<void> {
    this.tabs.delete(tabId)
  }

  public async navigate(
    tabId: string,
    action: 'back' | 'forward' | 'reload',
  ): Promise<TabNavigationResult> {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`Aba ${tabId} não encontrada`)

    if (action === 'back' && tab.historyIndex > 0) {
      tab.historyIndex--
      tab.url = tab.history[tab.historyIndex]
    } else if (action === 'forward' && tab.historyIndex < tab.history.length - 1) {
      tab.historyIndex++
      tab.url = tab.history[tab.historyIndex]
    }

    return { title: tab.title, url: tab.url }
  }

  public async inspect(tabId: string): Promise<BrowserPageContent> {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`Aba ${tabId} não encontrada`)

    return parsePageDomSummary(tabId, tab.url, tab.title, tab.bodyText, tab.links, tab.inputs)
  }

  public async click(tabId: string, selector: string): Promise<{ clicked: boolean }> {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`Aba ${tabId} não encontrada`)

    const exists =
      tab.inputs.some((i) => i.selector === selector || i.id === selector) ||
      tab.links.some((l) => l.href === selector || selector === 'a') ||
      selector === '#submit-btn'

    if (!exists) {
      throw new Error(`Elemento não encontrado no DOM: ${selector}`)
    }

    return { clicked: true }
  }

  public async fill(tabId: string, selector: string, value: string): Promise<{ filled: boolean }> {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`Aba ${tabId} não encontrada`)

    const input = tab.inputs.find(
      (i) => i.selector === selector || i.id === selector || i.name === selector,
    )
    if (!input) {
      throw new Error(`Campo de formulário não encontrado: ${selector}`)
    }

    tab.inputValues[selector] = value
    return { filled: true }
  }

  public async captureScreenshot(_tabId: string): Promise<string> {
    // Retorna imagem PNG 1x1 mockada em base64
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  }

  public async runScript(tabId: string, script: string): Promise<unknown> {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`Aba ${tabId} não encontrada`)

    // Em ambiente mock, simula scripts comuns
    if (script.includes('document.title')) {
      return tab.title
    }
    if (script.includes('location.href')) {
      return tab.url
    }
    return { executed: true, tabId }
  }
}
