import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { BrowserManager } from '../backend/browser/browser-manager'
import { ElectronBrowserDriver } from '../backend/browser/electron-driver'
import { DelegationService } from '../backend/delegation/delegation-service'
import { ProviderRegistry } from '../backend/providers/registry'
import { QueueManager } from '../backend/queue/queue-manager'
import { AttachmentManager } from '../backend/storage/attachment-manager'
import { OrchbotDatabase } from '../backend/storage/db'
import type { BrowserBounds, DelegationInput } from '../shared/types'
import { validateCreateAgentInput } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let db: OrchbotDatabase | null = null
let registry: ProviderRegistry | null = null
let queueManager: QueueManager | null = null
let attachmentManager: AttachmentManager | null = null
let delegationService: DelegationService | null = null
let browserManager: BrowserManager | null = null

function getDatabase(): OrchbotDatabase {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'orchbot.db')
    db = new OrchbotDatabase(dbPath)
  }
  return db
}

function getProviderRegistry(): ProviderRegistry {
  if (!registry) {
    registry = new ProviderRegistry()
  }
  return registry
}

function getQueueManager(): QueueManager {
  if (!queueManager) {
    queueManager = new QueueManager(getDatabase(), getProviderRegistry())

    // Configura os eventos de streaming e ciclo de vida para repassar à janela
    queueManager.setEvents({
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
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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

  ipcMain.handle('orchbot:get-agents', () => {
    return database.listAgents()
  })

  ipcMain.handle('orchbot:get-agent', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('ID inválido')
    return database.getAgent(id)
  })

  ipcMain.handle('orchbot:create-agent', (_event, rawInput: unknown) => {
    const validated = validateCreateAgentInput(rawInput)
    return database.createAgent(validated)
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
    return await providerRegistry.checkAllAvailability()
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

      // 4. Enfileira a tarefa na fila durável FIFO do agente
      const task = queue.enqueue(agent.id, threadId, effectivePrompt)

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

  ipcMain.handle('orchbot:interrupt-turn', (_event, threadId: string) => {
    if (typeof threadId !== 'string') throw new Error('Thread ID inválido')
    return providerRegistry.interruptThread(threadId)
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
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    db?.close()
    app.quit()
  }
})
