import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { BrowserWindow, app, dialog, ipcMain, safeStorage, shell } from 'electron'
import { Notification } from 'electron'
import { BrowserManager } from '../backend/browser/browser-manager'
import { executeBrowserTool } from '../backend/browser/browser-tools'
import { ElectronBrowserDriver } from '../backend/browser/electron-driver'
import { draftAgent, draftTeam } from '../backend/collaboration/agent-drafter'
import { checkComputerUse, executeComputerAction } from '../backend/computer/computer-tools'
import { CronScheduler } from '../backend/cron/scheduler'
import { DelegationService } from '../backend/delegation/delegation-service'
import { buildDiagnostics } from '../backend/diagnostics/diagnostics'
import { MCP_PRESETS } from '../backend/mcp/presets'
import { ensureForeman } from '../backend/orchestration/foreman'
import {
  accountStatus,
  profileLoginHint,
  resolveAccountRuntime,
} from '../backend/providers/account-config'
import { getCatalogEntry, listCatalog } from '../backend/providers/catalog'
import {
  getManagedInfo,
  installManagedCli,
  isPinned,
  listManagedClis,
  managedBinPath,
  removeManagedCli,
  setManagedCliRoot,
  setManagedPin,
} from '../backend/providers/managed-cli'
import { OpenAiCompatibleAdapter } from '../backend/providers/openai-compatible-adapter'
import { ProviderRegistry } from '../backend/providers/registry'
import { QueueManager } from '../backend/queue/queue-manager'
import { loadWorkspaceRules } from '../backend/rag/workspace-rules'
import { detectLocalRuntimes } from '../backend/runtimes/local-runtimes'
import { SkillService, slugify } from '../backend/skills/skill-service'
import { AttachmentManager } from '../backend/storage/attachment-manager'
import { OrchbotDatabase } from '../backend/storage/db'
import {
  EXAMPLE_THEME,
  loadThemes,
  omarchyThemesDir,
  watchThemes,
} from '../backend/themes/theme-service'
import { startWebhookServer, webhookBaseUrl } from '../backend/triggers/webhook-server'
import { NO_UPDATE_CHANNEL, SELF_UPDATE } from '../backend/updates/self-update'
import {
  NPM_PACKAGES,
  type ProviderUpdateInfo,
  checkProviderUpdate,
  compareSemver,
  parseSemver,
} from '../backend/updates/update-checker'
import { isCustomProvider } from '../shared/custom-providers'
import { providerStatusLabel } from '../shared/provider-status'
import { CONSENT_VERSION, type DeepLink, effectiveCapabilities } from '../shared/types'
import type {
  AppSettings,
  BrowserBounds,
  CreateChannelInput,
  CreateCustomProviderInput,
  CreateProjectInput,
  CreateProviderAccountInput,
  CreateScheduledTaskInput,
  CustomProviderId,
  DelegationInput,
  ProviderConnection,
  ProviderInfo,
  SaveBrainPageInput,
  SaveMcpServerInput,
  SupportedProvider,
  UpdateAgentInput,
  UpdateConnectionInput,
  UpdateProjectInput,
  UpdateProviderAccountInput,
  UpdateScheduledTaskInput,
} from '../shared/types'
import { validateCreateAgentInput, validateCreateScheduledTaskInput } from '../shared/types'
import { createDefaultAgentWorkspace } from './agent-workspace'
import { createAppUpdater } from './app-updater'
import { registerAppImageDesktop, setLinuxAutostart } from './linux-desktop'
import { iconPath, initShell } from './shell'

let mainWindow: BrowserWindow | null = null
let foremanReady = false
let db: OrchbotDatabase | null = null
let registry: ProviderRegistry | null = null
let queueManager: QueueManager | null = null
let attachmentManager: AttachmentManager | null = null
let delegationService: DelegationService | null = null
let browserManager: BrowserManager | null = null
let cronScheduler: CronScheduler | null = null
let webhookServer: import('node:http').Server | null = null

function getDatabase(): OrchbotDatabase {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'orchbot.db')
    db = new OrchbotDatabase(dbPath, safeStorage)
  }
  return db
}

function getProviderRegistry(): ProviderRegistry {
  if (!registry) {
    registry = new ProviderRegistry()
    for (const connection of getDatabase().listConnections()) {
      if (isCustomProvider(connection.providerId))
        registry.registerAdapter(
          new OpenAiCompatibleAdapter(connection.providerId, connection.name),
        )
    }
  }
  return registry
}

let stopThemeWatch: (() => void) | null = null
let appUpdater: ReturnType<typeof createAppUpdater> | null = null
let pendingLink: DeepLink | null = null

let skillService: SkillService | null = null
function getSkillService(): SkillService {
  if (!skillService) {
    // Skills do catálogo vão junto do app (extraResources); tudo roda e fica no computador do usuário.
    const bundled = app.isPackaged
      ? path.join(process.resourcesPath, 'skills')
      : path.join(app.getAppPath(), 'resources', 'skills')
    skillService = new SkillService(
      getDatabase(),
      path.join(app.getPath('userData'), 'skills'),
      bundled,
    )
  }
  return skillService
}

/** Comando do CLI do provedor: instalado pelo app > caminho do usuário > nome no PATH. */
function getConnectionCli(providerId: SupportedProvider): string {
  return (
    (managedBinPath(providerId) ||
      getDatabase().getConnection(providerId)?.cliPath ||
      getCatalogEntry(providerId)?.cliCommand) ??
    providerId
  )
}

