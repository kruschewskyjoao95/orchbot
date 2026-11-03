export type SupportedProvider = 'codex' | 'claude' | 'grok' | 'gemini' | 'muse'

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

export type AutonomyLevel = 'cautious' | 'autonomous'

export interface Agent {
  id: string
  name: string
  provider: SupportedProvider
  model: string
  instructions: string
  workspacePath: string
  avatar?: string
  autonomyLevel?: AutonomyLevel
  createdAt: string
  updatedAt: string
}

export interface CreateAgentInput {
  name: string
  provider: SupportedProvider
  model: string
  instructions?: string
  workspacePath: string
  autonomyLevel?: AutonomyLevel
}

export interface UpdateAgentInput {
  id: string
  name?: string
  provider?: SupportedProvider
  model?: string
  instructions?: string
  workspacePath?: string
  autonomyLevel?: AutonomyLevel
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
  getScheduledTasks: (agentId?: string) => Promise<ScheduledTask[]>
  createScheduledTask: (input: CreateScheduledTaskInput) => Promise<ScheduledTask>
  updateScheduledTask: (input: UpdateScheduledTaskInput) => Promise<ScheduledTask>
  deleteScheduledTask: (id: string) => Promise<boolean>
  runScheduledTaskNow: (id: string) => Promise<boolean>
  onScheduledTaskTriggered: (listener: (task: ScheduledTask) => void) => () => void
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

  if (
    provider !== 'codex' &&
    provider !== 'claude' &&
    provider !== 'grok' &&
    provider !== 'gemini' &&
    provider !== 'muse'
  ) {
    throw new Error('Provedor inválido (suportados: codex, claude, grok, gemini, muse)')
  }

  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new Error('O modelo é obrigatório')
  }

  if (typeof workspacePath !== 'string' || workspacePath.trim().length === 0) {
    throw new Error('O caminho do workspace é obrigatório')
  }

  const rawAutonomy = (raw as Record<string, unknown>).autonomyLevel
  const result: CreateAgentInput = {
    name: name.trim(),
    provider,
    model: model.trim(),
    instructions: typeof instructions === 'string' ? instructions.trim() : '',
    workspacePath: workspacePath.trim(),
  }
  if (rawAutonomy !== undefined) {
    result.autonomyLevel = rawAutonomy === 'cautious' ? 'cautious' : 'autonomous'
  }
  return result
}

export type ScheduledTaskType = 'routine' | 'browser_monitor'

export interface ScheduledTask {
  id: string
  agentId: string
  threadId?: string | null
  title: string
  prompt: string
  cronExpression: string
  taskType: ScheduledTaskType
  targetUrl?: string | null
  enabled: boolean
  lastRunAt?: string | null
  nextRunAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateScheduledTaskInput {
  agentId: string
  threadId?: string
  title: string
  prompt: string
  cronExpression: string
  taskType?: ScheduledTaskType
  targetUrl?: string
  enabled?: boolean
}

export interface UpdateScheduledTaskInput {
  id: string
  title?: string
  prompt?: string
  cronExpression?: string
  taskType?: ScheduledTaskType
  targetUrl?: string
  enabled?: boolean
  nextRunAt?: string
  lastRunAt?: string
}

export function validateCreateScheduledTaskInput(raw: unknown): CreateScheduledTaskInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Entrada inválida para criação de agendamento')
  }

  const { agentId, title, prompt, cronExpression, taskType, targetUrl, threadId, enabled } =
    raw as Record<string, unknown>

  if (typeof agentId !== 'string' || agentId.trim().length === 0) {
    throw new Error('O ID do agente é obrigatório')
  }

  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Error('O título do agendamento é obrigatório')
  }

  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('A instrução/prompt do agendamento é obrigatória')
  }

  if (typeof cronExpression !== 'string' || cronExpression.trim().length === 0) {
    throw new Error('A expressão cron é obrigatória')
  }

  return {
    agentId: agentId.trim(),
    title: title.trim(),
    prompt: prompt.trim(),
    cronExpression: cronExpression.trim(),
    threadId:
      typeof threadId === 'string' && threadId.trim().length > 0 ? threadId.trim() : undefined,
    taskType: taskType === 'browser_monitor' ? 'browser_monitor' : 'routine',
    targetUrl:
      typeof targetUrl === 'string' && targetUrl.trim().length > 0 ? targetUrl.trim() : undefined,
    enabled: enabled !== false,
  }
}
