import { BrowserWindow, WebContentsView, app, session } from 'electron'
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
  private pageWindows = new Map<string, BrowserWindow>()
  private hostedOnWindow = new Set<string>()
  private getMainWindow: () => BrowserWindow | null
  private attachedTabId: string | null = null
  private onPageWindowState?: (tabId: string, state: 'visible' | 'hidden' | 'docked') => void

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

    view.webContents.on('page-title-updated', (_event, nextTitle) => {
      const current = this.tabs.get(tabId)
      if (!current) return
      current.title = nextTitle
      const win = this.pageWindows.get(tabId)
      if (win && !win.isDestroyed()) win.setTitle(nextTitle || current.url)
    })

    return { title, url }
  }

  public async closeTab(tabId: string): Promise<void> {
    const holder = this.tabs.get(tabId)
    if (!holder) return

    this.destroyPageWindow(tabId)
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
    if (this.hostedOnWindow.has(tabId)) return

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
    if (this.hostedOnWindow.has(tabId)) {
      if (this.attachedTabId === tabId) this.attachedTabId = null
      return
    }

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

  public setPageWindowListener(
    listener: (tabId: string, state: 'visible' | 'hidden' | 'docked') => void,
  ): void {
    this.onPageWindowState = listener
  }

  public pageWindowState(tabId: string): 'visible' | 'hidden' | 'none' {
    if (!this.hostedOnWindow.has(tabId)) return 'none'
    const win = this.pageWindows.get(tabId)
    if (!win || win.isDestroyed()) return 'none'
    return win.isVisible() ? 'visible' : 'hidden'
  }

  public openPageWindow(tabId: string): void {
    const holder = this.tabs.get(tabId)
    if (!holder) throw new Error('Aba não encontrada')
    this.detachView(tabId)
    const win = this.ensurePageWindow(tabId, holder.title || holder.url)
    win.contentView.addChildView(holder.view)
    this.hostedOnWindow.add(tabId)
    this.fitPageWindow(win, holder.view)
    win.show()
    win.focus()
    this.onPageWindowState?.(tabId, 'visible')
  }

  public showPageWindow(tabId: string): void {
    if (!this.hostedOnWindow.has(tabId)) {
      this.openPageWindow(tabId)
      return
    }
    const win = this.pageWindows.get(tabId)
    if (!win || win.isDestroyed()) {
      this.hostedOnWindow.delete(tabId)
      this.openPageWindow(tabId)
      return
    }
    win.show()
    win.focus()
    this.onPageWindowState?.(tabId, 'visible')
  }

  public dockPageWindow(tabId: string): void {
    const holder = this.tabs.get(tabId)
    const win = this.pageWindows.get(tabId)
    this.hostedOnWindow.delete(tabId)
    if (holder && win && !win.isDestroyed()) {
      try {
        win.contentView.removeChildView(holder.view)
      } catch {
        // A view já não estava nessa janela.
      }
      win.hide()
    }
    this.onPageWindowState?.(tabId, 'docked')
  }

  private ensurePageWindow(tabId: string, title: string): BrowserWindow {
    const existing = this.pageWindows.get(tabId)
    if (existing && !existing.isDestroyed()) {
      existing.setTitle(title)
      return existing
    }
    const win = new BrowserWindow({
      width: 960,
      height: 700,
      minWidth: 320,
      minHeight: 240,
      title,
      autoHideMenuBar: true,
      backgroundColor: '#111111',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    win.on('resize', () => {
      const holder = this.tabs.get(tabId)
      if (holder) this.fitPageWindow(win, holder.view)
    })
    win.on('close', (event) => {
      const main = this.getMainWindow()
      const quitting = (app as unknown as { isQuitting?: boolean }).isQuitting
      if (quitting || !main || main.isDestroyed()) return
      // O X esconde a janela. A aba continua no mesmo perfil do agente.
      event.preventDefault()
      win.hide()
      this.onPageWindowState?.(tabId, 'hidden')
    })
    this.pageWindows.set(tabId, win)
    return win
  }

  private fitPageWindow(win: BrowserWindow, view: WebContentsView): void {
    if (win.isDestroyed()) return
    const [width, height] = win.getContentSize()
    view.setBounds({ x: 0, y: 0, width, height })
  }

  public closePageWindows(): void {
    for (const tabId of [...this.pageWindows.keys()]) this.destroyPageWindow(tabId)
  }

  private destroyPageWindow(tabId: string): void {
    this.hostedOnWindow.delete(tabId)
    const win = this.pageWindows.get(tabId)
    this.pageWindows.delete(tabId)
    if (!win || win.isDestroyed()) return
    const holder = this.tabs.get(tabId)
    if (holder) {
      try {
        win.contentView.removeChildView(holder.view)
      } catch {
        // A view já não estava nessa janela.
      }
    }
    win.removeAllListeners('close')
    win.destroy()
  }
}
