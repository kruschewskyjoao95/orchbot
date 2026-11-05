import { type BrowserWindow, WebContentsView, session } from 'electron'
import type { BrowserBounds, BrowserPageContent } from '../../shared/types'
import {
  type BrowserDriver,
  type NavigationSurface,
  type TabNavigationResult,
  afterBrowserNavigation,
} from './driver'
import { parsePageDomSummary, sanitizeUrl } from './sanitizer'

/** Setter do protótipo: o `el.value =` do React atualiza o rastreador e o estado da página não muda. */
export function fillFieldScript(selector: string, value: string): string {
  const sel = JSON.stringify(selector)
  const val = JSON.stringify(value)
  return `(() => {
    const el = document.querySelector(${sel});
    if (!el) throw new Error("Campo não encontrado no DOM: " + ${sel});
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    if (setter) setter.call(el, ${val});
    else el.value = ${val};
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`
}

interface ElectronTabHolder {
  agentId: string
  view: WebContentsView
  url: string
  title: string
}

export class ElectronBrowserDriver implements BrowserDriver {
  private tabs = new Map<string, ElectronTabHolder>()
  private getMainWindow: () => BrowserWindow | null
  private attachedTabId: string | null = null

  constructor(getMainWindow: () => BrowserWindow | null) {
    this.getMainWindow = getMainWindow
  }

  public async openTab(
    agentId: string,
    tabId: string,
    rawUrl: string,
  ): Promise<TabNavigationResult> {
    const url = sanitizeUrl(rawUrl)
    const partition = `persist:orchbot-agent-${agentId}`
    const sess = session.fromPartition(partition)

    // Desativa permissões arriscadas (câmera, microfone, geolocalização)
    sess.setPermissionRequestHandler((_wc, _perm, callback) => {
      callback(false)
    })

    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    // Bloqueia popups não gerenciados
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

    // Bloqueia protocolos não HTTP/HTTPS
    view.webContents.on('will-navigate', (event, targetUrl) => {
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        event.preventDefault()
      }
    })

    view.webContents.on('will-redirect', (event, targetUrl) => {
      if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        event.preventDefault()
      }
    })

    await view.webContents.loadURL(url)
    const title = view.webContents.getTitle() || url

    this.tabs.set(tabId, {
      agentId,
      view,
      url,
      title,
    })

    return { title, url }
  }

  public async closeTab(tabId: string): Promise<void> {
    const holder = this.tabs.get(tabId)
    if (!holder) return

    if (this.attachedTabId === tabId) {
      this.detachView(tabId)
    }

    try {
      holder.view.webContents.close()
    } catch {
      // Ignora erro se já fechado
    }

    this.tabs.delete(tabId)
  }

  public async navigate(
    tabId: string,
    action: 'back' | 'forward' | 'reload',
  ): Promise<TabNavigationResult> {
    const holder = this.tabs.get(tabId)
    if (!holder) throw new Error(`Aba ${tabId} não encontrada`)

    const settled = await afterBrowserNavigation(
      holder.view.webContents as unknown as NavigationSurface,
      action,
      holder.url,
    )
    holder.title = settled.title
    holder.url = settled.url
    return settled
  }

  public async inspect(tabId: string): Promise<BrowserPageContent> {
    const holder = this.tabs.get(tabId)
    if (!holder) throw new Error(`Aba ${tabId} não encontrada`)

    const domInfo = await holder.view.webContents.executeJavaScript(`(() => {
      const title = document.title || '';
      const text = document.body ? document.body.innerText : '';
      const links = Array.from(document.querySelectorAll('a')).map(a => ({ text: a.innerText || '', href: a.href || '' }));
      const inputs = Array.from(document.querySelectorAll('input, textarea, button, select')).map(el => ({
        id: el.id || undefined,
        name: el.name || undefined,
        type: el.type || el.tagName.toLowerCase(),
        placeholder: el.placeholder || undefined,
        selector: el.id ? '#' + el.id : (el.name ? '[name="' + el.name + '"]' : el.tagName.toLowerCase())
      }));
      return { title, text, links, inputs };
    })()`)

    return parsePageDomSummary(
      tabId,
      holder.view.webContents.getURL() || holder.url,
      domInfo.title || holder.title,
      domInfo.text || '',
      domInfo.links || [],
      domInfo.inputs || [],
    )
  }

  public async click(tabId: string, selector: string): Promise<{ clicked: boolean }> {
    const holder = this.tabs.get(tabId)
    if (!holder) throw new Error(`Aba ${tabId} não encontrada`)

    await holder.view.webContents.executeJavaScript(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Elemento não encontrado no DOM: " + ${JSON.stringify(selector)});
      el.click();
      return true;
    })()`)

    return { clicked: true }
  }

  public async fill(tabId: string, selector: string, value: string): Promise<{ filled: boolean }> {
    const holder = this.tabs.get(tabId)
    if (!holder) throw new Error(`Aba ${tabId} não encontrada`)

    await holder.view.webContents.executeJavaScript(fillFieldScript(selector, value))

    return { filled: true }
  }

  public async captureScreenshot(tabId: string): Promise<string> {
    const holder = this.tabs.get(tabId)
    if (!holder) throw new Error(`Aba ${tabId} não encontrada`)

    const img = await holder.view.webContents.capturePage()
    return img.toDataURL()
  }

  public async runScript(tabId: string, script: string): Promise<unknown> {
    const holder = this.tabs.get(tabId)
    if (!holder) throw new Error(`Aba ${tabId} não encontrada`)

    return await holder.view.webContents.executeJavaScript(script)
  }

  public attachView(tabId: string, bounds: BrowserBounds): void {
    const main = this.getMainWindow()
    if (!main) return

    const holder = this.tabs.get(tabId)
    if (!holder) return

    if (this.attachedTabId && this.attachedTabId !== tabId) {
      this.detachView(this.attachedTabId)
    }

    if (this.attachedTabId !== tabId) {
      main.contentView.addChildView(holder.view)
      this.attachedTabId = tabId
    }
    holder.view.setBounds(bounds)
  }

  public detachView(tabId: string): void {
    const main = this.getMainWindow()
    if (!main) return

    const holder = this.tabs.get(tabId)
    if (!holder) return

    try {
      main.contentView.removeChildView(holder.view)
    } catch {
      // Ignora se não estava anexado
    }

    if (this.attachedTabId === tabId) {
      this.attachedTabId = null
    }
  }
}
