import { contextBridge, ipcRenderer } from 'electron'
import type {
  CreateAgentInput,
  OrchbotApi,
  StreamChunkEvent,
  TurnErrorEvent,
  TurnFinishedEvent,
} from '../shared/types'

const api: OrchbotApi = {
  getAgents: () => ipcRenderer.invoke('orchbot:get-agents'),
  getAgent: (id: string) => ipcRenderer.invoke('orchbot:get-agent', id),
  createAgent: (input: CreateAgentInput) => ipcRenderer.invoke('orchbot:create-agent', input),
  deleteAgent: (id: string) => ipcRenderer.invoke('orchbot:delete-agent', id),
  getThreads: (agentId: string) => ipcRenderer.invoke('orchbot:get-threads', agentId),
  getMessages: (threadId: string) => ipcRenderer.invoke('orchbot:get-messages', threadId),
  getSystemStatus: () => ipcRenderer.invoke('orchbot:get-system-status'),
  getProviderStatus: () => ipcRenderer.invoke('orchbot:get-provider-status'),
  sendMessage: (threadId: string, text: string) =>
    ipcRenderer.invoke('orchbot:send-message', { threadId, text }),
  interruptTurn: (threadId: string) => ipcRenderer.invoke('orchbot:interrupt-turn', threadId),

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
}

contextBridge.exposeInMainWorld('orchbot', api)
