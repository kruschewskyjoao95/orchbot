import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { ProviderRegistry } from '../backend/providers/registry'
import { QueueManager } from '../backend/queue/queue-manager'
import { OrchbotDatabase } from '../backend/storage/db'
import { validateCreateAgentInput } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let db: OrchbotDatabase | null = null
let registry: ProviderRegistry | null = null
let queueManager: QueueManager | null = null

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

  ipcMain.handle('orchbot:delete-agent', (_event, id: string) => {
    if (typeof id !== 'string') throw new Error('ID inválido')
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
    async (_event, payload: { threadId: string; text: string }) => {
      const { threadId, text } = payload
      if (!threadId || typeof threadId !== 'string') throw new Error('Thread ID obrigatório')
      if (!text || typeof text !== 'string' || !text.trim()) throw new Error('Mensagem vazia')

      const agent = database.getAgentByThreadId(threadId)
      if (!agent) {
        throw new Error('Agente não encontrado para esta conversa')
      }

      // 1. Salva a mensagem do usuário no SQLite
      const userMessage = database.addMessage(threadId, 'user', text.trim())

      // 2. Enfileira a tarefa na fila durável FIFO do agente
      const task = queue.enqueue(agent.id, threadId, text.trim())

      return { userMessage, task }
    },
  )

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
