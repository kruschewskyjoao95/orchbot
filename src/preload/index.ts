import { contextBridge, ipcRenderer } from 'electron'
import type { CreateAgentInput, OrchbotApi } from '../shared/types'

const api: OrchbotApi = {
  getAgents: () => ipcRenderer.invoke('orchbot:get-agents'),
  getAgent: (id: string) => ipcRenderer.invoke('orchbot:get-agent', id),
  createAgent: (input: CreateAgentInput) => ipcRenderer.invoke('orchbot:create-agent', input),
  deleteAgent: (id: string) => ipcRenderer.invoke('orchbot:delete-agent', id),
  getThreads: (agentId: string) => ipcRenderer.invoke('orchbot:get-threads', agentId),
  getMessages: (threadId: string) => ipcRenderer.invoke('orchbot:get-messages', threadId),
  getSystemStatus: () => ipcRenderer.invoke('orchbot:get-system-status'),
}

contextBridge.exposeInMainWorld('orchbot', api)
