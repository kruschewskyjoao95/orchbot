import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { AppSettings, AppUpdateStatus } from '../shared/types'

// electron-updater é CommonJS: o bundle ESM do main só aceita o import padrão.
const { autoUpdater } = electronUpdater

/** Só HTTPS (ou loopback HTTP para testar um feed local). */
export function validFeedUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return (
      u.protocol === 'https:' ||
      (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))
    )
  } catch {
    return false
  }
}

export function createAppUpdater(
  getSettings: () => AppSettings,
  notify: (s: AppUpdateStatus) => void,
) {
  let status: AppUpdateStatus = { state: 'disabled', message: 'Atualização automática desligada.' }
  let wired = false
  const set = (next: AppUpdateStatus) => {
    status = next
    notify(next)
    return next
  }

  /** Devolve um motivo quando a atualização não pode rodar. */
  function blocker(): string | null {
    if (!app.isPackaged) return 'Disponível apenas no app instalado (AppImage, exe ou dmg).'
    if (!validFeedUrl(getSettings().updateFeedUrl))
      return 'Informe o endereço HTTPS do feed de atualização nas configurações.'
    return null
  }

  function wire() {
    if (wired) return
    wired = true
    autoUpdater.on('checking-for-update', () =>
      set({ state: 'checking', message: 'Procurando atualização…' }),
    )
    autoUpdater.on('update-available', (i) =>
      set({
        state: getSettings().autoUpdate ? 'downloading' : 'available',
        version: i.version,
        message: `Versão ${i.version} disponível.`,
      }),
    )
    autoUpdater.on('update-not-available', () =>
      set({ state: 'idle', message: 'Você já está na versão mais recente.' }),
    )
    autoUpdater.on('download-progress', (p) =>
      set({
        state: 'downloading',
        version: status.version,
        message: `Baixando… ${Math.round(p.percent)}%`,
      }),
    )
    autoUpdater.on('update-downloaded', (i) =>
      set({
        state: 'ready',
        version: i.version,
        message: `Versão ${i.version} pronta. Reinicie para instalar.`,
      }),
    )
    autoUpdater.on('error', (e) => set({ state: 'error', message: e.message.slice(0, 200) }))
  }

  async function check(): Promise<AppUpdateStatus> {
    const reason = blocker()
    if (reason) return set({ state: 'disabled', message: reason })
    wire()
    autoUpdater.setFeedURL({ provider: 'generic', url: getSettings().updateFeedUrl })
    autoUpdater.autoDownload = getSettings().autoUpdate
    autoUpdater.autoInstallOnAppQuit = true
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      set({ state: 'error', message: e instanceof Error ? e.message.slice(0, 200) : String(e) })
    }
    return status
  }

  return {
    status: () => status,
    check,
    /** Baixa (se ainda não baixou) e instala reiniciando o app. */
    async install() {
      if (status.state === 'available') await autoUpdater.downloadUpdate()
      else if (status.state === 'ready') autoUpdater.quitAndInstall()
    },
    /** Checagem automática ao abrir, só quando o usuário ligou a opção. */
    startIfEnabled() {
      if (getSettings().autoUpdate) setTimeout(() => void check(), 10_000)
    },
  }
}
