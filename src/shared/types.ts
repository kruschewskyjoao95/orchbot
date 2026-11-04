export type BuiltinProvider =
  | 'codex'
  | 'claude'
  | 'grok'
  | 'gemini'
  | 'muse'
  | 'antigravity'
  | 'opencode'
  | 'copilot'
  | 'pi'
  | 'kimi'
  | 'acp'

export type CustomProviderId = `custom:${string}`
export type SupportedProvider = BuiltinProvider | CustomProviderId

export const SUPPORTED_PROVIDERS: BuiltinProvider[] = [
  'codex',
  'claude',
  'grok',
  'gemini',
  'muse',
  'antigravity',
  'opencode',
  'copilot',
  'pi',
  'kimi',
  'acp',
]

export type ProviderEffort = string

export function isProviderEffort(value: unknown): value is ProviderEffort {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value)
}

export interface ProviderModelInfo {
  id: string
  displayName?: string
  supportedEfforts?: ProviderEffort[]
  defaultEffort?: ProviderEffort
}

export interface ProviderModelCatalog {
  models: ProviderModelInfo[]
  source: 'cli' | 'cache' | 'catalog'
}

export type ProviderReadiness =
  | 'ready'
  | 'login_required'
  | 'not_installed'
  | 'unverified'
  | 'not_configured'
  | 'error'

export type ProviderAuthStatus = 'cli' | 'env' | 'missing' | 'unknown'

export interface ProviderCatalogEntry {
  providerId: SupportedProvider
  name: string
  cliCommand: string
  versionArgs: string[]
  loginHint?: string
  installHint: string
  docsUrl: string
  envKeys: string[]
  defaultModel: string
  models: string[]
  supportsEffort: boolean
  supportsEndpoint: boolean
  supportsModelDiscovery: boolean
}

export interface ProviderConnection {
  providerId: SupportedProvider
  name: string
  enabled: boolean
  hasApiKey: boolean
  keyStorageError?: string
  endpoint?: string
  defaultModel: string
  cliPath?: string
  cliArgs?: string[]
  apiKeyEnv?: string
  effort?: ProviderEffort
  available: boolean
  version?: string
  path?: string
  readiness?: ProviderReadiness
  loginHint?: string
  authStatus?: ProviderAuthStatus
  installHint?: string
  docsUrl?: string
  cliCommand?: string
  supportsEffort?: boolean
  error?: string
  models: string[]
  discoveredModels?: string[]
  updatedAt: string
}

export interface ProviderAccount extends ProviderInfo {
  id: string
  providerId: SupportedProvider
  label: string
  authMode: 'inherit' | 'api_key' | 'cli_profile'
  enabled: boolean
  isDefault: boolean
  hasApiKey: boolean
  keyStorageError?: string
  profilePath?: string
}

export interface CreateProviderAccountInput {
  providerId: SupportedProvider
  label: string
  authMode: 'api_key' | 'cli_profile'
  apiKey?: string
  profilePath?: string
}

export interface UpdateProviderAccountInput {
  providerId: SupportedProvider
  id: string
  label?: string
  enabled?: boolean
  apiKey?: string
  profilePath?: string
}

export interface CreateCustomProviderInput {
  name: string
  endpoint: string
  defaultModel: string
  apiKey?: string
}

export interface UpdateConnectionInput {
  providerId: SupportedProvider
  name?: string
  enabled?: boolean
  apiKey?: string
  endpoint?: string
  defaultModel?: string
  cliPath?: string
  cliArgs?: string[]
  apiKeyEnv?: string
  effort?: ProviderEffort
}

export type AutonomyLevel = 'cautious' | 'autonomous'

export type AgentRole = 'orchestrator' | 'worker'

/** Quanto de histórico/contexto vai em cada turno (economia de tokens). */
export type ContextMode = 'economico' | 'padrao' | 'completo'

export type AppTheme = 'dark' | 'light' | 'system'
export type SendShortcut = 'enter' | 'ctrl-enter'
export type ExternalLinksMode = 'default-browser' | 'embedded'

