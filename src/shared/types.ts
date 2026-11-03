export type SupportedProvider = 'codex' | 'claude' | 'grok' | 'muse'

export interface ProviderConnection {
  providerId: SupportedProvider
  name: string
  enabled: boolean
  apiKey?: string
  endpoint?: string
  defaultModel: string
  available: boolean
  version?: string
  error?: string
  models: string[]
  updatedAt: string
}

export interface UpdateConnectionInput {
  providerId: SupportedProvider
  enabled?: boolean
  apiKey?: string
  endpoint?: string
  defaultModel?: string
}

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

export interface UpdateAgentInput {
  id: string
  name?: string
  provider?: SupportedProvider
  model?: string
  instructions?: string
  workspacePath?: string
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

export interface BrowserTab {
  id: string
  agentId: string
  url: string
  title: string
  isLoading: boolean
  createdAt: string
  updatedAt: string
}

export interface BrowserPageLink {
  text: string
  href: string
}

export interface BrowserPageInput {
  name?: string
  id?: string
  type?: string
  placeholder?: string
  selector: string
}

export interface BrowserPageContent {
  tabId: string
  url: string
  title: string
  textSummary: string
  links: BrowserPageLink[]
  inputs: BrowserPageInput[]
}

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface OrchbotApi {
  getAgents: () => Promise<Agent[]>
  getAgent: (id: string) => Promise<Agent | null>
  createAgent: (input: CreateAgentInput) => Promise<Agent>
  updateAgent: (input: UpdateAgentInput) => Promise<Agent>
  deleteAgent: (id: string) => Promise<boolean>
  getThreads: (agentId: string) => Promise<Thread[]>
  createThread: (agentId: string, title?: string) => Promise<Thread>
  deleteThread: (threadId: string) => Promise<boolean>
  updateThreadTitle: (threadId: string, title: string) => Promise<Thread>
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
  browserGetTabs: (agentId: string) => Promise<BrowserTab[]>
  browserOpenTab: (agentId: string, url: string) => Promise<BrowserTab>
  browserCloseTab: (agentId: string, tabId: string) => Promise<boolean>
  browserNavigate: (
    agentId: string,
    tabId: string,
    action: 'back' | 'forward' | 'reload',
  ) => Promise<BrowserTab>
  browserInspect: (agentId: string, tabId: string) => Promise<BrowserPageContent>
  browserClick: (agentId: string, tabId: string, selector: string) => Promise<boolean>
  browserFill: (agentId: string, tabId: string, selector: string, value: string) => Promise<boolean>
  browserScreenshot: (agentId: string, tabId: string) => Promise<{ base64: string }>
  browserRunScript: (agentId: string, tabId: string, script: string) => Promise<unknown>
  browserSetBounds?: (
    agentId: string,
    tabId: string,
    bounds: BrowserBounds | null,
  ) => Promise<boolean>
  onStreamChunk: (listener: (data: StreamChunkEvent) => void) => () => void
  onTurnFinished: (listener: (data: TurnFinishedEvent) => void) => () => void
  onTurnError: (listener: (data: TurnErrorEvent) => void) => () => void
  onTaskStatusChanged: (listener: (data: TaskStatusChangedEvent) => void) => () => void
  onBrowserTabUpdated: (listener: (tab: BrowserTab) => void) => () => void
  getConnections: () => Promise<ProviderConnection[]>
  updateConnection: (input: UpdateConnectionInput) => Promise<ProviderConnection>
  testConnection: (providerId: SupportedProvider) => Promise<{ success: boolean; message: string }>
  searchProjectMemory: (agentId: string, query: string) => Promise<SearchResultGroup>
  getWorkspaceRules: (agentId: string) => Promise<WorkspaceRulesInfo>
  indexWorkspace: (agentId: string) => Promise<{ indexedCount: number }>
}

export interface SearchMessageResult {
  id: string
  threadId: string
  threadTitle: string
  role: string
  text: string
  snippet: string
  createdAt?: string
}

export interface SearchFileResult {
  filePath: string
  fileName: string
  snippet: string
}

export interface SearchResultGroup {
  messages: SearchMessageResult[]
  files: SearchFileResult[]
}

export interface WorkspaceRulesInfo {
  exists: boolean
  filename?: string
  filePath?: string
  content?: string
}

export function validateCreateAgentInput(raw: unknown): CreateAgentInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Entrada inválida para criação de agente')
  }

  const { name, provider, model, instructions, workspacePath } = raw as Record<string, unknown>

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('O nome do agente é obrigatório')
  }

  if (provider !== 'codex' && provider !== 'claude' && provider !== 'grok' && provider !== 'muse') {
    throw new Error('Provedor inválido (suportados: codex, claude, grok, muse)')
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