function getQueueManager(): QueueManager {
  if (!queueManager) {
    queueManager = new QueueManager(getDatabase(), getProviderRegistry())
    queueManager.setSkills(getSkillService())

    // Robôs controlam o navegador embutido via comandos [[BROWSER:...]]
    queueManager.setBrowserExecutor((agentId, toolName, args) =>
      executeBrowserTool(getBrowserManager(), agentId, toolName, args),
    )

    // Uso do computador: [[COMPUTER:...]] (respeita Configurações + override do robô)
    queueManager.setComputerExecutor(async (agentId, action, args) => {
      const database = getDatabase()
      const agent = database.getAgent(agentId)
      const caps = agent ? effectiveCapabilities(agent, database.getSettings()) : null
      if (!caps?.computerUse) {
        throw new Error(
          'Uso do computador desligado para este robô (Configurações → Uso do computador).',
        )
      }
      const outDir = path.join(app.getPath('userData'), 'computer-screenshots')
      const result = await executeComputerAction(action, args, outDir)
      return result.summary
    })

    // Configura os eventos de streaming e ciclo de vida para repassar à janela
    queueManager.setEvents({
      onPermissionRequest: async (request, signal, agentName) => {
        if (!mainWindow || mainWindow.isDestroyed() || signal.aborted) return undefined
        const result = await dialog.showMessageBox(mainWindow, {
          type: 'question',
          title: `Permissão — ${agentName}`,
          message:
            request.toolCall.title || 'O agente solicita permissão para executar uma ferramenta.',
          detail: JSON.stringify(request.toolCall.rawInput ?? {}, null, 2),
          buttons: ['Cancelar', ...request.options.map((option) => option.name)],
          defaultId: 0,
          cancelId: 0,
          signal,
          noLink: true,
        })
        return signal.aborted ? undefined : request.options[result.response - 1]?.optionId
      },
      onStreamChunk: (event) => {
        mainWindow?.webContents.send('orchbot:stream-chunk', event)
      },
      onTurnFinished: (event) => {
        mainWindow?.webContents.send('orchbot:turn-finished', event)
      },
      onTurnError: (event) => {
        mainWindow?.webContents.send('orchbot:turn-error', event)
      },
      onTaskStatusChanged: (event) => {
        mainWindow?.webContents.send('orchbot:task-status-changed', event)
      },
    })
  }
  return queueManager
}

function getAttachmentManager(): AttachmentManager {
  if (!attachmentManager) {
    attachmentManager = new AttachmentManager(app.getPath('userData'), getDatabase())
  }
  return attachmentManager
}

function getDelegationService(): DelegationService {
  if (!delegationService) {
    delegationService = new DelegationService(getDatabase(), getQueueManager())
  }
  return delegationService
}

function getBrowserManager(): BrowserManager {
  if (!browserManager) {
    const driver = new ElectronBrowserDriver(() => mainWindow)
    browserManager = new BrowserManager(app.getPath('userData'), driver)
    browserManager.setOnTabUpdated((tab) => {
      mainWindow?.webContents.send('orchbot:browser-tab-updated', tab)
    })
  }
  return browserManager
}

function getCronScheduler(): CronScheduler {
  if (!cronScheduler) {
    cronScheduler = new CronScheduler(getDatabase(), getQueueManager(), getBrowserManager(), {
      tickIntervalMs: 10000,
      onTaskTriggered: (task) => {
        mainWindow?.webContents.send('orchbot:scheduled-task-triggered', task)
      },
    })
    cronScheduler.start()
  }
  return cronScheduler
}

let externalLinksMode: AppSettings['externalLinks'] = 'default-browser'
let keepRunningInBackground = false
let providerStatusCache: { at: number; value: unknown } | null = null
let updatesCache: { at: number; value: unknown } | null = null

function applySettings(settings: AppSettings): void {
  externalLinksMode = settings.externalLinks
  keepRunningInBackground = settings.keepRunningInBackground
  try {
    // Electron ignora openAtLogin no Linux; em dev o executável é o electron, então não registra.
    if (process.platform !== 'linux')
      app.setLoginItemSettings({ openAtLogin: settings.startAtLogin })
    else if (app.isPackaged)
      setLinuxAutostart(settings.startAtLogin, process.env.APPIMAGE || process.execPath, 'orchbot')
  } catch {
    // Sem permissão para gravar o autostart: a preferência fica salva
  }
  if (!settings.quickConnection) providerStatusCache = null
}