/** Como mensagens enviadas durante um turno são tratadas. */
export type SteerMode = 'fila' | 'imediato'

export interface AppSettings {
  theme: AppTheme
  language: string
  uiScale: number
  logoColor: string
  sendShortcut: SendShortcut
  showAgentSteps: boolean
  externalLinks: ExternalLinksMode
  startAtLogin: boolean
  quickConnection: boolean
  keepRunningInBackground: boolean
  restoreWorkspace: boolean
  shareAnalytics: boolean
  profileName: string
  profileEmail: string
  /** Versões de update já dispensadas por provedor (não notificar de novo). */
  dismissedProviderUpdates: Record<string, string>
  /** Uso do computador (ver/usar apps da máquina) habilitado por padrão. */
  computerUseEnabled: boolean
  // Padrões de Agents (valem quando o robô não define o seu)
  defaultLocalScripts: boolean
  defaultStartsNewChats: boolean
  defaultShowPlanBeforeLongTasks: boolean
  defaultSteerMode: SteerMode
  lastAgentId?: string
  lastThreadId?: string
  /** ISO do aceite do aviso de primeiro uso; ausente = ainda não aceitou. */
  consentAcceptedAt?: string
  consentVersion?: number
  /** Arquivo de tema em userData/themes (ou "omarchy:<nome>"); vazio = tema padrão. */
  customTheme: string
  /** Injeta branch, alterações e commits recentes do workspace em cada turno. */
  gitContext: boolean
  autoUpdate: boolean
  /** Endereço (HTTPS) do feed de atualização do Orchbot, ex.: https://exemplo.com/orchbot. */
  updateFeedUrl: string
  /** Provedor principal: novos agentes nascem com ele (vazio = primeiro ativo e pronto). */
  defaultProvider: string
  /** Tela de escolha de provedores já foi concluída (mostrada só uma vez). */
  providersSetupDone: boolean
}

/** Tamanho máximo das instruções que a pessoa (ou o rascunho da IA) dá a um robô. */
export const MAX_AGENT_INSTRUCTIONS = 2000

/** Sobe quando o texto do aviso muda de forma relevante; força novo aceite. */
export const CONSENT_VERSION = 1

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'pt-BR',
  uiScale: 100,
  logoColor: '#f4f4f5',
  sendShortcut: 'enter',
  showAgentSteps: true,
  externalLinks: 'default-browser',
  startAtLogin: false,
  quickConnection: true,
  keepRunningInBackground: false,
  restoreWorkspace: true,
  shareAnalytics: false,
  profileName: '',
  profileEmail: '',
  dismissedProviderUpdates: {},
  computerUseEnabled: false,
  defaultLocalScripts: false,
  defaultStartsNewChats: false,
  defaultShowPlanBeforeLongTasks: false,
  defaultSteerMode: 'fila',
  customTheme: '',
  gitContext: true,
  autoUpdate: false,
  updateFeedUrl: '',
  defaultProvider: '',
  providersSetupDone: false,
}

export interface AgentCapabilities {
  localScripts: boolean
  startsNewChats: boolean
  showPlanBeforeLongTasks: boolean
  steerMode: SteerMode
  computerUse: boolean
}

/** Capacidade efetiva do robô: override dele vence o padrão do computador. */
export function effectiveCapabilities(
  agent: {
    localScripts?: boolean
    startsNewChats?: boolean
    showPlanBeforeLongTasks?: boolean
    steerMode?: SteerMode
    computerUse?: boolean
  },
  settings: AppSettings,
): AgentCapabilities {
  return {
    localScripts: agent.localScripts ?? settings.defaultLocalScripts,
    startsNewChats: agent.startsNewChats ?? settings.defaultStartsNewChats,
    showPlanBeforeLongTasks:
      agent.showPlanBeforeLongTasks ?? settings.defaultShowPlanBeforeLongTasks,
    steerMode: agent.steerMode ?? settings.defaultSteerMode,
    computerUse: agent.computerUse ?? settings.computerUseEnabled,
  }
}

export interface ComputerUseStatus {
  ready: boolean
  partial: boolean
  platform: string
  sessionType: string
  screenshotTool: string | null
  windowTool: string | null
  inputTool: string | null
  missing: string[]
  message: string
}

