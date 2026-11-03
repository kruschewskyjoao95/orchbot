import path from 'node:path'
import { type BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'
import type { DeepLink } from '../shared/types'
import { findDeepLinkArg, parseDeepLink } from './deep-link'

export function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'build', 'icon.png')
}

/** Bandeja do sistema + link orchbot:// + instância única. */
export function initShell(opts: {
  getWindow: () => BrowserWindow | null
  createWindow: () => void
  onDeepLink: (link: DeepLink) => void
  onCheckUpdate: () => void
}) {
  const show = () => {
    const w = opts.getWindow()
    if (!w) return opts.createWindow()
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }
  const handle = (raw: string | undefined) => {
    const link = raw ? parseDeepLink(raw) : null
    if (!link) return
    show()
    opts.onDeepLink(link)
  }

  // Em desenvolvimento o registro precisa apontar para o electron + script.
  if (process.defaultApp && process.argv[1])
    app.setAsDefaultProtocolClient('orchbot', process.execPath, [path.resolve(process.argv[1])])
  else app.setAsDefaultProtocolClient('orchbot')

  app.on('second-instance', (_e, argv) => {
    show()
    handle(findDeepLinkArg(argv))
  })
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handle(url)
  })

  let tray: Tray | null = null
  try {
    tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 22, height: 22 }))
    tray.setToolTip('Orchbot')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Orchbot', click: show },
        { label: 'Buscar atualização', click: opts.onCheckUpdate },
        { type: 'separator' },
        { label: 'Sair', click: () => app.quit() },
      ]),
    )
    tray.on('click', show)
  } catch {
    // ambiente sem bandeja (ex.: Linux sem StatusNotifier): o app segue sem ela
  }
  return {
    show,
    handleInitial: () => handle(findDeepLinkArg(process.argv)),
    destroy: () => tray?.destroy(),
  }
}