function createWindow(): void {
  const mjsPreload = path.join(__dirname, '../preload/index.mjs')
  const preloadPath = fs.existsSync(mjsPreload)
    ? mjsPreload
    : path.join(__dirname, '../preload/index.js')

  mainWindow = new BrowserWindow({
    width: 1240,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    title: 'Orchbot',
    backgroundColor: '#090d16',
    icon: iconPath(),
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (keepRunningInBackground && !(app as unknown as { isQuitting?: boolean }).isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  app.on('activate', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (!/^https?:\/\//i.test(details.url)) return { action: 'deny' }
    if (externalLinksMode === 'embedded') {
      const popup = new BrowserWindow({ width: 1000, height: 720, title: details.url })
      popup.loadURL(details.url)
    } else {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  // Carrega renderer local ou dev server
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  const database = getDatabase()
  const providerRegistry = getProviderRegistry()
  const queue = getQueueManager()
  const attachments = getAttachmentManager()
  const delegation = getDelegationService()
  const browser = getBrowserManager()

  applySettings(database.getSettings())

  const checkAccount = async (
    providerId: SupportedProvider,
    id?: string,
  ): Promise<ProviderInfo> => {
    try {
      const { config } = resolveAccountRuntime(database, providerId, id)
      return accountStatus(
        await providerRegistry.getAdapter(providerId).checkAvailability(config),
        providerId,
        config,
      )
    } catch (error) {
      return {
        available: false,
        readiness: 'error',
        authStatus: 'unknown',
        error: error instanceof Error ? error.message : 'Não foi possível verificar a conta.',
      }
    }
  }
  const checkConnections = async (connections: ProviderConnection[]) =>
    Object.fromEntries(
      await Promise.all(
        connections.map(async (connection) => [
          connection.providerId,
          await checkAccount(connection.providerId),
        ]),
      ),
    ) as Record<SupportedProvider, ProviderInfo>
  const accountMetadata = (providerId: SupportedProvider) => {
    const connection = database.getConnection(providerId)
    return database.listProviderAccounts(providerId).map((account) => ({
      ...account,
      loginHint:
        account.authMode === 'cli_profile' && account.profilePath
          ? profileLoginHint(providerId, connection?.cliPath, account.profilePath)
          : undefined,
    }))
  }
  const testAccount = async (providerId: SupportedProvider, id?: string) => {
    const status = await checkAccount(providerId, id)
    providerStatusCache = null
    return {
      success: status.readiness === 'ready',
      status,
      message: `${providerStatusLabel(status)}${status.error ? `: ${status.error}` : ''}${status.loginHint && status.readiness !== 'ready' ? ` • ${status.loginHint}` : ''}`,
    }
  }
  ipcMain.handle('orchbot:get-provider-accounts', (_event, providerId: SupportedProvider) =>
    accountMetadata(providerId),
  )
  ipcMain.handle('orchbot:create-provider-account', (_event, input: CreateProviderAccountInput) => {
    const account = database.createProviderAccount(input)
    providerStatusCache = null
    return accountMetadata(account.providerId).find((item) => item.id === account.id)
  })
  ipcMain.handle('orchbot:update-provider-account', (_event, input: UpdateProviderAccountInput) => {
    const account = database.updateProviderAccount(input)
    providerStatusCache = null
    return accountMetadata(account.providerId).find((item) => item.id === account.id)
  })
  ipcMain.handle(
    'orchbot:delete-provider-account',
    (_event, providerId: SupportedProvider, id: string) => {
      const deleted = database.deleteProviderAccount(providerId, id)
      providerStatusCache = null
      return deleted
    },
  )
  ipcMain.handle(
    'orchbot:test-provider-account',
    (_event, providerId: SupportedProvider, id: string) => testAccount(providerId, id),
  )

  ipcMain.handle('orchbot:get-provider-updates', async () => {
    if (updatesCache && Date.now() - updatesCache.at < 30 * 60_000) {
      return updatesCache.value
    }
    const list = database.listConnections()
    const statuses = await checkConnections(list)
    const updates = await Promise.all(
      list
        .filter((c) => !isCustomProvider(c.providerId))
        .map(async (c) => {
          const installed = statuses[c.providerId]?.version
          const self = SELF_UPDATE[c.providerId]
          let info: ProviderUpdateInfo
          if (self?.check) {
            // CLI que sabe consultar a própria versão (ex.: grok update --check --json)
            const bin =
              (managedBinPath(c.providerId) ||
                c.cliPath ||
                getCatalogEntry(c.providerId)?.cliCommand) ??
              c.providerId
            try {
              const { stdout } = await promisify(execFile)(bin, self.check.args, { timeout: 20000 })
              const { installed: cur, latest } = self.check.parse(stdout)
              info = {
                providerId: c.providerId,
                installedVersion: parseSemver(cur ?? installed),
                latestVersion: parseSemver(latest),
                updateAvailable: Boolean(
                  cur &&
                    latest &&
                    compareSemver(parseSemver(latest) ?? '0.0.0', parseSemver(cur) ?? '0.0.0') > 0,
                ),
                updateCommand: `${getCatalogEntry(c.providerId)?.cliCommand ?? c.providerId} ${self.update.join(' ')}`,
                checkedAt: new Date().toISOString(),
              }
            } catch (err) {
              info = {
                providerId: c.providerId,
                installedVersion: parseSemver(installed),
                latestVersion: null,
                updateAvailable: false,
                updateCommand: null,
                checkedAt: new Date().toISOString(),
                error: err instanceof Error ? err.message : String(err),
              }
            }
          } else {
            info = await checkProviderUpdate(c.providerId, installed)
            if (info.error && NO_UPDATE_CHANNEL[c.providerId])
              info.error = NO_UPDATE_CHANNEL[c.providerId]
          }
          // Versão fixada pelo usuário: nunca sugere nem aplica atualização.
          if (isPinned(c.providerId)) info.updateAvailable = false
          return info
        }),
    )
    updatesCache = { at: Date.now(), value: updates }

    // Notificação nativa uma vez por versão (respeita dispensados)
    try {
      const settings = database.getSettings()
      for (const u of updates) {
        if (
          u.updateAvailable &&
          u.latestVersion &&
          settings.dismissedProviderUpdates[u.providerId] !== u.latestVersion
        ) {
          if (Notification.isSupported()) {
            new Notification({
              title: `Atualização: ${getCatalogEntry(u.providerId)?.name ?? u.providerId}`,
              body: `v${u.installedVersion} → v${u.latestVersion}. Abra Conexões para atualizar.`,
            }).show()
            database.updateSettings({
              dismissedProviderUpdates: {
                ...settings.dismissedProviderUpdates,
                [u.providerId]: u.latestVersion,
              },
            })
          }
          break
        }
      }
    } catch {
      // Notificação é best-effort
    }
    return updates
  })

  ipcMain.handle('orchbot:run-provider-update', async (_event, providerId: SupportedProvider) => {
    const pkg = NPM_PACKAGES[providerId]
    const managed = getManagedInfo(providerId)
    if (managed.installed) {
      if (managed.pinned)
        return {
          success: false,
          message: `A versão ${managed.version} está fixada. Solte a versão em Conexões para atualizar.`,
        }
      try {
        updatesCache = null
        providerStatusCache = null
        const next = await installManagedCli(providerId, 'latest', false)
        return { success: true, message: `${pkg} atualizado para ${next.version}.` }
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : String(err) }
      }
    }
    const self = SELF_UPDATE[providerId]
    if (self) {
      updatesCache = null
      const bin = getConnectionCli(providerId)
      return await new Promise<{ success: boolean; message: string }>((resolve) => {
        execFile(bin, self.update, { timeout: 5 * 60_000 }, (err, stdout, stderr) => {
          providerStatusCache = null
          resolve(
            err
              ? {
                  success: false,
                  message: `Falha ao atualizar: ${(stderr || err.message).slice(-600)}`,
                }
              : {
                  success: true,
                  message: `${stdout.trim().slice(-300) || 'Atualizado.'} Recarregando status…`,
                },
          )
        })
      })
    }
    if (!pkg) {
      return {
        success: false,
        message:
          NO_UPDATE_CHANNEL[providerId] ??
          'Este provedor não é atualizado via npm. Atualize pela ferramenta dele.',
      }
    }
    updatesCache = null
    return await new Promise<{ success: boolean; message: string }>((resolve) => {
      const child = spawn('npm', ['install', '-g', `${pkg}@latest`], { shell: false })
      let out = ''
      child.stdout?.on('data', (d: Buffer) => {
        out += d.toString()
      })
      child.stderr?.on('data', (d: Buffer) => {
        out += d.toString()
      })
      child.on('error', (err) => resolve({ success: false, message: err.message }))
      child.on('close', (code) => {
        if (code === 0) {
          providerStatusCache = null
          resolve({ success: true, message: `${pkg} atualizado. Recarregando status…` })
        } else {
          resolve({
            success: false,
            message: `Falha ao atualizar (código ${code}). Tente manualmente: npm install -g ${pkg}@latest
${out.slice(-800)}`,
          })
        }
      })
    })
  })

  ipcMain.handle('orchbot:get-profile-stats', () => {
    return database.getProfileStats()
  })

  ipcMain.handle('orchbot:get-computer-use-status', async () => {
    return checkComputerUse()
  })

  ipcMain.handle('orchbot:get-settings', () => {
    return database.getSettings()
  })

  ipcMain.handle('orchbot:update-settings', (_event, patch: Partial<AppSettings>) => {
    const next = database.updateSettings(patch ?? {})
    applySettings(next)
    return next
  })

  ipcMain.handle('orchbot:get-projects', () => {
    return database.listProjects()
  })

  ipcMain.handle('orchbot:create-project', (_event, input: CreateProjectInput) => {
    if (!input || typeof input.name !== 'string' || !input.name.trim()) {
      throw new Error('Nome do projeto obrigatório')
    }
    return database.createProject(input)
  })

  ipcMain.handle('orchbot:update-project', (_event, input: UpdateProjectInput) => {
    if (!input || typeof input.id !== 'string') throw new Error('ID do projeto obrigatório')
    return database.updateProject(input)
  })

  ipcMain.handle('orchbot:delete-project', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('ID inválido')
    return database.deleteProject(id)
  })

  ipcMain.handle('orchbot:get-agents', () => {
    // shortcut: se no boot não havia IA ligada, o coordenador nasce na primeira lista.
    if (!foremanReady && ensureForeman(database)) foremanReady = true
    return database.listAgents()
  })

  ipcMain.handle('orchbot:get-agent', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('ID inválido')
    return database.getAgent(id)
  })

  ipcMain.handle('orchbot:create-agent', (_event, rawInput: unknown) => {
    const input = rawInput as { workspacePath?: unknown; name?: unknown } | null
    // Sem pasta escolhida: cada agente ganha a sua em ~/Orchbot (o campo fica em "Avançado").
    if (input && typeof input === 'object' && !String(input.workspacePath ?? '').trim())
      input.workspacePath = createDefaultAgentWorkspace(
        path.join(app.getPath('home'), 'Orchbot'),
        String(input.name ?? ''),
      )
    const validated = validateCreateAgentInput(
      input,
      database.listConnections().map((c) => c.providerId),
    )
    return database.createAgent(validated)
  })

  ipcMain.handle('orchbot:update-agent', (_event, input: UpdateAgentInput) => {
    if (!input || typeof input.id !== 'string') {
      throw new Error('ID do agente obrigatório para atualização')
    }
    return database.updateAgent(input)
  })

  ipcMain.handle('orchbot:delete-agent', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('ID inválido')
    await attachments.removeAgentAttachments(id)
    await browser.removeAgent(id)
    return database.deleteAgent(id)
  })

  ipcMain.handle('orchbot:get-threads', (_event, agentId: string) => {
    if (typeof agentId !== 'string') throw new Error('ID do agente inválido')
    return database.listThreads(agentId)
  })

  ipcMain.handle(
    'orchbot:create-thread',
    (_event, payload: { agentId: string; title?: string; projectId?: string }) => {
      const { agentId, title } = payload
      if (!agentId || typeof agentId !== 'string') {
        throw new Error('ID do agente obrigatório')
      }
      const projectId = typeof payload.projectId === 'string' ? payload.projectId.trim() : ''
      return database.createThread(agentId, title, projectId || undefined)
    },
  )

  ipcMain.handle('orchbot:delete-thread', (_event, threadId: string) => {
    if (typeof threadId !== 'string') throw new Error('ID da thread inválido')
    return database.deleteThread(threadId)
  })

  ipcMain.handle(
    'orchbot:update-thread-title',
    (_event, payload: { threadId: string; title: string }) => {
      const { threadId, title } = payload
      if (!threadId || !title) throw new Error('Parâmetros inválidos')
      return database.updateThreadTitle(threadId, title)
    },
  )

  ipcMain.handle('orchbot:get-messages', (_event, threadId: string) => {
    if (typeof threadId !== 'string') throw new Error('ID da thread inválido')
    return database.listMessages(threadId)
  })

  ipcMain.handle('orchbot:get-system-status', () => {
    return {
      appVersion: app.getVersion(),
      platform: process.platform,
      dbPath: path.join(app.getPath('userData'), 'orchbot.db'),
    }
  })

  ipcMain.handle('orchbot:get-provider-status', async () => {
    const settings = database.getSettings()
    if (
      settings.quickConnection &&
      providerStatusCache &&
      Date.now() - providerStatusCache.at < 60_000
    ) {
      return providerStatusCache.value
    }
    const value = await checkConnections(database.listConnections())
    if (settings.quickConnection) providerStatusCache = { at: Date.now(), value }
    return value
  })

  ipcMain.handle('orchbot:get-provider-catalog', () => {
    return listCatalog()
  })

  const modelCache = new Map<string, { at: number; models: string[] }>()
  // Lista imediata (sem sondar CLIs) para a tela de provedores não ficar vazia.
  ipcMain.handle('orchbot:list-connections', () => database.listConnections())

  ipcMain.handle('orchbot:get-connections', async () => {
    const list = database.listConnections()
    const statuses = await checkConnections(list)
    if (database.getSettings().quickConnection)
      providerStatusCache = { at: Date.now(), value: statuses }
    // Modelos reais: só consulta CLIs/APIs instaladas; resultado em cache por 10 min.
    const live = await Promise.all(
      list.map(async (conn) => {
        const adapter = providerRegistry.getAdapter(conn.providerId)
        if (!statuses[conn.providerId]?.available || !adapter.discoverModels) return undefined
        const hit = modelCache.get(conn.providerId)
        if (hit && Date.now() - hit.at < 600_000) return hit.models
        try {
          const models = await adapter.discoverModels(
            resolveAccountRuntime(database, conn.providerId).config,
          )
          if (models.length > 0) modelCache.set(conn.providerId, { at: Date.now(), models })
          return models.length > 0 ? models : undefined
        } catch {
          return undefined
        }
      }),
    )
    return list.map((conn, i) => {
      const status = statuses[conn.providerId]
      return {
        ...conn,
        models: live[i] ?? conn.models,
        defaultModel:
          live[i] && !live[i].includes(conn.defaultModel) ? live[i][0] : conn.defaultModel,
        available: status?.available ?? false,
        version: status?.version,
        path: status?.path,
        authStatus: status?.authStatus,
        readiness: status?.readiness,
        loginHint: status?.loginHint,
        installHint: status?.installHint ?? conn.installHint,
        error: status?.error,
      }
    })
  })

  ipcMain.handle('orchbot:create-custom-provider', (_event, input: CreateCustomProviderInput) => {
    const connection = database.createCustomProvider(input)
    if (isCustomProvider(connection.providerId))
      providerRegistry.registerAdapter(
        new OpenAiCompatibleAdapter(connection.providerId, connection.name),
      )
    providerStatusCache = null
    return connection
  })

  ipcMain.handle('orchbot:delete-custom-provider', (_event, providerId: CustomProviderId) => {
    if (typeof providerId !== 'string') throw new Error('ID do provedor inválido.')
    const deleted = database.deleteCustomProvider(providerId)
    if (deleted) providerRegistry.unregisterAdapter(providerId)
    providerStatusCache = null
    return deleted
  })

  ipcMain.handle('orchbot:update-connection', (_event, input: UpdateConnectionInput) => {
    const updated = database.updateConnection(input)
    if (isCustomProvider(updated.providerId))
      providerRegistry.registerAdapter(
        new OpenAiCompatibleAdapter(updated.providerId, updated.name),
      )
    providerStatusCache = null
    return updated
  })

  ipcMain.handle('orchbot:test-connection', (_event, providerId: SupportedProvider) =>
    testAccount(providerId),
  )

  ipcMain.handle('orchbot:discover-models', async (_event, providerId: SupportedProvider) => {
    const conn = database.getConnection(providerId)
    const entry = getCatalogEntry(providerId)
    if (!conn) {
      return { models: [], source: 'catalog' as const, message: 'Provedor não encontrado.' }
    }
    const adapter = providerRegistry.getAdapter(providerId)
    if (adapter.discoverModels) {
      const { config } = resolveAccountRuntime(database, providerId)
      const models = await adapter.discoverModels(config)

      const fromCli =
        models.length > 0 && JSON.stringify(models) !== JSON.stringify(entry?.models ?? conn.models)
      return {
        models,
        source: isCustomProvider(providerId)
          ? ('api' as const)
          : fromCli
            ? ('cli' as const)
            : ('catalog' as const),
        message: isCustomProvider(providerId)
          ? `${models.length} modelos retornados pela API.`
          : fromCli
            ? `${models.length} modelos descobertos via CLI "${conn.cliPath || entry?.cliCommand || conn.name}".`
            : 'CLI indisponível para descoberta; usando catálogo local.',
      }
    }
    return {
      models: [...(entry?.models ?? conn.models)],
      source: 'catalog' as const,
      message: 'Este provedor não suporta descoberta via CLI; usando catálogo local.',
    }
  })

  // --- Primeiro uso, diagnósticos, runtimes locais, temas, CLIs gerenciados e atualização do app ---
  const consented = () => {
    const s = database.getSettings()
    return Boolean(s.consentAcceptedAt) && (s.consentVersion ?? 0) >= CONSENT_VERSION
  }
  queue.setConsentCheck(consented)
  ipcMain.handle('orchbot:get-consent', () => ({ accepted: consented(), version: CONSENT_VERSION }))
  ipcMain.handle('orchbot:accept-consent', () => {
    database.updateSettings({
      consentAcceptedAt: new Date().toISOString(),
      consentVersion: CONSENT_VERSION,
    })
    queue.kick()
    return true
  })
  ipcMain.handle('orchbot:decline-consent', () => app.quit())

  ipcMain.handle('orchbot:export-diagnostics', async () => {
    if (!mainWindow) return null
    const list = database.listConnections()
    const statuses = await checkConnections(list)
    const report = buildDiagnostics(database, {
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      providers: Object.fromEntries(
        list.map((c) => {
          const s = statuses[c.providerId]
          return [
            c.providerId,
            {
              available: s?.available,
              version: s?.version,
              readiness: s?.readiness,
              authStatus: s?.authStatus,
              error: s?.error,
            },
          ]
        }),
      ),
      managedClis: listManagedClis(list.map((c) => c.providerId)).map((m) => ({
        provider: m.providerId,
        installed: m.installed,
        version: m.version,
        pinned: m.pinned,
      })),
    })
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar diagnóstico (sem segredos)',
      defaultPath: `orchbot-diagnostico-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, JSON.stringify(report, null, 2), { mode: 0o600 })
    return result.filePath
  })

  ipcMain.handle('orchbot:detect-local-runtimes', () =>
    detectLocalRuntimes(database.listConnections().map((c) => c.endpoint ?? '')),
  )
  ipcMain.handle(
    'orchbot:add-local-runtime',
    async (_e, p: { id: 'ollama' | 'lmstudio'; model: string }) => {
      const runtime = (await detectLocalRuntimes()).find((r) => r.id === p?.id)
      if (!runtime) throw new Error('Servidor local não encontrado. Ele continua rodando?')
      const model = String(p.model || runtime.models[0] || '')
      if (!model) throw new Error('Nenhum modelo instalado nesse servidor.')
      const connection = database.createCustomProvider({
        name: runtime.name,
        endpoint: runtime.endpoint,
        defaultModel: model,
      })
      if (isCustomProvider(connection.providerId))
        providerRegistry.registerAdapter(
          new OpenAiCompatibleAdapter(connection.providerId, connection.name),
        )
      providerStatusCache = null
      return connection
    },
  )

  const themesDir = path.join(app.getPath('userData'), 'themes')
  ipcMain.handle('orchbot:list-themes', () => loadThemes(themesDir))
  ipcMain.handle('orchbot:open-themes-folder', async () => {
    fs.mkdirSync(themesDir, { recursive: true })
    const example = path.join(themesDir, 'exemplo.json.txt')
    if (!fs.existsSync(example)) fs.writeFileSync(example, EXAMPLE_THEME)
    await shell.openPath(themesDir)
    return themesDir
  })
  stopThemeWatch?.()
  fs.mkdirSync(themesDir, { recursive: true })
  stopThemeWatch = watchThemes([themesDir, omarchyThemesDir()], () =>
    mainWindow?.webContents.send('orchbot:themes-changed', loadThemes(themesDir)),
  )

  ipcMain.handle('orchbot:get-managed-clis', () =>
    listManagedClis(
      database
        .listConnections()
        .filter((c) => !isCustomProvider(c.providerId))
        .map((c) => c.providerId),
    ),
  )
  ipcMain.handle(
    'orchbot:install-managed-cli',
    async (_e, p: { providerId: SupportedProvider; version?: string; pin?: boolean }) => {
      updatesCache = null
      providerStatusCache = null
      return installManagedCli(p.providerId, p.version || 'latest', p.pin !== false)
    },
  )
  ipcMain.handle(
    'orchbot:set-managed-cli-pin',
    (_e, p: { providerId: SupportedProvider; pinned: boolean }) => {
      updatesCache = null
      return setManagedPin(p.providerId, Boolean(p.pinned))
    },
  )
  ipcMain.handle('orchbot:remove-managed-cli', (_e, id: SupportedProvider) => {
    updatesCache = null
    providerStatusCache = null
    return removeManagedCli(id)
  })

  ipcMain.handle('orchbot:get-app-update', () => appUpdater?.status())
  ipcMain.handle('orchbot:check-app-update', () => appUpdater?.check())
  ipcMain.handle('orchbot:install-app-update', () => appUpdater?.install())
  ipcMain.handle('orchbot:pending-link', () => {
    const link = pendingLink
    pendingLink = null
    return link
  })

  const skills = getSkillService()
  ipcMain.handle('orchbot:skills-list', () => skills.list())
  ipcMain.handle('orchbot:skills-get', (_e, slug: string) => skills.get(String(slug)))
  ipcMain.handle(
    'orchbot:skills-save',
    (_e, i: { slug?: string; name: string; description: string; body: string }) =>
      i.slug
        ? skills.revise(i.slug, { name: i.name, description: i.description, body: i.body })
        : skills.create({ slug: slugify(i.name), ...i }),
  )
  ipcMain.handle('orchbot:skills-remove', (_e, slug: string) => skills.remove(String(slug)))
  ipcMain.handle('orchbot:skills-install-folder', async () => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Escolher a pasta da skill (contém SKILL.md)',
      properties: ['openDirectory'],
    })
    return result.canceled || !result.filePaths[0]
      ? null
      : skills.installFolder(result.filePaths[0])
  })
  ipcMain.handle('orchbot:skills-catalog', () => skills.catalog())
  ipcMain.handle('orchbot:skills-install-bundled', (_e, slug: string) =>
    skills.installBundled(String(slug)),
  )
  ipcMain.handle('orchbot:skill-proposals', () => skills.listProposals())
  ipcMain.handle('orchbot:skill-decide', (_e, p: { id: string; accept: boolean }) =>
    skills.decideProposal(String(p?.id ?? ''), p?.accept === true),
  )
  ipcMain.handle('orchbot:agent-skills-get', (_e, agentId: string) =>
    database.listAgentSkills(String(agentId)),
  )
  ipcMain.handle('orchbot:agent-skills-set', (_e, p: { agentId: string; slugs: string[] }) =>
    database.setAgentSkills(
      String(p.agentId),
      (Array.isArray(p.slugs) ? p.slugs : []).filter((s) => typeof s === 'string'),
    ),
  )
  ipcMain.handle('orchbot:mcp-list', () => database.listMcpServers())
  ipcMain.handle('orchbot:mcp-save', (_e, input: SaveMcpServerInput) =>
    database.saveMcpServer(input),
  )
  ipcMain.handle('orchbot:mcp-remove', (_e, id: string) => database.removeMcpServer(String(id)))
  ipcMain.handle('orchbot:mcp-presets', () => MCP_PRESETS)
  ipcMain.handle('orchbot:agent-mcp-get', (_e, agentId: string) =>
    database.listAgentMcp(String(agentId)),
  )
  ipcMain.handle('orchbot:agent-mcp-set', (_e, p: { agentId: string; ids: string[] }) =>
    database.setAgentMcp(
      String(p.agentId),
      (Array.isArray(p.ids) ? p.ids : []).filter((s) => typeof s === 'string'),
    ),
  )
  ipcMain.handle('orchbot:draft-agent', (_e, p: { prompt: string; baseAgentId?: string }) =>
    draftAgent(database, providerRegistry, String(p?.prompt ?? ''), p?.baseAgentId),
  )
  ipcMain.handle('orchbot:draft-team', (_e, prompt: string) =>
    draftTeam(database, providerRegistry, String(prompt ?? '')),
  )
  ipcMain.handle('orchbot:list-approvals', () => database.listPendingApprovals())
  ipcMain.handle(
    'orchbot:decide-approval',
    (_e, p: { id: string; approved: boolean; note?: string }) =>
      queue.decideApproval(
        String(p?.id),
        p?.approved === true,
        typeof p?.note === 'string' ? p.note.slice(0, 2000) : undefined,
      ),
  )
  ipcMain.handle('orchbot:list-webhook-triggers', (_e, agentId: string) =>
    database.listWebhookTriggers(String(agentId)),
  )
  ipcMain.handle(
    'orchbot:create-webhook-trigger',
    (_e, p: { agentId: string; title: string; instruction: string }) => {
      const instruction = String(p?.instruction ?? '').slice(0, 8000)
      if (!instruction.trim())
        throw new Error('Escreva o que o robô deve fazer quando for chamado.')
      return database.createWebhookTrigger(
        String(p?.agentId),
        String(p?.title ?? '').slice(0, 80),
        instruction,
      )
    },
  )
  ipcMain.handle('orchbot:delete-webhook-trigger', (_e, id: string) =>
    database.deleteWebhookTrigger(String(id)),
  )
  ipcMain.handle('orchbot:webhook-base-url', () => webhookBaseUrl(webhookServer))
  ipcMain.handle('orchbot:channel-list', (_e, includeArchived: boolean) =>
    database.listChannels(Boolean(includeArchived)),
  )
  ipcMain.handle('orchbot:channel-messages', (_e, channelId: string) =>
    database.listChannelMessages(String(channelId)),
  )
  ipcMain.handle('orchbot:channel-create', (_e, input: CreateChannelInput) =>
    queue.collab.createChannel(input),
  )
  ipcMain.handle('orchbot:channel-post', (_e, p: { channelId: string; text: string }) =>
    queue.collab.post(String(p?.channelId), String(p?.text ?? '')),
  )
  ipcMain.handle(
    'orchbot:channel-control',
    (_e, p: { channelId: string; action: string; agentId?: string }) => {
      const id = String(p?.channelId)
      switch (p?.action) {
        case 'stop':
          return queue.collab.stop(id)
        case 'resume':
          return queue.collab.resume(id)
        case 'archive':
          return queue.collab.archive(id)
        case 'restore':
          return queue.collab.restore(id)
        case 'reassign':
          return queue.collab.reassign(id, String(p.agentId ?? ''))
        default:
          throw new Error('Ação de canal inválida')
      }
    },
  )
  ipcMain.handle('orchbot:memory-list', (_e, agentId: string) => database.listMemories(agentId))
  ipcMain.handle('orchbot:memory-add', (_e, p: { agentId: string; text: string }) => {
    if (!p?.agentId || typeof p.text !== 'string' || !p.text.trim())
      throw new Error('Memória vazia')
    return database.addMemory(p.agentId, p.text.slice(0, 2000))
  })
  ipcMain.handle('orchbot:memory-delete', (_e, p: { agentId: string; id: string }) =>
    database.deleteMemory(p.agentId, p.id),
  )
  ipcMain.handle('orchbot:brain-pages', (_e, projectId: string) =>
    queue.brain.listPages(String(projectId ?? '')),
  )
  ipcMain.handle('orchbot:brain-save', (_e, input: SaveBrainPageInput) =>
    queue.brain.savePage({
      projectId: String(input?.projectId ?? ''),
      slug: typeof input?.slug === 'string' ? input.slug : undefined,
      title: String(input?.title ?? ''),
      type: input?.type,
      content: String(input?.content ?? ''),
      replace: input?.replace === true,
    }),
  )
  ipcMain.handle('orchbot:brain-delete', (_e, p: { projectId: string; slug: string }) =>
    queue.brain.deletePage(String(p?.projectId ?? ''), String(p?.slug ?? '')),
  )
  ipcMain.handle('orchbot:brain-proposals', (_e, projectId: string) =>
    queue.brain.listProposals(String(projectId ?? '')),
  )
  ipcMain.handle('orchbot:brain-decide', (_e, p: { id: string; accept: boolean }) =>
    queue.brain.decide(String(p?.id ?? ''), p?.accept === true),
  )
  ipcMain.handle('orchbot:context-usage', (_e, p: { agentId: string; threadId: string }) => {
    const agent = database.getAgent(p.agentId)
    if (!agent || !queueManager) return { tokens: 0, window: 0, compacted: false }
    return {
      ...queueManager.memory.contextUsage(p.threadId, agent.model, undefined, {
        provider: agent.provider,
      }),
      compacted: Boolean(database.getThreadSummary(p.threadId)),
    }
  })

  ipcMain.handle(
    'orchbot:search-project-memory',
    (_event, payload: { agentId: string; query: string }) => {
      const { agentId, query } = payload
      if (!agentId || typeof query !== 'string') {
        throw new Error('Parâmetros inválidos para busca')
      }
      return database.searchProjectMemory(agentId, query)
    },
  )

  ipcMain.handle('orchbot:get-workspace-rules', (_event, agentId: string) => {
    if (typeof agentId !== 'string') throw new Error('ID do agente inválido')
    const agent = database.getAgent(agentId)
    if (!agent) return { exists: false }
    return loadWorkspaceRules(agent.workspacePath)
  })

  ipcMain.handle('orchbot:index-workspace', (_event, agentId: string) => {
    if (typeof agentId !== 'string') throw new Error('ID do agente inválido')
    const agent = database.getAgent(agentId)
    if (!agent) return { indexedCount: 0 }
    const count = database.indexWorkspaceFiles(agent.id, agent.workspacePath)
    return { indexedCount: count }
  })

  ipcMain.handle(
    'orchbot:send-message',
    async (_event, payload: { threadId: string; text: string; attachmentFilePaths?: string[] }) => {
      const { threadId, text, attachmentFilePaths } = payload
      if (!threadId || typeof threadId !== 'string') throw new Error('Thread ID obrigatório')
      if (!text || typeof text !== 'string' || !text.trim()) throw new Error('Mensagem vazia')

      const agent = database.getAgentByThreadId(threadId)
      if (!agent) {
        throw new Error('Agente não encontrado para esta conversa')
      }

      // 1. Salva a mensagem do usuário no SQLite
      const userMessage = database.addMessage(threadId, 'user', text.trim())

      // 2. Processa anexos gerenciados se fornecidos
      const savedAttachments = []
      let attachmentsContext = ''

      if (attachmentFilePaths && attachmentFilePaths.length > 0) {
        for (const filePath of attachmentFilePaths) {
          const att = await attachments.saveAttachment(filePath, userMessage.id, agent.id)
          savedAttachments.push(att)
        }
        userMessage.attachments = savedAttachments

        const attachmentList = savedAttachments
          .map((a) => `${a.fileName} (${a.filePath})`)
          .join(', ')
        attachmentsContext = `\n\n[Arquivos anexados pelo usuário na pasta gerenciada: ${attachmentList}]`
      }

      // 3. Monta o prompt incluindo o contexto dos anexos
      const effectivePrompt = text.trim() + attachmentsContext

      // 4. Orientar enquanto trabalha: 'imediato' interrompe o turno atual; 'fila' espera
      const caps = effectiveCapabilities(agent, database.getSettings())
      const running = database
        .listTasks(agent.id)
        .some((taskItem) => taskItem.status === 'running' && taskItem.threadId === threadId)
      if (caps.steerMode === 'imediato' && running) {
        queue.interruptThread(threadId)
      }

      // 5. Enfileira a tarefa na fila durável FIFO do agente
      const task = queue.enqueue(agent.id, threadId, effectivePrompt)
      queue.markFromPerson(task.id)

      return { userMessage, task }
    },
  )

  ipcMain.handle('orchbot:select-files', async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar arquivos para anexar',
      properties: ['openFile', 'multiSelections'],
    })
    if (result.canceled || result.filePaths.length === 0) return []

    return Promise.all(
      result.filePaths.map(async (filePath) => {
        const stat = await fs.promises.stat(filePath)
        return {
          fileName: path.basename(filePath),
          filePath,
          fileSize: stat.size,
        }
      }),
    )
  })

  ipcMain.handle('orchbot:open-attachment', async (_event, filePath: string) => {
    if (typeof filePath !== 'string') throw new Error('Caminho inválido')
    await shell.openPath(filePath)
    return true
  })

  ipcMain.handle('orchbot:delegate-task', async (_event, input: DelegationInput) => {
    return await delegation.delegate(input)
  })

  ipcMain.handle('orchbot:reset-provider-session', (_event, threadId: string) => {
    if (typeof threadId !== 'string' || !database.getThread(threadId))
      throw new Error('Conversa não encontrada.')
    return database.resetProviderSession(threadId)
  })

  ipcMain.handle('orchbot:interrupt-turn', (_event, threadId: string) => {
    if (typeof threadId !== 'string') throw new Error('Thread ID inválido')
    return queue.interruptThread(threadId)
  })

  ipcMain.handle('orchbot:get-queue', (_event, agentId: string) => {
    if (typeof agentId !== 'string') throw new Error('Agent ID inválido')
    return queue.listTasks(agentId)
  })

  ipcMain.handle('orchbot:is-queue-paused', (_event, agentId: string) => {
    if (typeof agentId !== 'string') throw new Error('Agent ID inválido')
    return queue.isPaused(agentId)
  })

  ipcMain.handle('orchbot:pause-queue', (_event, agentId: string) => {
    if (typeof agentId !== 'string') throw new Error('Agent ID inválido')
    return queue.pause(agentId)
  })

  ipcMain.handle('orchbot:resume-queue', (_event, agentId: string) => {
    if (typeof agentId !== 'string') throw new Error('Agent ID inválido')
    return queue.resume(agentId)
  })

  ipcMain.handle('orchbot:cancel-task', (_event, taskId: string) => {
    if (typeof taskId !== 'string') throw new Error('Task ID inválido')
    return queue.cancel(taskId)
  })

  ipcMain.handle('orchbot:retry-task', (_event, taskId: string) => {
    if (typeof taskId !== 'string') throw new Error('Task ID inválido')
    return queue.retry(taskId)
  })

  ipcMain.handle('orchbot:browser-get-tabs', (_event, agentId: string) => {
    if (typeof agentId !== 'string') throw new Error('Agent ID inválido')
    return browser.getTabs(agentId)
  })

  ipcMain.handle(
    'orchbot:browser-open-tab',
    async (_event, payload: { agentId: string; url: string }) => {
      const { agentId, url } = payload
      if (!agentId || !url) throw new Error('Parâmetros inválidos para abrir aba')
      return await browser.openTab(agentId, url)
    },
  )

  ipcMain.handle(
    'orchbot:browser-close-tab',
    async (_event, payload: { agentId: string; tabId: string }) => {
      const { agentId, tabId } = payload
      if (!agentId || !tabId) throw new Error('Parâmetros inválidos')
      return await browser.closeTab(agentId, tabId)
    },
  )

  ipcMain.handle(
    'orchbot:browser-navigate',
    async (
      _event,
      payload: { agentId: string; tabId: string; action: 'back' | 'forward' | 'reload' },
    ) => {
      const { agentId, tabId, action } = payload
      return await browser.navigate(agentId, tabId, action)
    },
  )

  ipcMain.handle(
    'orchbot:browser-inspect',
    async (_event, payload: { agentId: string; tabId: string }) => {
      const { agentId, tabId } = payload
      return await browser.inspect(agentId, tabId)
    },
  )

  ipcMain.handle(
    'orchbot:browser-click',
    async (_event, payload: { agentId: string; tabId: string; selector: string }) => {
      const { agentId, tabId, selector } = payload
      return await browser.click(agentId, tabId, selector)
    },
  )

  ipcMain.handle(
    'orchbot:browser-fill',
    async (
      _event,
      payload: { agentId: string; tabId: string; selector: string; value: string },
    ) => {
      const { agentId, tabId, selector, value } = payload
      return await browser.fill(agentId, tabId, selector, value)
    },
  )

  ipcMain.handle(
    'orchbot:browser-screenshot',
    async (_event, payload: { agentId: string; tabId: string }) => {
      const { agentId, tabId } = payload
      const base64 = await browser.captureScreenshot(agentId, tabId)
      return { base64 }
    },
  )

  ipcMain.handle(
    'orchbot:browser-run-script',
    async (_event, payload: { agentId: string; tabId: string; script: string }) => {
      const { agentId, tabId, script } = payload
      return await browser.runScript(agentId, tabId, script)
    },
  )

  ipcMain.handle(
    'orchbot:browser-set-bounds',
    (_event, payload: { agentId: string; tabId: string; bounds: BrowserBounds | null }) => {
      const { agentId, tabId, bounds } = payload
      browser.setBounds(agentId, tabId, bounds)
      return true
    },
  )

  // --- Agendamentos & Tarefas em Background (Cron) ---
  const scheduler = getCronScheduler()

  ipcMain.handle('orchbot:get-scheduled-tasks', (_event, agentId?: string) => {
    return database.listScheduledTasks(agentId)
  })

  ipcMain.handle('orchbot:create-scheduled-task', (_event, rawInput: unknown) => {
    const input = validateCreateScheduledTaskInput(rawInput)
    return database.createScheduledTask(input)
  })

  ipcMain.handle('orchbot:update-scheduled-task', (_event, input: UpdateScheduledTaskInput) => {
    return database.updateScheduledTask(input)
  })

  ipcMain.handle('orchbot:delete-scheduled-task', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('ID do agendamento inválido')
    return database.deleteScheduledTask(id)
  })

  ipcMain.handle('orchbot:run-scheduled-task-now', async (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('ID do agendamento inválido')
    return await scheduler.runNow(id)
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function sendDeepLink(link: DeepLink): void {
  pendingLink = link
  mainWindow?.webContents.send('orchbot:deep-link', link)
}

if (gotLock)
  app.whenReady().then(() => {
    setManagedCliRoot(path.join(app.getPath('userData'), 'cli'))
    if (ensureForeman(getDatabase())) foremanReady = true
    registerIpcHandlers()
    createWindow()
    startWebhookServer(getDatabase(), getQueueManager())
      .then((server) => {
        webhookServer = server
      })
      .catch(() => {
        // porta ocupada: o app segue, só sem webhooks (a tela avisa)
      })

    appUpdater = createAppUpdater(
      () => getDatabase().getSettings(),
      (status) => mainWindow?.webContents.send('orchbot:app-update', status),
    )
    appUpdater.startIfEnabled()
    if (process.platform === 'linux' && app.isPackaged && process.env.APPIMAGE)
      try {
        registerAppImageDesktop(process.env.APPIMAGE, iconPath())
      } catch {
        // sem ~/.local/share gravável: o app abre, só sem link orchbot:// e ícone no lançador
      }
    const shellApi = initShell({
      getWindow: () => mainWindow,
      createWindow,
      onDeepLink: sendDeepLink,
      onCheckUpdate: () => void appUpdater?.check(),
    })
    shellApi.handleInitial()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

app.on('before-quit', () => {
  ;(app as unknown as { isQuitting?: boolean }).isQuitting = true
  queueManager?.close()
  registry?.interruptAll()
})

app.on('window-all-closed', () => {
  cronScheduler?.close()
  webhookServer?.close()
  if (process.platform !== 'darwin') {
    db?.close()
    app.quit()
  }
})