export interface Project {
  id: string
  name: string
  description?: string
  /** Pasta do projeto no disco; robôs do projeto herdam como workspace padrão. */
  workspacePath?: string
  createdAt: string
  updatedAt: string
}

export type BrainPageType = 'company' | 'product' | 'note'

/** Página do wiki compartilhado de um projeto. Fato da empresa mora aqui, não na memória do robô. */
export interface BrainPage {
  id: string
  projectId: string
  slug: string
  title: string
  type: BrainPageType
  content: string
  /** Títulos de seção marcados com `<!-- não confirmado -->`. */
  unconfirmed: string[]
  updatedAt: string
}

export interface SaveBrainPageInput {
  projectId: string
  slug?: string
  title: string
  type?: BrainPageType
  content: string
  /** false recusa se o slug já existe. O líder e o aceite de proposta substituem a página. */
  replace?: boolean
}

export interface BrainProposal {
  id: string
  projectId: string
  agentId?: string
  slug: string
  title: string
  type: BrainPageType
  content: string
  reason: string
  source: string
  unconfirmed: string[]
  status: 'open' | 'accepted' | 'dismissed'
  createdAt: string
  decidedAt?: string
}

export interface CreateProjectInput {
  name: string
  description?: string
  workspacePath?: string
  /** Cria a pasta no disco (mkdir -p) quando workspacePath é informado. */
  createFolder?: boolean
}

export interface UpdateProjectInput {
  id: string
  name?: string
  description?: string
  workspacePath?: string
}

export interface Agent {
  id: string
  name: string
  role?: AgentRole
  /** Descrição curta: o que este robô faz. */
  description?: string
  /** Projeto (pasta) ao qual o robô pertence; ausente = sem projeto. */
  projectId?: string
  /** Coordenador fixo do app. Ausente nos colegas. */
  systemRole?: 'foreman'
  provider: SupportedProvider
  accountId?: string
  model: string
  /** Esforço deste robô; ausente = usa o esforço padrão do provedor. */
  effort?: ProviderEffort
  instructions: string
  workspacePath: string
  avatar?: string
  autonomyLevel?: AutonomyLevel
  contextMode?: ContextMode
  /** Pode abrir/inspecionar o navegador embutido durante os turnos. */
  browserAccess?: boolean
  /** Overrides de capacidade (ausente = segue o padrão do computador). */
  localScripts?: boolean
  startsNewChats?: boolean
  showPlanBeforeLongTasks?: boolean
  steerMode?: SteerMode
  computerUse?: boolean
  /** Cadeia: ao terminar um pedido, o resultado segue para este robô. */
  handoffAgentId?: string
  createdAt: string
  updatedAt: string
}

export interface CreateAgentInput {
  name: string
  avatar?: string
  role?: AgentRole
  description?: string
  projectId?: string
  provider: SupportedProvider
  accountId?: string
  model: string
  effort?: ProviderEffort
  instructions?: string
  workspacePath: string
  autonomyLevel?: AutonomyLevel
  contextMode?: ContextMode
  browserAccess?: boolean
  localScripts?: boolean
  startsNewChats?: boolean
  showPlanBeforeLongTasks?: boolean
  steerMode?: SteerMode
  computerUse?: boolean
}

export interface UpdateAgentInput {
  id: string
  avatar?: string | null
  name?: string
  role?: AgentRole
  description?: string
  projectId?: string | null
  provider?: SupportedProvider
  accountId?: string | null
  model?: string
  effort?: ProviderEffort | null
  instructions?: string
  workspacePath?: string
  autonomyLevel?: AutonomyLevel
  contextMode?: ContextMode
  browserAccess?: boolean
  localScripts?: boolean | null
  startsNewChats?: boolean | null
  showPlanBeforeLongTasks?: boolean | null
  steerMode?: SteerMode | null
  computerUse?: boolean | null
  handoffAgentId?: string | null
}

