import { contextBridge, ipcRenderer } from 'electron'
import type {
  BrowserBounds,
  BrowserTab,
  CreateAgentInput,
  DelegationInput,
  OrchbotApi,
  StreamChunkEvent,
  SupportedProvider,
  TaskStatusChangedEvent,
  TurnErrorEvent,
  TurnFinishedEvent,
  UpdateAgentInput,
  UpdateConnectionInput,
} from '../shared/types'

const api: OrchbotApi = {
  getAgents: () => ipcRenderer.invoke('orchbot:get-agents'),
  getAgent: (id: string) => ipcRenderer.invoke('orchbot:get-agent', id),
  createAgent: (input: CreateAgentInput) => ipcRenderer.invoke('orchbot:create-agent', input),
  updateAgent: (input: UpdateAgentInput) => ipcRenderer.invoke('orchbot:update-agent', input),
  deleteAgent: (id: string) => ipcRenderer.invoke('orchbot:delete-agent', id),
  getThreads: (agentId: string) => ipcRenderer.invoke('orchbot:get-threads', agentId),
  createThread: (agentId: string, title?: string) =>
    ipcRenderer.invoke('orchbot:create-thread', { agentId, title }),
  deleteThread: (threadId: string) => ipcRenderer.invoke('orchbot:delete-thread', threadId),
  updateThreadTitle: (threadId: string, title: string) =>
    ipcRenderer.invoke('orchbot:update-thread-title', { threadId, title }),
  getMessages: (threadId: string) => ipcRenderer.invoke('orchbot:get-messages', threadId),
  getSystemStatus: () => ipcRenderer.invoke('orchbot:get-system-status'),
  getProviderStatus: () => ipcRenderer.invoke('orchbot:get-provider-status'),
  sendMessage: (threadId: string, text: string, attachmentFilePaths?: string[]) =>
    ipcRenderer.invoke('orchbot:send-message', { threadId, text, attachmentFilePaths }),
  interruptTurn: (threadId: string) => ipcRenderer.invoke('orchbot:interrupt-turn', threadId),

  getQueue: (agentId: string) => ipcRenderer.invoke('orchbot:get-queue', agentId),
  isQueuePaused: (agentId: string) => ipcRenderer.invoke('orchbot:is-queue-paused', agentId),
  pauseQueue: (agentId: string) => ipcRenderer.invoke('orchbot:pause-queue', agentId),
  resumeQueue: (agentId: string) => ipcRenderer.invoke('orchbot:resume-queue', agentId),
  cancelTask: (taskId: string) => ipcRenderer.invoke('orchbot:cancel-task', taskId),
  retryTask: (taskId: string) => ipcRenderer.invoke('orchbot:retry-task', taskId),

  selectFiles: () => ipcRenderer.invoke('orchbot:select-files'),
  openAttachment: (filePath: string) => ipcRenderer.invoke('orchbot:open-attachment', filePath),
  delegateTask: (input: DelegationInput) => ipcRenderer.invoke('orchbot:delegate-task', input),

  browserGetTabs: (agentId: string) => ipcRenderer.invoke('orchbot:browser-get-tabs', agentId),
  browserOpenTab: (agentId: string, url: string) =>
    ipcRenderer.invoke('orchbot:browser-open-tab', { agentId, url }),
  browserCloseTab: (agentId: string, tabId: string) =>
    ipcRenderer.invoke('orchbot:browser-close-tab', { agentId, tabId }),
  browserNavigate: (agentId: string, tabId: string, action: 'back' | 'forward' | 'reload') =>
    ipcRenderer.invoke('orchbot:browser-navigate', { agentId, tabId, action }),
  browserInspect: (agentId: string, tabId: string) =>
    ipcRenderer.invoke('orchbot:browser-inspect', { agentId, tabId }),
  browserClick: (agentId: string, tabId: string, selector: string) =>
    ipcRenderer.invoke('orchbot:browser-click', { agentId, tabId, selector }),
  browserFill: (agentId: string, tabId: string, selector: string, value: string) =>
    ipcRenderer.invoke('orchbot:browser-fill', { agentId, tabId, selector, value }),
  browserScreenshot: (agentId: string, tabId: string) =>
    ipcRenderer.invoke('orchbot:browser-screenshot', { agentId, tabId }),
  browserRunScript: (agentId: string, tabId: string, script: string) =>
    ipcRenderer.invoke('orchbot:browser-run-script', { agentId, tabId, script }),
  browserSetBounds: (agentId: string, tabId: string, bounds: BrowserBounds | null) =>
    ipcRenderer.invoke('orchbot:browser-set-bounds', { agentId, tabId, bounds }),

  onStreamChunk: (listener: (data: StreamChunkEvent) => void) => {
    const handler = (_event: unknown, data: StreamChunkEvent) => listener(data)
    ipcRenderer.on('orchbot:stream-chunk', handler)
    return () => {
      ipcRenderer.removeListener('orchbot:stream-chunk', handler)
    }
  },

  onTurnFinished: (listener: (data: TurnFinishedEvent) => void) => {
    const handler = (_event: unknown, data: TurnFinishedEvent) => listener(data)
    ipcRenderer.on('orchbot:turn-finished', handler)
    return () => {
      ipcRenderer.removeListener('orchbot:turn-finished', handler)
    }
  },

  onTurnError: (listener: (data: TurnErrorEvent) => void) => {
    const handler = (_event: unknown, data: TurnErrorEvent) => listener(data)
    ipcRenderer.on('orchbot:turn-error', handler)
    return () => {
      ipcRenderer.removeListener('orchbot:turn-error', handler)
    }
  },

  onTaskStatusChanged: (listener: (data: TaskStatusChangedEvent) => void) => {
    const handler = (_event: unknown, data: TaskStatusChangedEvent) => listener(data)
    ipcRenderer.on('orchbot:task-status-changed', handler)
    return () => {
      ipcRenderer.removeListener('orchbot:task-status-changed', handler)
    }
  },

  onBrowserTabUpdated: (listener: (tab: BrowserTab) => void) => {
    const handler = (_event: unknown, tab: BrowserTab) => listener(tab)
    ipcRenderer.on('orchbot:browser-tab-updated', handler)
    return () => {
      ipcRenderer.removeListener('orchbot:browser-tab-updated', handler)
    }
  },

  getConnections: () => ipcRenderer.invoke('orchbot:get-connections'),
  updateConnection: (input: UpdateConnectionInput) =>
    ipcRenderer.invoke('orchbot:update-connection', input),
  testConnection: (providerId: SupportedProvider) =>
    ipcRenderer.invoke('orchbot:test-connection', providerId),
}

contextBridge.exposeInMainWorld('orchbot', api)
