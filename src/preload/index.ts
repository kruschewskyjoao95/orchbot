import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  AppUpdateStatus,
  BrowserBounds,
  BrowserTab,
  CreateAgentInput,
  CreateChannelInput,
  CreateCustomProviderInput,
  CreateProjectInput,
  CreateProviderAccountInput,
  CreateScheduledTaskInput,
  CustomProviderId,
  DeepLink,
  DelegationInput,
  OrchbotApi,
  SaveBrainPageInput,
  SaveMcpServerInput,
  ScheduledTask,
  StreamChunkEvent,
  SupportedProvider,
  TaskStatusChangedEvent,
  ThemeFileInfo,
  TurnErrorEvent,
  TurnFinishedEvent,
  UpdateAgentInput,
  UpdateConnectionInput,
  UpdateProjectInput,
  UpdateProviderAccountInput,
  UpdateScheduledTaskInput,
} from '../shared/types'

const api: OrchbotApi = {
  getComputerUseStatus: () => ipcRenderer.invoke('orchbot:get-computer-use-status'),
  getProviderUpdates: () => ipcRenderer.invoke('orchbot:get-provider-updates'),
  runProviderUpdate: (providerId: SupportedProvider) =>
    ipcRenderer.invoke('orchbot:run-provider-update', providerId),
  getProfileStats: () => ipcRenderer.invoke('orchbot:get-profile-stats'),
  getSettings: () => ipcRenderer.invoke('orchbot:get-settings'),
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke('orchbot:update-settings', patch),
  getProjects: () => ipcRenderer.invoke('orchbot:get-projects'),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke('orchbot:create-project', input),
  updateProject: (input: UpdateProjectInput) => ipcRenderer.invoke('orchbot:update-project', input),
  deleteProject: (id: string) => ipcRenderer.invoke('orchbot:delete-project', id),
  getAgents: () => ipcRenderer.invoke('orchbot:get-agents'),
  getAgent: (id: string) => ipcRenderer.invoke('orchbot:get-agent', id),
  createAgent: (input: CreateAgentInput) => ipcRenderer.invoke('orchbot:create-agent', input),
  updateAgent: (input: UpdateAgentInput) => ipcRenderer.invoke('orchbot:update-agent', input),
  deleteAgent: (id: string) => ipcRenderer.invoke('orchbot:delete-agent', id),
  getThreads: (agentId: string) => ipcRenderer.invoke('orchbot:get-threads', agentId),
  createThread: (agentId: string, title?: string, projectId?: string) =>
    ipcRenderer.invoke('orchbot:create-thread', { agentId, title, projectId }),
  deleteThread: (threadId: string) => ipcRenderer.invoke('orchbot:delete-thread', threadId),
  updateThreadTitle: (threadId: string, title: string) =>
    ipcRenderer.invoke('orchbot:update-thread-title', { threadId, title }),
  getMessages: (threadId: string) => ipcRenderer.invoke('orchbot:get-messages', threadId),
  getSystemStatus: () => ipcRenderer.invoke('orchbot:get-system-status'),
  getProviderStatus: () => ipcRenderer.invoke('orchbot:get-provider-status'),
  sendMessage: (threadId: string, text: string, attachmentFilePaths?: string[]) =>
    ipcRenderer.invoke('orchbot:send-message', { threadId, text, attachmentFilePaths }),
  interruptTurn: (threadId: string) => ipcRenderer.invoke('orchbot:interrupt-turn', threadId),
  resetProviderSession: (threadId: string) =>
    ipcRenderer.invoke('orchbot:reset-provider-session', threadId),

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

  createCustomProvider: (input: CreateCustomProviderInput) =>
    ipcRenderer.invoke('orchbot:create-custom-provider', input),
  deleteCustomProvider: (providerId: CustomProviderId) =>
    ipcRenderer.invoke('orchbot:delete-custom-provider', providerId),
  getProviderAccounts: (providerId: SupportedProvider) =>
    ipcRenderer.invoke('orchbot:get-provider-accounts', providerId),
  createProviderAccount: (input: CreateProviderAccountInput) =>
    ipcRenderer.invoke('orchbot:create-provider-account', input),
  updateProviderAccount: (input: UpdateProviderAccountInput) =>
    ipcRenderer.invoke('orchbot:update-provider-account', input),
  deleteProviderAccount: (providerId: SupportedProvider, id: string) =>
    ipcRenderer.invoke('orchbot:delete-provider-account', providerId, id),
  testProviderAccount: (providerId: SupportedProvider, id: string) =>
    ipcRenderer.invoke('orchbot:test-provider-account', providerId, id),
  listConnections: () => ipcRenderer.invoke('orchbot:list-connections'),
  getConnections: () => ipcRenderer.invoke('orchbot:get-connections'),
  getProviderCatalog: () => ipcRenderer.invoke('orchbot:get-provider-catalog'),
  updateConnection: (input: UpdateConnectionInput) =>
    ipcRenderer.invoke('orchbot:update-connection', input),
  testConnection: (providerId: SupportedProvider) =>
    ipcRenderer.invoke('orchbot:test-connection', providerId),
  discoverModels: (providerId: SupportedProvider, accountId?: string) =>
    ipcRenderer.invoke('orchbot:discover-models', providerId, accountId),
  searchProjectMemory: (agentId: string, query: string) =>
    ipcRenderer.invoke('orchbot:search-project-memory', { agentId, query }),
  getConsent: () => ipcRenderer.invoke('orchbot:get-consent'),
  acceptConsent: () => ipcRenderer.invoke('orchbot:accept-consent'),
  declineConsent: () => ipcRenderer.invoke('orchbot:decline-consent'),
  exportDiagnostics: () => ipcRenderer.invoke('orchbot:export-diagnostics'),
  detectLocalRuntimes: () => ipcRenderer.invoke('orchbot:detect-local-runtimes'),
  addLocalRuntime: (id: string, model: string) =>
    ipcRenderer.invoke('orchbot:add-local-runtime', { id, model }),
  listThemes: () => ipcRenderer.invoke('orchbot:list-themes'),
  openThemesFolder: () => ipcRenderer.invoke('orchbot:open-themes-folder'),
  onThemesChanged: (listener: (themes: ThemeFileInfo[]) => void) => {
    const handler = (_e: unknown, themes: ThemeFileInfo[]) => listener(themes)
    ipcRenderer.on('orchbot:themes-changed', handler)
    return () => ipcRenderer.removeListener('orchbot:themes-changed', handler)
  },
  getManagedClis: () => ipcRenderer.invoke('orchbot:get-managed-clis'),
  installManagedCli: (providerId: string, version?: string, pin?: boolean) =>
    ipcRenderer.invoke('orchbot:install-managed-cli', { providerId, version, pin }),
  setManagedCliPin: (providerId: string, pinned: boolean) =>
    ipcRenderer.invoke('orchbot:set-managed-cli-pin', { providerId, pinned }),
  removeManagedCli: (providerId: string) =>
    ipcRenderer.invoke('orchbot:remove-managed-cli', providerId),
  getAppUpdate: () => ipcRenderer.invoke('orchbot:get-app-update'),
  checkAppUpdate: () => ipcRenderer.invoke('orchbot:check-app-update'),
  installAppUpdate: () => ipcRenderer.invoke('orchbot:install-app-update'),
  onAppUpdate: (listener: (status: AppUpdateStatus) => void) => {
    const handler = (_e: unknown, status: AppUpdateStatus) => listener(status)
    ipcRenderer.on('orchbot:app-update', handler)
    return () => ipcRenderer.removeListener('orchbot:app-update', handler)
  },
  onDeepLink: (listener: (link: DeepLink) => void) => {
    const handler = (_e: unknown, link: DeepLink) => listener(link)
    ipcRenderer.on('orchbot:deep-link', handler)
    // Link recebido antes do renderer existir (app aberto pelo orchbot://).
    void ipcRenderer.invoke('orchbot:pending-link').then((link: DeepLink | null) => {
      if (link) listener(link)
    })
    return () => ipcRenderer.removeListener('orchbot:deep-link', handler)
  },
  listSkills: () => ipcRenderer.invoke('orchbot:skills-list'),
  getSkill: (slug: string) => ipcRenderer.invoke('orchbot:skills-get', slug),
  saveSkill: (input: { slug?: string; name: string; description: string; body: string }) =>
    ipcRenderer.invoke('orchbot:skills-save', input),
  removeSkill: (slug: string) => ipcRenderer.invoke('orchbot:skills-remove', slug),
  installSkillFolder: () => ipcRenderer.invoke('orchbot:skills-install-folder'),
  getSkillCatalog: () => ipcRenderer.invoke('orchbot:skills-catalog'),
  installBundledSkill: (slug: string) => ipcRenderer.invoke('orchbot:skills-install-bundled', slug),
  listSkillProposals: () => ipcRenderer.invoke('orchbot:skill-proposals'),
  decideSkillProposal: (id: string, accept: boolean) =>
    ipcRenderer.invoke('orchbot:skill-decide', { id, accept }),
  getAgentSkills: (agentId: string) => ipcRenderer.invoke('orchbot:agent-skills-get', agentId),
  setAgentSkills: (agentId: string, slugs: string[]) =>
    ipcRenderer.invoke('orchbot:agent-skills-set', { agentId, slugs }),
  listMcpServers: () => ipcRenderer.invoke('orchbot:mcp-list'),
  saveMcpServer: (input: SaveMcpServerInput) => ipcRenderer.invoke('orchbot:mcp-save', input),
  removeMcpServer: (id: string) => ipcRenderer.invoke('orchbot:mcp-remove', id),
  getMcpPresets: () => ipcRenderer.invoke('orchbot:mcp-presets'),
  getAgentMcp: (agentId: string) => ipcRenderer.invoke('orchbot:agent-mcp-get', agentId),
  setAgentMcp: (agentId: string, ids: string[]) =>
    ipcRenderer.invoke('orchbot:agent-mcp-set', { agentId, ids }),
  draftAgent: (prompt: string, baseAgentId?: string) =>
    ipcRenderer.invoke('orchbot:draft-agent', { prompt, baseAgentId }),
  listChannels: (includeArchived?: boolean) =>
    ipcRenderer.invoke('orchbot:channel-list', Boolean(includeArchived)),
  getChannelMessages: (channelId: string) =>
    ipcRenderer.invoke('orchbot:channel-messages', channelId),
  createChannel: (input: CreateChannelInput) => ipcRenderer.invoke('orchbot:channel-create', input),
  postChannelMessage: (channelId: string, text: string) =>
    ipcRenderer.invoke('orchbot:channel-post', { channelId, text }),
  controlChannel: (channelId: string, action: string, agentId?: string) =>
    ipcRenderer.invoke('orchbot:channel-control', { channelId, action, agentId }),
  listMemories: (agentId: string) => ipcRenderer.invoke('orchbot:memory-list', agentId),
  addMemory: (agentId: string, text: string) =>
    ipcRenderer.invoke('orchbot:memory-add', { agentId, text }),
  deleteMemory: (agentId: string, id: string) =>
    ipcRenderer.invoke('orchbot:memory-delete', { agentId, id }),
  listBrainPages: (projectId: string) => ipcRenderer.invoke('orchbot:brain-pages', projectId),
  saveBrainPage: (input: SaveBrainPageInput) => ipcRenderer.invoke('orchbot:brain-save', input),
  deleteBrainPage: (projectId: string, slug: string) =>
    ipcRenderer.invoke('orchbot:brain-delete', { projectId, slug }),
  listBrainProposals: (projectId: string) =>
    ipcRenderer.invoke('orchbot:brain-proposals', projectId),
  decideBrainProposal: (id: string, accept: boolean) =>
    ipcRenderer.invoke('orchbot:brain-decide', { id, accept }),
  getContextUsage: (agentId: string, threadId: string) =>
    ipcRenderer.invoke('orchbot:context-usage', { agentId, threadId }),
  getWorkspaceRules: (agentId: string) =>
    ipcRenderer.invoke('orchbot:get-workspace-rules', agentId),
  indexWorkspace: (agentId: string) => ipcRenderer.invoke('orchbot:index-workspace', agentId),
  draftTeam: (prompt: string) => ipcRenderer.invoke('orchbot:draft-team', prompt),
  listApprovals: () => ipcRenderer.invoke('orchbot:list-approvals'),
  decideApproval: (id: string, approved: boolean, note?: string) =>
    ipcRenderer.invoke('orchbot:decide-approval', { id, approved, note }),
  listWebhookTriggers: (agentId: string) =>
    ipcRenderer.invoke('orchbot:list-webhook-triggers', agentId),
  createWebhookTrigger: (agentId: string, title: string, instruction: string) =>
    ipcRenderer.invoke('orchbot:create-webhook-trigger', { agentId, title, instruction }),
  deleteWebhookTrigger: (id: string) => ipcRenderer.invoke('orchbot:delete-webhook-trigger', id),
  getWebhookBaseUrl: () => ipcRenderer.invoke('orchbot:webhook-base-url'),
  getScheduledTasks: (agentId?: string) =>
    ipcRenderer.invoke('orchbot:get-scheduled-tasks', agentId),
  createScheduledTask: (input: CreateScheduledTaskInput) =>
    ipcRenderer.invoke('orchbot:create-scheduled-task', input),
  updateScheduledTask: (input: UpdateScheduledTaskInput) =>
    ipcRenderer.invoke('orchbot:update-scheduled-task', input),
  deleteScheduledTask: (id: string) => ipcRenderer.invoke('orchbot:delete-scheduled-task', id),
  runScheduledTaskNow: (id: string) => ipcRenderer.invoke('orchbot:run-scheduled-task-now', id),
  onScheduledTaskTriggered: (listener: (task: ScheduledTask) => void) => {
    const handler = (_event: unknown, task: ScheduledTask) => listener(task)
    ipcRenderer.on('orchbot:scheduled-task-triggered', handler)
    return () => {
      ipcRenderer.removeListener('orchbot:scheduled-task-triggered', handler)
    }
  },
}

contextBridge.exposeInMainWorld('orchbot', api)