export interface Thread {
  id: string
  agentId: string
  title: string
  /** Pasta desta conversa. O coordenador usa isso para o cérebro e a equipe. */
  projectId?: string
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
  /** Rodadas de navegador nesta cadeia. Memória e computador não entram aqui. */
  browserRounds?: number
  /** Rodadas de computador nesta cadeia. */
  computerRounds?: number
  /** Rodadas de memória, skills, cérebro e agentes nesta cadeia. */
  memoryRounds?: number
  /** Conversa do orquestrador que originou esta tarefa delegada (retorno do resultado). */
  originThreadId?: string
  originAgentId?: string
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

export interface ProviderUpdateInfo {
  providerId: SupportedProvider
  installedVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  updateCommand: string | null
  checkedAt: string
  error?: string
}

export interface ProfileDayActivity {
  date: string
  messages: number
  tokens: number
}

export interface ProfileStats {
  totalTokens: number
  /** Parte de totalTokens informada pelas CLIs (o resto é estimado por caracteres). */
  measuredTokens: number
  totalMessages: number
  recordDay: { date: string; tokens: number } | null
  currentStreakDays: number
  longestStreak: { days: number; endDate: string } | null
  activeDaysLastYear: number
  daily: ProfileDayActivity[]
  topProvider: { provider: string; name: string; percent: number } | null
  topModel: { model: string; percent: number } | null
  topWeekday: string | null
  estimatedCostUsd: number
  topAgents: Array<{ agentId: string; name: string; tokens: number; messages: number }>
  modelUsage: Array<{ model: string; tokens: number; percent: number }>
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
  readiness?: ProviderReadiness
  loginHint?: string
  authStatus?: ProviderAuthStatus
  installHint?: string
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
  getComputerUseStatus: () => Promise<ComputerUseStatus>
  getProviderUpdates: () => Promise<ProviderUpdateInfo[]>
  runProviderUpdate: (
    providerId: SupportedProvider,
  ) => Promise<{ success: boolean; message: string }>
  getProfileStats: () => Promise<ProfileStats>
  getSettings: () => Promise<AppSettings>
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  getProjects: () => Promise<Project[]>
  createProject: (input: CreateProjectInput) => Promise<Project>
  updateProject: (input: UpdateProjectInput) => Promise<Project>
  deleteProject: (id: string) => Promise<boolean>
  getAgents: () => Promise<Agent[]>
  getAgent: (id: string) => Promise<Agent | null>
  createAgent: (input: CreateAgentInput) => Promise<Agent>
  updateAgent: (input: UpdateAgentInput) => Promise<Agent>
  deleteAgent: (id: string) => Promise<boolean>
  getThreads: (agentId: string) => Promise<Thread[]>
  createThread: (agentId: string, title?: string, projectId?: string) => Promise<Thread>
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
  resetProviderSession: (threadId: string) => Promise<boolean>
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
  createCustomProvider: (input: CreateCustomProviderInput) => Promise<ProviderConnection>
  deleteCustomProvider: (providerId: CustomProviderId) => Promise<boolean>
  getProviderAccounts: (providerId: SupportedProvider) => Promise<ProviderAccount[]>
  createProviderAccount: (input: CreateProviderAccountInput) => Promise<ProviderAccount>
  updateProviderAccount: (input: UpdateProviderAccountInput) => Promise<ProviderAccount>
  deleteProviderAccount: (providerId: SupportedProvider, id: string) => Promise<boolean>
  testProviderAccount: (
    providerId: SupportedProvider,
    id: string,
  ) => Promise<{ success: boolean; message: string; status?: ProviderInfo }>
  listConnections: () => Promise<ProviderConnection[]>
  getConnections: () => Promise<ProviderConnection[]>
  getProviderCatalog: () => Promise<ProviderCatalogEntry[]>
  updateConnection: (input: UpdateConnectionInput) => Promise<ProviderConnection>
  testConnection: (
    providerId: SupportedProvider,
  ) => Promise<{ success: boolean; message: string; status?: ProviderInfo }>
  discoverModels: (
    providerId: SupportedProvider,
    accountId?: string,
  ) => Promise<{
    models: string[]
    catalog?: ProviderModelInfo[]
    source: 'cli' | 'cache' | 'catalog' | 'api'
    message: string
  }>
  searchProjectMemory: (agentId: string, query: string) => Promise<SearchResultGroup>
  getConsent: () => Promise<{ accepted: boolean; version: number }>
  acceptConsent: () => Promise<boolean>
  declineConsent: () => Promise<void>
  exportDiagnostics: () => Promise<string | null>
  detectLocalRuntimes: () => Promise<LocalRuntime[]>
  addLocalRuntime: (id: LocalRuntime['id'], model: string) => Promise<ProviderConnection>
  listThemes: () => Promise<ThemeFileInfo[]>
  openThemesFolder: () => Promise<string>
  onThemesChanged: (listener: (themes: ThemeFileInfo[]) => void) => () => void
  getManagedClis: () => Promise<ManagedCliInfo[]>
  installManagedCli: (
    providerId: SupportedProvider,
    version?: string,
    pin?: boolean,
  ) => Promise<ManagedCliInfo>
  setManagedCliPin: (providerId: SupportedProvider, pinned: boolean) => Promise<ManagedCliInfo>
  removeManagedCli: (providerId: SupportedProvider) => Promise<ManagedCliInfo>
  getAppUpdate: () => Promise<AppUpdateStatus>
  checkAppUpdate: () => Promise<AppUpdateStatus>
  installAppUpdate: () => Promise<void>
  onAppUpdate: (listener: (status: AppUpdateStatus) => void) => () => void
  onDeepLink: (listener: (link: DeepLink) => void) => () => void
  listSkills: () => Promise<SkillInfo[]>
  getSkill: (slug: string) => Promise<SkillDetail>
  saveSkill: (input: {
    slug?: string
    name: string
    description: string
    body: string
  }) => Promise<SkillInfo>
  removeSkill: (slug: string) => Promise<boolean>
  installSkillFolder: () => Promise<SkillInfo | null>
  getSkillCatalog: () => Promise<SkillCatalogEntry[]>
  installBundledSkill: (slug: string) => Promise<SkillInfo>
  listSkillProposals: () => Promise<SkillProposal[]>
  decideSkillProposal: (id: string, accept: boolean) => Promise<SkillProposal>
  getAgentSkills: (agentId: string) => Promise<string[]>
  setAgentSkills: (agentId: string, slugs: string[]) => Promise<string[]>
  listMcpServers: () => Promise<McpServerInfo[]>
  saveMcpServer: (input: SaveMcpServerInput) => Promise<McpServerInfo>
  removeMcpServer: (id: string) => Promise<boolean>
  getMcpPresets: () => Promise<McpPreset[]>
  getAgentMcp: (agentId: string) => Promise<string[]>
  setAgentMcp: (agentId: string, serverIds: string[]) => Promise<string[]>
  draftAgent: (prompt: string, baseAgentId?: string) => Promise<AgentDraft>
  listChannels: (includeArchived?: boolean) => Promise<Channel[]>
  getChannelMessages: (channelId: string) => Promise<ChannelMessage[]>
  createChannel: (input: CreateChannelInput) => Promise<Channel>
  postChannelMessage: (channelId: string, text: string) => Promise<Channel>
  controlChannel: (
    channelId: string,
    action: 'stop' | 'resume' | 'archive' | 'restore' | 'reassign',
    agentId?: string,
  ) => Promise<Channel>
  listMemories: (agentId: string) => Promise<AgentMemory[]>
  addMemory: (agentId: string, text: string) => Promise<AgentMemory>
  deleteMemory: (agentId: string, id: string) => Promise<boolean>
  listBrainPages: (projectId: string) => Promise<BrainPage[]>
  saveBrainPage: (input: SaveBrainPageInput) => Promise<BrainPage>
  deleteBrainPage: (projectId: string, slug: string) => Promise<boolean>
  listBrainProposals: (projectId: string) => Promise<BrainProposal[]>
  decideBrainProposal: (id: string, accept: boolean) => Promise<BrainProposal>
  getContextUsage: (
    agentId: string,
    threadId: string,
  ) => Promise<{ tokens: number; window: number; compacted: boolean; measured: boolean }>
  getWorkspaceRules: (agentId: string) => Promise<WorkspaceRulesInfo>
  indexWorkspace: (agentId: string) => Promise<{ indexedCount: number }>
  getScheduledTasks: (agentId?: string) => Promise<ScheduledTask[]>
  createScheduledTask: (input: CreateScheduledTaskInput) => Promise<ScheduledTask>
  updateScheduledTask: (input: UpdateScheduledTaskInput) => Promise<ScheduledTask>
  deleteScheduledTask: (id: string) => Promise<boolean>
  runScheduledTaskNow: (id: string) => Promise<boolean>
  onScheduledTaskTriggered: (listener: (task: ScheduledTask) => void) => () => void
  draftTeam: (prompt: string) => Promise<AgentDraft[]>
  listApprovals: () => Promise<Approval[]>
  decideApproval: (id: string, approved: boolean, note?: string) => Promise<Approval>
  listWebhookTriggers: (agentId: string) => Promise<WebhookTrigger[]>
  createWebhookTrigger: (
    agentId: string,
    title: string,
    instruction: string,
  ) => Promise<WebhookTrigger>
  deleteWebhookTrigger: (id: string) => Promise<boolean>
  /** Endereço local do servidor de webhooks; null se ele não conseguiu abrir a porta. */
  getWebhookBaseUrl: () => Promise<string | null>
}

export type ApprovalStatus = 'pending' | 'approved' | 'declined'

/** Pedido do robô para fazer algo que mexe no mundo real (enviar, pagar, apagar). */
export interface Approval {
  id: string
  agentId: string
  threadId: string
  taskId?: string
  text: string
  status: ApprovalStatus
  note?: string
  /** Ações do runtime seguradas no modo cauteloso. Ausente no pedido [[APROVAR]] só de texto. */
  payloadJson?: string
  createdAt: string
  decidedAt?: string
}

/** URL local que dispara um robô; o token na URL é a credencial. */
export interface WebhookTrigger {
  id: string
  agentId: string
  title: string
  instruction: string
  token: string
  createdAt: string
}

export type ChannelStatus = 'active' | 'stopped'

export interface ChannelMember {
  agentId: string
  threadId: string
}

export interface Channel {
  id: string
  title: string
  goal: string
  /** Dono da tarefa: recebe o usuário, coordena e entrega o resultado. */
  ownerAgentId: string | null
  status: ChannelStatus
  archived: boolean
  projectId?: string
  members: ChannelMember[]
  createdAt: string
  updatedAt: string
}

/** authorAgentId nulo = usuário; 'system' = aviso do canal. */
export interface ChannelMessage {
  id: string
  channelId: string
  authorAgentId: string | null
  kind: 'message' | 'system'
  text: string
  createdAt: string
}

export interface CreateChannelInput {
  title: string
  goal?: string
  ownerAgentId: string
  memberIds?: string[]
}

export interface AgentDraft {
  name: string
  description: string
  role: AgentRole
  avatar: string
  instructions: string
  /** 'model' = gerado pelo provedor do usuário; 'local' = heurística offline. */
  source: 'model' | 'local'
}

export interface AgentReaction {
  messageId: string
  agentId: string
  emoji: string
}

export interface LocalRuntime {
  id: 'ollama' | 'lmstudio'
  name: string
  endpoint: string
  models: string[]
  /** Já existe um provedor customizado apontando para este endereço. */
  configured: boolean
}

export interface ThemeFileInfo {
  /** Identificador estável: "arquivo.json" ou "omarchy:<pasta>". */
  id: string
  name: string
  mode: 'dark' | 'light'
  source: 'file' | 'omarchy'
  vars: Record<string, string>
}

export interface ManagedCliInfo {
  providerId: SupportedProvider
  installed: boolean
  version?: string
  pinned: boolean
  binPath?: string
  /** Pacote npm gerenciável; ausente = o app não instala este CLI. */
  npmPackage?: string
  /** Comando do próprio CLI para atualizar (ex.: `grok update`). */
  selfUpdate: boolean
}

export interface AppUpdateStatus {
  state: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  version?: string
  message: string
}

export type DeepLink =
  | { kind: 'agent'; id: string }
  | { kind: 'channel'; id: string }
  | { kind: 'section'; name: 'channels' | 'skills' | 'connections' | 'agents' }
  | { kind: 'new-agent' }

export type McpTransport = 'stdio' | 'http'

/** O que a interface vê de um servidor MCP: nomes das variáveis, nunca os valores. */
export interface McpServerInfo {
  id: string
  name: string
  transport: McpTransport
  command?: string
  args: string[]
  url?: string
  envKeys: string[]
  hasBearer: boolean
}

export interface SaveMcpServerInput {
  id?: string
  name: string
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  /** Valor vazio em chave já existente = manter o segredo atual; chaves ausentes são removidas. */
  env?: Record<string, string>
  /** undefined = manter; null = remover; texto = definir. */
  bearerToken?: string | null
}

export interface McpPreset {
  id: string
  name: string
  description: string
  transport: McpTransport
  command?: string
  args: string[]
  url?: string
  envKeys: string[]
  /** Observação mostrada antes de instalar (pré-requisitos, argumentos a ajustar). */
  note: string
}

export type SkillSource = 'user' | 'agent' | 'bundled' | 'installed'

export interface SkillProposal {
  id: string
  agentId: string
  slug: string
  name: string
  description: string
  body: string
  status: 'open' | 'accepted' | 'dismissed'
  createdAt: string
  decidedAt?: string
}

export interface SkillInfo {
  slug: string
  name: string
  description: string
  version: number
  source: SkillSource
  updatedAt: string
  /** Agente que criou a skill, quando source = 'agent'. */
  createdBy?: string
}

export interface SkillDetail extends SkillInfo {
  body: string
}

export interface SkillCatalogEntry {
  slug: string
  name: string
  description: string
  installed: boolean
}

/** Preferência permanece meses na busca; tarefa, dias. */
export type MemoryKind = 'preference' | 'task'

export interface AgentMemory {
  id: string
  agentId: string
  text: string
  kind: MemoryKind
  createdAt: string
  /** Atualizado quando o texto muda. A busca usa esta data para o decaimento. */
  touchedAt: string
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

/** Avatar é um emoji curto (até 4 pontos de código); qualquer outra coisa vira vazio. */
export function normalizeAvatar(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  return v && [...v].length <= 4 ? v : undefined
}

export function validateCreateAgentInput(
  raw: unknown,
  providerIds: readonly SupportedProvider[] = SUPPORTED_PROVIDERS,
): CreateAgentInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Entrada inválida para criação de agente')
  }

