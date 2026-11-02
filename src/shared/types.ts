export type SupportedProvider = 'codex' | 'claude'

export interface Agent {
  id: string
  name: string
  provider: SupportedProvider
  model: string
  instructions: string
  workspacePath: string
  avatar?: string
  createdAt: string
  updatedAt: string
}

export interface CreateAgentInput {
  name: string
  provider: SupportedProvider
  model: string
  instructions?: string
  workspacePath: string
}

export interface Thread {
  id: string
  agentId: string
  title: string
  createdAt: string
}

export interface Attachment {
  id: string
  messageId: string
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  hash: string
  createdAt: string
}

export interface Message {
  id: string
  threadId: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: string
  attachments?: Attachment[]
  senderAgentId?: string
  recipientAgentId?: string
}

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface TaskQueueItem {
  id: string
  agentId: string
  threadId: string
  prompt: string
  status: TaskStatus
  error?: string | null
  createdAt: string
  startedAt?: string | null
  completedAt?: string | null
  delegationDepth?: number
}

export interface DelegationInput {
  fromAgentId: string
  toAgentId: string
  prompt: string
  parentTaskId?: string
}

export interface SelectedFile {
  fileName: string
  filePath: string
  fileSize: number
}

export interface SystemStatus {
  appVersion: string
  platform: string
  dbPath: string
}

export interface ProviderInfo {
  available: boolean
  version?: string
  path?: string
  error?: string
}

export interface StreamChunkEvent {
  threadId: string
  chunk: string
  fullText: string
}

export interface TurnFinishedEvent {
  threadId: string
  message: Message
}

export interface TurnErrorEvent {
  threadId: string
  error: string
}

export interface TaskStatusChangedEvent {
  task: TaskQueueItem
}

export interface OrchbotApi {
  getAgents: () => Promise<Agent[]>
  getAgent: (id: string) => Promise<Agent | null>
  createAgent: (input: CreateAgentInput) => Promise<Agent>
  deleteAgent: (id: string) => Promise<boolean>
  getThreads: (agentId: string) => Promise<Thread[]>
  getMessages: (threadId: string) => Promise<Message[]>
  getSystemStatus: () => Promise<SystemStatus>
  getProviderStatus: () => Promise<Record<SupportedProvider, ProviderInfo>>
  sendMessage: (
    threadId: string,
    text: string,
    attachmentFilePaths?: string[],
  ) => Promise<{ userMessage: Message; task: TaskQueueItem }>
  interruptTurn: (threadId: string) => Promise<boolean>
  getQueue: (agentId: string) => Promise<TaskQueueItem[]>
  isQueuePaused: (agentId: string) => Promise<boolean>
  pauseQueue: (agentId: string) => Promise<boolean>
  resumeQueue: (agentId: string) => Promise<boolean>
  cancelTask: (taskId: string) => Promise<boolean>
  retryTask: (taskId: string) => Promise<boolean>
  selectFiles: () => Promise<SelectedFile[]>
  openAttachment: (filePath: string) => Promise<boolean>
  delegateTask: (input: DelegationInput) => Promise<{ task: TaskQueueItem; message: Message }>
  onStreamChunk: (listener: (data: StreamChunkEvent) => void) => () => void
  onTurnFinished: (listener: (data: TurnFinishedEvent) => void) => () => void
  onTurnError: (listener: (data: TurnErrorEvent) => void) => () => void
  onTaskStatusChanged: (listener: (data: TaskStatusChangedEvent) => void) => () => void
}

export function validateCreateAgentInput(raw: unknown): CreateAgentInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Entrada inválida para criação de agente')
  }

  const { name, provider, model, instructions, workspacePath } = raw as Record<string, unknown>

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('O nome do agente é obrigatório')
  }

  if (provider !== 'codex' && provider !== 'claude') {
    throw new Error('Provedor inválido (suportados: codex, claude)')
  }

  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new Error('O modelo é obrigatório')
  }

  if (typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
    throw new Error('O caminho do workspace é obrigatório')
  }

  return {
    name: name.trim(),
    provider,
    model: model.trim(),
    instructions: typeof instructions === 'string' ? instructions.trim() : '',
    workspacePath: workspacePath.trim(),
  }
}