  const {
    name,
    provider,
    model,
    instructions,
    workspacePath,
    description,
    projectId,
    effort,
    role,
    contextMode,
    browserAccess,
  } = raw as Record<string, unknown>

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('O nome do agente é obrigatório')
  }

  if (typeof provider !== 'string' || !providerIds.includes(provider as SupportedProvider)) {
    throw new Error(`Provedor inválido (suportados: ${SUPPORTED_PROVIDERS.join(', ')})`)
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
    role: role === 'orchestrator' ? 'orchestrator' : 'worker',
    description: typeof description === 'string' ? description.trim() : undefined,
    projectId:
      typeof projectId === 'string' && projectId.trim().length > 0 ? projectId.trim() : undefined,
    provider: provider as SupportedProvider,
    model: model.trim(),
    effort: isProviderEffort(effort) ? (effort as ProviderEffort) : undefined,
    instructions: typeof instructions === 'string' ? instructions.trim() : '',
    workspacePath: workspacePath.trim(),
    contextMode: contextMode === 'economico' || contextMode === 'completo' ? contextMode : 'padrao',
    browserAccess: browserAccess !== false,
    avatar: normalizeAvatar((raw as Record<string, unknown>).avatar),
  }
  const accountId = (raw as Record<string, unknown>).accountId
  if (accountId !== undefined) {
    if (typeof accountId !== 'string' || !accountId.trim())
      throw new Error('Conta do provedor inválida.')
    result.accountId = accountId
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
