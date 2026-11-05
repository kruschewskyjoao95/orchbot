import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js'
import { describeCron } from '../../backend/cron/cron-parser'
import { isForeman } from '../../backend/orchestration/foreman'
import { CUSTOM_PROVIDER_PRESETS, isCustomProvider } from '../../shared/custom-providers'
import { modelEffortOptions } from '../../shared/model-efforts'
import { principalConnection, providerStatusLabel } from '../../shared/provider-status'
import type {
  Agent,
  AgentDraft,
  AgentMemory,
  AgentRole,
  AppSettings,
  Approval,
  AutonomyLevel,
  BrowserPageContent,
  BrowserTab,
  Channel,
  ComputerUseStatus,
  ContextMode,
  Message,
  ProfileStats,
  Project,
  ProviderAccount,
  ProviderConnection,
  ProviderEffort,
  ProviderInfo,
  ProviderModelInfo,
  ProviderUpdateInfo,
  ScheduledTask,
  ScheduledTaskType,
  SearchResultGroup,
  SelectedFile,
  SupportedProvider,
  SystemStatus,
  TaskQueueItem,
  Thread,
  WebhookTrigger,
  WorkspaceRulesInfo,
} from '../../shared/types'
import {
  DEFAULT_APP_SETTINGS,
  MAX_AGENT_INSTRUCTIONS,
  effectiveCapabilities,
} from '../../shared/types'
import { BrainPanel } from './Brain'
import { Channels } from './Channels'
import {
  ConsentGate,
  DistributionSettings,
  LocalRuntimes,
  ManagedCliControls,
  ThemeApplier,
} from './Distribution'
import { MessageText } from './MessageText'
import { MiniBrowser } from './MiniBrowser'
import { ModelPicker } from './ModelPicker'
import { ProviderAccounts } from './ProviderAccounts'
import { SkillsPlugins } from './SkillsPlugins'
import {
  AGENT_STATE_LABEL,
  type AgentState,
  needsYou,
  stateFromQueue,
  stateFromTask,
} from './agent-state'
import { focusDialog } from './dialog-focus'
import {
  COWORKER_TEMPLATES,
  type CoworkerTemplate,
  type PaletteItem,
  type StarterTeamPreset,
  buildCommandPaletteItems,
  computeBoardSummary,
  filterPaletteItems,
  getActiveTaskForAgent,
  parseComposerInput,
  parseStructuredMessage,
  safeSnippetHtml,
  templateInstructions,
} from './orchestration-ui'

export const DEFAULT_PROVIDER_MODELS: Record<SupportedProvider, string> = {
  codex: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
  grok: 'grok-4.7',
  gemini: 'gemini-3.8-flash',
  muse: 'muse-spark-1.3',
  antigravity: 'gemini-3.8-flash',
  opencode: 'opencode-go/muse-spark-1.3-contributor',
  copilot: 'auto',
  pi: 'claude-sonnet-5-5',
  kimi: 'kimi-k2',
  acp: 'auto',
}

const BOARD_SUGGESTIONS = [
  {
    title: 'Planejar um projeto',
    desc: 'Plano passo a passo e primeira etapa',
    prompt: 'Crie um plano simples passo a passo para o meu projeto e comece a primeira etapa.',
  },
  {
    title: 'Entender meu projeto',
    desc: 'Explicar os arquivos da pasta',
    prompt:
      'Analise os arquivos desta pasta, explique de forma simples como tudo funciona e sugira melhorias.',
  },
  {
    title: 'Pesquisar um assunto',
    desc: 'Resumo claro em tópicos',
    prompt: 'Pesquise informações atualizadas sobre este tema e monte um resumo claro em tópicos.',
  },
]

const LOGO_COLORS = [
  '#e7a3a8',
  '#e0a36a',
  '#e6d36a',
  '#8fce8a',
  '#7eb0e8',
  '#b7a4e8',
  '#e7a8c4',
  '#e6d2c4',
  '#b0b0b6',
  '#f4f4f5',
]

const AGENT_COLORS = ['#e0a36a', '#7eb0e8', '#b7a4e8', '#e6d36a', '#e7a8c4', '#8fce8a']

const agentColor = (name: string) => {
  let hash = 0
  for (let i = 0; i < name.length; i++)
    hash = (hash + name.charCodeAt(i) * (i + 1)) % AGENT_COLORS.length
  return AGENT_COLORS[hash] ?? '#7eb0e8'
}

type SettingsPaneId = 'geral' | 'provedores' | 'agents' | 'perfil' | 'computer' | 'permissoes'

const SETTINGS_PANES: { id: SettingsPaneId; label: string; hint: string }[] = [
  {
    id: 'geral',
    label: 'Geral',
    hint: 'aparência tema idioma tamanho logotipo conversas atalho etapas links comportamento iniciar conexão segundo plano restaurar',
  },
  {
    id: 'provedores',
    label: 'Provedores',
    hint: 'conexões provedores ia contas login instalar cli api chave modelos endpoint ollama lm studio atualização',
  },
  {
    id: 'agents',
    label: 'Agentes',
    hint: 'scripts chats plano orientar padrões esforço fila',
  },
  {
    id: 'perfil',
    label: 'Perfil',
    hint: 'nome e-mail conta tokens mensagens atividade',
  },
  {
    id: 'computer',
    label: 'Uso do computador',
    hint: 'screenshot teclado janelas sessão',
  },
  {
    id: 'permissoes',
    label: 'Permissões',
    hint: 'análises analytics compartilhar',
  },
]

const RailIcon: Component<{
  name:
    | 'chat'
    | 'board'
    | 'command'
    | 'link'
    | 'channels'
    | 'skills'
    | 'sun'
    | 'moon'
    | 'gear'
    | 'close'
    | 'search'
    | 'brain'
    | 'trash'
    | 'users'
    | 'folder'
    | 'chevron-left'
    | 'chevron-right'
    | 'send'
    | 'sparkles'
}> = (props) => (
  <svg
    class="rail-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <Show when={props.name === 'chat'}>
      <path d="M5 6h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3v-3H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z" />
    </Show>
    <Show when={props.name === 'board'}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </Show>
    <Show when={props.name === 'command'}>
      <path d="M7 8l4 4-4 4M13 16h4" />
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
    </Show>
    <Show when={props.name === 'skills'}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </Show>
    <Show when={props.name === 'channels'}>
      <path d="M9 4 7 20M17 4l-2 16M4.5 9h16M3.5 15h16" />
    </Show>
    <Show when={props.name === 'link'}>
      <path d="M10 13a5 5 0 0 0 7.07.07l1.42-1.42a5 5 0 0 0-7.07-7.07L10.2 5.8" />
      <path d="M14 11a5 5 0 0 0-7.07-.07L5.5 12.35a5 5 0 0 0 7.07 7.07l1.22-1.22" />
    </Show>
    <Show when={props.name === 'sun'}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5" />
    </Show>
    <Show when={props.name === 'moon'}>
      <path d="M16 13.2A6.2 6.2 0 0 1 10.8 5 6.4 6.4 0 1 0 16 13.2z" />
    </Show>
    <Show when={props.name === 'gear'}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3V20.5M3.5 12h2.2M18.3 12h2.2M6.1 6.1l1.6 1.6M16.3 16.3l1.6 1.6M17.9 6.1l-1.6 1.6M7.7 16.3l-1.6 1.6" />
    </Show>
    <Show when={props.name === 'close'}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Show>
    <Show when={props.name === 'search'}>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-3.5-3.5" />
    </Show>
    <Show when={props.name === 'brain'}>
      <path d="M9.5 2a2.5 2.5 0 0 1 2.5 2.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-5.04z" />
      <path d="M14.5 2a2.5 2.5 0 0 0-2.5 2.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-5.04z" />
    </Show>
    <Show when={props.name === 'trash'}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Show>
    <Show when={props.name === 'users'}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Show>
    <Show when={props.name === 'folder'}>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z" />
    </Show>
    <Show when={props.name === 'chevron-left'}>
      <path d="M15 18l-6-6 6-6" />
    </Show>
    <Show when={props.name === 'chevron-right'}>
      <path d="M9 18l6-6-6-6" />
    </Show>
    <Show when={props.name === 'send'}>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </Show>
    <Show when={props.name === 'sparkles'}>
      <path d="m12 3 1.9 4.8 4.8 1.9-4.8 1.9L12 16.4l-1.9-4.8-4.8-1.9 4.8-1.9L12 3z" />
    </Show>
  </svg>
)

const SettingsGlyph: Component<{ id: SettingsPaneId }> = (props) => (
  <svg
    class="settings-glyph"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <Show when={props.id === 'geral'}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4" />
    </Show>
    <Show when={props.id === 'provedores'}>
      <path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" />
    </Show>
    <Show when={props.id === 'agents'}>
      <path d="M8 13a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM16.5 12.5a2.5 2.5 0 1 0-2.5-2.5 2.5 2.5 0 0 0 2.5 2.5z" />
      <path d="M3.5 19a4.5 4.5 0 0 1 9 0M13 19a4 4 0 0 1 7.5-1.5" />
    </Show>
    <Show when={props.id === 'perfil'}>
      <circle cx="12" cy="8.5" r="3" />
      <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
    </Show>
    <Show when={props.id === 'computer'}>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M9 19.5h6M12 16v3.5" />
    </Show>
    <Show when={props.id === 'permissoes'}>
      <path d="M12 3.5 6 6v5.2c0 3.6 2.4 6.2 6 7.8 3.6-1.6 6-4.2 6-7.8V6z" />
    </Show>
  </svg>
)

const Switch: Component<{
  pressed: boolean
  label: string
  onChange: () => void
}> = (props) => (
  <button
    type="button"
    class="switch"
    classList={{ on: props.pressed }}
    role="switch"
    aria-checked={props.pressed}
    aria-label={props.label}
    onClick={() => props.onChange()}
  >
    <span class="switch-knob" />
  </button>
)

/** Só aparece quando o texto passa do limite: mostra quanto tem e quanto pode. */
function OverLimitCounter(props: { id: string; text: string }) {
  return (
    <Show when={props.text.length > MAX_AGENT_INSTRUCTIONS}>
      <output id={props.id} class="char-over">
        {props.text.length}/{MAX_AGENT_INSTRUCTIONS} caracteres: reduza{' '}
        {props.text.length - MAX_AGENT_INSTRUCTIONS} para salvar.
      </output>
    </Show>
  )
}

export const App: Component = () => {
  const [activeSection, setActiveSection] = createSignal<
    'board' | 'agents' | 'channels' | 'skills'
  >('board')
  const [windowWidth, setWindowWidth] = createSignal(
    typeof window !== 'undefined' ? window.innerWidth : 1200,
  )
  const [sidebarManualCompact, setSidebarManualCompact] = createSignal<boolean | null>(null)
  const isSidebarCompact = createMemo(() => {
    const manual = sidebarManualCompact()
    if (manual !== null) return manual
    return windowWidth() < 960
  })
  const toggleSidebarCompact = () => {
    setSidebarManualCompact(!isSidebarCompact())
  }
  const [instantHiringId, setInstantHiringId] = createSignal<string | null>(null)
  const [showCommandPalette, setShowCommandPalette] = createSignal(false)
  const [paletteQuery, setPaletteQuery] = createSignal('')
  const [paletteIndex, setPaletteIndex] = createSignal(0)
  const [boardFilterProject, setBoardFilterProject] = createSignal<string>('all')
  const [boardForemanPrompt, setBoardForemanPrompt] = createSignal('')
  const [boardProviderId, setBoardProviderId] = createSignal('')
  const [boardModel, setBoardModel] = createSignal('')
  const [isCustomBoardModel, setIsCustomBoardModel] = createSignal(false)
  const [boardEffort, setBoardEffort] = createSignal<ProviderEffort | ''>('')
  const [boardDispatchMsg, setBoardDispatchMsg] = createSignal<string | null>(null)
  const [approvals, setApprovals] = createSignal<Approval[]>([])
  const [teamDraft, setTeamDraft] = createSignal<AgentDraft[] | null>(null)
  const [teamDrafting, setTeamDrafting] = createSignal(false)
  const [showAutomationModal, setShowAutomationModal] = createSignal(false)
  const [webhooks, setWebhooks] = createSignal<WebhookTrigger[]>([])
  const [webhookBase, setWebhookBase] = createSignal<string | null>(null)
  const [webhookTitle, setWebhookTitle] = createSignal('')
  const [webhookInstruction, setWebhookInstruction] = createSignal('')
  const [allAgentQueues, setAllAgentQueues] = createSignal<Record<string, TaskQueueItem[]>>({})
  const [allAgentPaused, setAllAgentPaused] = createSignal<Record<string, boolean>>({})
  const [profileStats, setProfileStats] = createSignal<ProfileStats | null>(null)
  const [providerUpdates, setProviderUpdates] = createSignal<ProviderUpdateInfo[]>([])
  const [updatingProvider, setUpdatingProvider] = createSignal<string | null>(null)
  const [updateMessage, setUpdateMessage] = createSignal<Record<string, string>>({})

  const loadProviderUpdates = async () => {
    try {
      if (window.orchbot) setProviderUpdates(await window.orchbot.getProviderUpdates())
    } catch (err) {
      console.error('Erro ao verificar atualizações:', err)
    }
  }

  const [computerStatus, setComputerStatus] = createSignal<ComputerUseStatus | null>(null)
  const loadComputerStatus = async () => {
    try {
      if (window.orchbot) setComputerStatus(await window.orchbot.getComputerUseStatus())
    } catch {
      // Status é informativo
    }
  }

  const visibleUpdates = () =>
    providerUpdates().filter(
      (u) =>
        u.updateAvailable &&
        u.latestVersion &&
        settings().dismissedProviderUpdates[u.providerId] !== u.latestVersion,
    )

  const handleRunUpdate = async (providerId: SupportedProvider) => {
    if (!window.orchbot) return
    setUpdatingProvider(providerId)
    try {
      const res = await window.orchbot.runProviderUpdate(providerId)
      setUpdateMessage((prev) => ({ ...prev, [providerId]: res.message }))
      await loadConnections()
      await loadProviderUpdates()
    } catch (err: unknown) {
      setUpdateMessage((prev) => ({
        ...prev,
        [providerId]: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      setUpdatingProvider(null)
    }
  }

  const handleDismissUpdate = (u: ProviderUpdateInfo) => {
    if (!u.latestVersion) return
    void updateSettings({
      dismissedProviderUpdates: {
        ...settings().dismissedProviderUpdates,
        [u.providerId]: u.latestVersion,
      },
    })
  }

  const loadProfileStats = async () => {
    try {
      if (window.orchbot) setProfileStats(await window.orchbot.getProfileStats())
    } catch (err) {
      console.error('Erro ao carregar perfil:', err)
    }
  }

  const formatCompact = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace('.', ',')} mi`
    if (n >= 1_000) return `${(n / 1_000).toFixed(2).replace('.', ',')} mil`
    return String(n)
  }
  const formatDatePt = (iso: string) =>
    new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  const formatShortDate = (iso: string) => {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })
  }
  const initialsOf = (name: string) => {
    const words = name.split(/\s+/).filter(Boolean)
    if (words.length >= 2) return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase()
    return (name.trim().slice(0, 2) || 'JO').toUpperCase()
  }

  // Configurações do app (Configurações ⚙) persistidas no banco
  const [settings, setSettings] = createSignal<AppSettings>({
    ...DEFAULT_APP_SETTINGS,
  })
  // Evita abrir a escolha de provedores antes de saber se já foi feita.
  const [settingsLoaded, setSettingsLoaded] = createSignal(false)
  // Configurações abrem por cima da tela atual (modal), então não são uma "seção".
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [settingsPane, setSettingsPane] = createSignal<SettingsPaneId>('geral')
  const [settingsQuery, setSettingsQuery] = createSignal('')
  const [listQuery, setListQuery] = createSignal('')
  const [showNewMenu, setShowNewMenu] = createSignal(false)

  // Canais na barra lateral (a tela de canal só mostra o escolhido)
  const [sidebarChannels, setSidebarChannels] = createSignal<Channel[]>([])
  const [selectedChannelId, setSelectedChannelId] = createSignal<string | null>(null)
  const [creatingChannel, setCreatingChannel] = createSignal(false)
  const [showArchivedChannels, setShowArchivedChannels] = createSignal(false)
  const loadChannels = async () => {
    try {
      if (window.orchbot)
        setSidebarChannels(await window.orchbot.listChannels(showArchivedChannels()))
    } catch (err) {
      console.error('Erro ao carregar canais:', err)
    }
  }

  // Estado de cada agente na barra lateral: trabalhando, respondeu, falhou, pausado
  const [agentStates, setAgentStates] = createSignal<Record<string, AgentState>>({})
  const setAgentState = (agentId: string, state: AgentState) =>
    setAgentStates((prev) => (prev[agentId] === state ? prev : { ...prev, [agentId]: state }))
  const refreshAgentState = async (agentId: string) => {
    if (!window.orchbot) return
    try {
      const [queue, paused] = await Promise.all([
        window.orchbot.getQueue(agentId),
        window.orchbot.isQueuePaused(agentId),
      ])
      setAllAgentQueues((prev) => ({ ...prev, [agentId]: queue }))
      setAllAgentPaused((prev) => ({ ...prev, [agentId]: paused }))
      setAgentState(agentId, stateFromQueue(queue, paused))
    } catch {
      // sem estado: a linha só não mostra o selo
    }
  }
  const [systemDark, setSystemDark] = createSignal(
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true,
  )
  const effectiveTheme = () =>
    settings().theme === 'system' ? (systemDark() ? 'dark' : 'light') : settings().theme

  createEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme()
    document.documentElement.style.setProperty('--logo-bg', settings().logoColor)
  })

  const loadSettings = async () => {
    try {
      if (window.orchbot) setSettings(await window.orchbot.getSettings())
      setSettingsLoaded(true)
    } catch (err) {
      console.error('Erro ao carregar configurações:', err)
    }
  }

  const updateSettings = async (patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
    try {
      if (window.orchbot) setSettings(await window.orchbot.updateSettings(patch))
    } catch (err) {
      console.error('Erro ao salvar configurações:', err)
    }
  }

  const openSettings = (pane?: SettingsPaneId) => {
    if (pane) {
      setSettingsQuery('')
      setSettingsPane(pane)
    }
    setSettingsOpen(true)
    void loadComputerStatus()
    if (pane === 'provedores') {
      loadConnections()
      void loadProviderUpdates()
    }
  }

  const closeSettings = () => {
    setSettingsQuery('')
    setSettingsOpen(false)
  }

  const settingsQueryNorm = () => settingsQuery().trim().toLowerCase()
  const visibleSettingsPanes = () => {
    const query = settingsQueryNorm()
    if (!query) return SETTINGS_PANES
    return SETTINGS_PANES.filter(
      (pane) => pane.label.toLowerCase().includes(query) || pane.hint.includes(query),
    )
  }
  const currentSettingsPane = () =>
    visibleSettingsPanes().find((pane) => pane.id === settingsPane()) ?? visibleSettingsPanes()[0]

  const selectSettingsPane = (id: SettingsPaneId) => {
    setSettingsPane(id)
    if (id === 'perfil') void loadProfileStats()
    if (id === 'computer') void loadComputerStatus()
  }

  createEffect(() => {
    const panes = visibleSettingsPanes()
    if (panes.length === 0) return
    if (!panes.some((pane) => pane.id === settingsPane())) {
      const first = panes[0]
      if (first) setSettingsPane(first.id)
    }
  })

  const visibleMessages = () =>
    settings().showAgentSteps ? messages() : messages().filter((m) => m.role !== 'system')

  // Conexões e Provedores signals
  const [connections, setConnections] = createSignal<ProviderConnection[]>([])
  const [modelCatalogs, setModelCatalogs] = createSignal<Record<string, ProviderModelInfo[]>>({})
  const pendingCatalogs = new Map<string, Promise<void>>()
  const [catalogWarnings, setCatalogWarnings] = createSignal<Record<string, string>>({})
  let catalogGeneration = 0
  const catalogKey = (id: string, accountId?: string) => `${id}:${accountId ?? ''}`
  const modelsFor = (id: SupportedProvider, accountId?: string) => {
    const catalog = modelCatalogs()[catalogKey(id, accountId)]
    return catalog?.length
      ? catalog.map((model) => model.id)
      : (connections().find((c) => c.providerId === id)?.models ?? [])
  }
  const effortsFor = (
    id: SupportedProvider,
    model: string,
    accountId?: string,
  ): [ProviderEffort | '', string][] => {
    if (connections().find((connection) => connection.providerId === id)?.supportsEffort === false)
      return [['', 'Padrão']]
    return modelEffortOptions(model, modelCatalogs()[catalogKey(id, accountId)])
  }

  const loadModelCatalog = (
    id: SupportedProvider,
    accountId?: string,
    force = false,
  ): Promise<void> => {
    const key = catalogKey(id, accountId)
    const pending = pendingCatalogs.get(key)
    if (pending) return pending
    if (!force && modelCatalogs()[key]) return Promise.resolve()
    const generation = catalogGeneration
    const request = window.orchbot
      .discoverModels(id, accountId)
      .then((result) => {
        if (generation !== catalogGeneration) return
        setCatalogWarnings((prev) => ({
          ...prev,
          [key]: result.source === 'cache' || result.source === 'catalog' ? result.message : '',
        }))
        setModelCatalogs((prev) => ({
          ...prev,
          [key]: result.catalog ?? result.models.map((id) => ({ id })),
        }))
        if (!accountId) {
          setDiscoverMessage((prev) => ({ ...prev, [id]: result.message }))
        }
      })
      .catch((error: unknown) => {
        if (generation !== catalogGeneration) return
        setCatalogWarnings((prev) => ({
          ...prev,
          [key]: error instanceof Error ? error.message : String(error),
        }))
        setModelCatalogs((prev) => ({ ...prev, [key]: [] }))
        if (!accountId)
          setDiscoverMessage((prev) => ({
            ...prev,
            [id]: error instanceof Error ? error.message : String(error),
          }))
      })
      .finally(() => {
        if (pendingCatalogs.get(key) === request) pendingCatalogs.delete(key)
      })
    pendingCatalogs.set(key, request)
    return request
  }

  const [providerAccounts, setProviderAccounts] = createSignal<Record<string, ProviderAccount[]>>(
    {},
  )
  const [accountsProvider, setAccountsProvider] = createSignal<SupportedProvider | null>(null)
  const accountsConnection = () =>
    connections().find((connection) => connection.providerId === accountsProvider())
  const [connectionDrafts, setConnectionDrafts] = createSignal<
    Record<
      string,
      {
        name?: string
        apiKey?: string
        endpoint?: string
        defaultModel?: string
        cliPath?: string
        cliArgs?: string
        apiKeyEnv?: string
        effort?: ProviderEffort
      }
    >
  >({})
  const [selectedConnId, setSelectedConnId] = createSignal<string | null>(null)
  const activeConnectionId = createMemo(
    () =>
      connections().find((c) => c.providerId === selectedConnId())?.providerId ??
      principalConnection(connections(), settings().defaultProvider)?.providerId ??
      connections()[0]?.providerId,
  )
  const [showCustomProvider, setShowCustomProvider] = createSignal(false)
  const [customPreset, setCustomPreset] =
    createSignal<keyof typeof CUSTOM_PROVIDER_PRESETS>('custom')
  const [customForm, setCustomForm] = createSignal({
    ...CUSTOM_PROVIDER_PRESETS.custom,
    apiKey: '',
  })
  const [creatingProvider, setCreatingProvider] = createSignal(false)
  const [customProviderError, setCustomProviderError] = createSignal('')
  const closeCustomProvider = () => {
    setShowCustomProvider(false)
    setCustomForm({ ...CUSTOM_PROVIDER_PRESETS.custom, apiKey: '' })
    setCustomPreset('custom')
    setCustomProviderError('')
  }
  const handleCreateCustomProvider = async () => {
    if (!window.orchbot) return
    setCreatingProvider(true)
    setCustomProviderError('')
    try {
      await window.orchbot.createCustomProvider(customForm())
      closeCustomProvider()
      await loadConnections()
      await loadProviderStatuses()
    } catch (error) {
      setCustomProviderError(error instanceof Error ? error.message : String(error))
    } finally {
      setCreatingProvider(false)
    }
  }
  const handleDeleteCustomProvider = async (conn: ProviderConnection) => {
    if (!window.orchbot || !isCustomProvider(conn.providerId)) return
    if (!confirm(`Remover o provedor "${conn.name}" e sua chave salva?`)) return
    try {
      await window.orchbot.deleteCustomProvider(conn.providerId)
      setConfigProviderId(null)
      await loadConnections()
      await loadProviderStatuses()
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }
  const [configProviderId, setConfigProviderId] = createSignal<SupportedProvider | null>(null)
  const [discoveringProvider, setDiscoveringProvider] = createSignal<string | null>(null)
  const [discoverMessage, setDiscoverMessage] = createSignal<Record<string, string>>({})
  const [showApiKeys, setShowApiKeys] = createSignal<Record<string, boolean>>({})
  const [testingConnection, setTestingConnection] = createSignal<string | null>(null)
  const [testResults, setTestResults] = createSignal<
    Record<string, { success: boolean; message: string }>
  >({})
  const [savingConnection, setSavingConnection] = createSignal<string | null>(null)
  const [saveMessage, setSaveMessage] = createSignal<Record<string, string>>({})

  const [projects, setProjects] = createSignal<Project[]>([])
  const [showProjectModal, setShowProjectModal] = createSignal(false)
  const [brainProject, setBrainProject] = createSignal<Project | null>(null)
  const [projectFormName, setProjectFormName] = createSignal('')
  const [projectFormDescription, setProjectFormDescription] = createSignal('')
  const [projectFormPath, setProjectFormPath] = createSignal('')
  const [agents, setAgents] = createSignal<Agent[]>([])
  const [selectedAgentId, setSelectedAgentId] = createSignal<string | null>(null)
  const [agentThreads, setAgentThreads] = createSignal<Thread[]>([])
  const [activeThread, setActiveThread] = createSignal<Thread | null>(null)
  const [messages, setMessages] = createSignal<Message[]>([])
  const [systemStatus, setSystemStatus] = createSignal<SystemStatus | null>(null)
  const [providerStatuses, setProviderStatuses] = createSignal<Record<
    SupportedProvider,
    ProviderInfo
  > | null>(null)

  // Modo de visualização principal: 'chat' | 'browser'
  const [mainViewMode, setMainViewMode] = createSignal<'chat' | 'browser'>('chat')

  // Fila FIFO signals
  const [tasks, setTasks] = createSignal<TaskQueueItem[]>([])
  const [isQueuePaused, setIsQueuePaused] = createSignal(false)
  const [showQueuePanel, setShowQueuePanel] = createSignal(false)

  // Anexos staged signals
  const [stagedFiles, setStagedFiles] = createSignal<SelectedFile[]>([])

  // Delegação entre agentes signals
  const [showDelegationModal, setShowDelegationModal] = createSignal(false)
  const [delegationTargetId, setDelegationTargetId] = createSignal<string>('')
  const [delegationPrompt, setDelegationPrompt] = createSignal('')
  const [delegationLoading, setDelegationLoading] = createSignal(false)
  const [delegationError, setDelegationError] = createSignal<string | null>(null)

  // Browser Embarcado signals (Fase 5)
  const [browserTabs, setBrowserTabs] = createSignal<BrowserTab[]>([])
  const [activeTabId, setActiveTabId] = createSignal<string | null>(null)
  const [browserUrlInput, setBrowserUrlInput] = createSignal('https://github.com')
  const [browserLoading, setBrowserLoading] = createSignal(false)
  const [browserInspectData, setBrowserInspectData] = createSignal<BrowserPageContent | null>(null)
  const [browserScreenshotUrl, setBrowserScreenshotUrl] = createSignal<string | null>(null)
  const [browserClickSelector, setBrowserClickSelector] = createSignal('')
  const [browserFillSelector, setBrowserFillSelector] = createSignal('')
  const [browserFillValue, setBrowserFillValue] = createSignal('')
  const [browserStatusMsg, setBrowserStatusMsg] = createSignal<string | null>(null)
  const [miniBrowserOpen, setMiniBrowserOpen] = createSignal(false)

  // Chat signals
  const [inputText, setInputText] = createSignal('')
  const [isStreaming, setIsStreaming] = createSignal(false)
  const [streamingText, setStreamingText] = createSignal('')
  const [chatError, setChatError] = createSignal<string | null>(null)
  const [mentionQuery, setMentionQuery] = createSignal<string | null>(null)
  const [mentionSelectedIndex, setMentionSelectedIndex] = createSignal(0)
  let chatTextareaRef: HTMLTextAreaElement | undefined

  // Modal signals
  const [showModal, setShowModal] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)

  // Regras do Projeto (ORCHBOT.md / AGENTS.md) e RAG FTS5 signals
  const [workspaceRules, setWorkspaceRules] = createSignal<WorkspaceRulesInfo | null>(null)
  const [showRulesModal, setShowRulesModal] = createSignal(false)
  const [showMemoryModal, setShowMemoryModal] = createSignal(false)
  const [memories, setMemories] = createSignal<AgentMemory[]>([])
  const [newMemory, setNewMemory] = createSignal('')
  const [contextUsage, setContextUsage] = createSignal<{
    tokens: number
    window: number
    compacted: boolean
    measured: boolean
  } | null>(null)
  const refreshMemories = async (agentId: string) =>
    setMemories((await window.orchbot?.listMemories(agentId)) ?? [])
  // Medidor de contexto: atualiza ao trocar de conversa e após cada turno.
  createEffect(() => {
    const agentId = selectedAgentId()
    const thread = activeThread()
    messages() // dependência: recalcula quando chegam mensagens
    if (!agentId || !thread || !window.orchbot) return setContextUsage(null)
    void window.orchbot.getContextUsage(agentId, thread.id).then(setContextUsage)
  })
  const [showSearchModal, setShowSearchModal] = createSignal(false)
  const [searchQuery, setSearchQuery] = createSignal('')
  const [searchResults, setSearchResults] = createSignal<SearchResultGroup | null>(null)
  const [isSearching, setIsSearching] = createSignal(false)
  const [isIndexing, setIsIndexing] = createSignal(false)
  const [indexingMsg, setIndexingMsg] = createSignal<string | null>(null)
  const [searchTab, setSearchTab] = createSignal<'messages' | 'files'>('messages')

  // Agendamento & Tarefas em Background (Cron) signals
  const [showCronModal, setShowCronModal] = createSignal(false)
  const [scheduledTasks, setScheduledTasks] = createSignal<ScheduledTask[]>([])
  const [cronFormTitle, setCronFormTitle] = createSignal('')
  const [cronFormPrompt, setCronFormPrompt] = createSignal('')
  const [cronFormExpr, setCronFormExpr] = createSignal('0 9 * * *')
  const [cronFormType, setCronFormType] = createSignal<ScheduledTaskType>('routine')
  const [cronFormTargetUrl, setCronFormTargetUrl] = createSignal('')
  const [cronFormThreadId, setCronFormThreadId] = createSignal('')
  const [cronRunningId, setCronRunningId] = createSignal<string | null>(null)
  const [cronSuccessMsg, setCronSuccessMsg] = createSignal<string | null>(null)

  // Form signals
  const [name, setName] = createSignal('')
  const [provider, setProvider] = createSignal<SupportedProvider>('codex')
  const [newAccountId, setNewAccountId] = createSignal('')
  createEffect(() => {
    provider()
    setNewAccountId('')
  })
  const [model, setModel] = createSignal('gpt-4o')
  const [workspacePath, setWorkspacePath] = createSignal('')
  const [instructions, setInstructions] = createSignal('')
  const [description, setDescription] = createSignal('')
  const [agentRole, setAgentRole] = createSignal<AgentRole>('worker')
  const [newAvatar, setNewAvatar] = createSignal('')
  const [aiPrompt, setAiPrompt] = createSignal('')
  const [drafting, setDrafting] = createSignal(false)
  const [draftNote, setDraftNote] = createSignal('')
  // Edição por IA: o rascunho fica editável e só grava quando o usuário confirma.
  const [showAiEdit, setShowAiEdit] = createSignal(false)
  const [showAgentSettings, setShowAgentSettings] = createSignal(false)
  const [showAgentMenu, setShowAgentMenu] = createSignal(false)
  const [aiEditPrompt, setAiEditPrompt] = createSignal('')
  const [editDraft, setEditDraft] = createSignal<AgentDraft | null>(null)
  const [aiEditError, setAiEditError] = createSignal('')
  const runDraft = async (prompt: string, baseAgentId?: string) => {
    setDrafting(true)
    try {
      return await window.orchbot.draftAgent(prompt, baseAgentId)
    } finally {
      setDrafting(false)
    }
  }
  const draftForCreate = async () => {
    setDraftNote('')
    try {
      const draft = await runDraft(aiPrompt())
      setName(draft.name)
      setDescription(draft.description)
      setAgentRole(draft.role)
      setNewAvatar(draft.avatar)
      setInstructions(draft.instructions)
      setDraftNote(
        draft.source === 'model'
          ? 'Rascunho gerado. Revise os campos abaixo antes de criar.'
          : 'Nenhum provedor respondeu: montei um rascunho simples offline. Revise e ajuste.',
      )
    } catch (err) {
      setDraftNote(err instanceof Error ? err.message : String(err))
    }
  }
  const draftForEdit = async (agentId: string) => {
    setAiEditError('')
    try {
      setEditDraft(await runDraft(aiEditPrompt(), agentId))
    } catch (err) {
      setAiEditError(err instanceof Error ? err.message : String(err))
    }
  }
  const saveEditDraft = async (agentId: string) => {
    const draft = editDraft()
    if (!draft) return
    try {
      const updated = await window.orchbot.updateAgent({
        id: agentId,
        name: draft.name,
        description: draft.description,
        role: draft.role,
        avatar: draft.avatar,
        instructions: draft.instructions,
      })
      setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)))
      setShowAiEdit(false)
      setEditDraft(null)
      setAiEditPrompt('')
    } catch (err) {
      setAiEditError(err instanceof Error ? err.message : String(err))
    }
  }
  const [agentProjectId, setAgentProjectId] = createSignal('')
  const [agentEffort, setAgentEffort] = createSignal<ProviderEffort | ''>('')
  const [capLocalScripts, setCapLocalScripts] = createSignal('')
  const [capStartsChats, setCapStartsChats] = createSignal('')
  const [capShowPlan, setCapShowPlan] = createSignal('')
  const [capSteer, setCapSteer] = createSignal('')
  const [capComputer, setCapComputer] = createSignal('')
  const [agentContextMode, setAgentContextMode] = createSignal<ContextMode>('padrao')
  const [agentBrowserAccess, setAgentBrowserAccess] = createSignal(true)
  const [autonomyLevel, setAutonomyLevel] = createSignal<AutonomyLevel>('autonomous')

  let messagesEndRef: HTMLDivElement | undefined

  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView({ behavior: 'smooth' })
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const loadAgents = async () => {
    try {
      if (window.orchbot) {
        const list = await window.orchbot.getAgents()
        setAgents(list)
        for (const agent of list) void refreshAgentState(agent.id)
        if (list.length > 0 && !selectedAgentId()) {
          setSelectedAgentId(list[0].id)
        }
      }
    } catch (err) {
      console.error('Erro ao carregar agentes:', err)
    }
  }

  const loadProjects = async () => {
    try {
      if (window.orchbot) {
        setProjects(await window.orchbot.getProjects())
      }
    } catch (err) {
      console.error('Erro ao carregar projetos:', err)
    }
  }

  const handleCreateProject = async (e: Event) => {
    e.preventDefault()
    if (!window.orchbot || !projectFormName().trim()) return
    try {
      const project = await window.orchbot.createProject({
        name: projectFormName().trim(),
        description: projectFormDescription().trim() || undefined,
        workspacePath: projectFormPath().trim() || undefined,
        createFolder: true,
      })
      await loadProjects()
      setAgentProjectId(project.id)
      if (project.workspacePath) setWorkspacePath(project.workspacePath)
      setShowProjectModal(false)
      setProjectFormName('')
      setProjectFormDescription('')
      setProjectFormPath('')
    } catch (err: unknown) {
      alert(`Erro ao criar projeto: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleDeleteProject = async (project: Project) => {
    if (!window.orchbot) return
    if (!confirm(`Remover o projeto "${project.name}"? Os robôs dele ficam sem projeto.`)) return
    try {
      await window.orchbot.deleteProject(project.id)
      await loadProjects()
      await loadAgents()
    } catch (err: unknown) {
      alert(`Erro ao remover projeto: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const projectOf = (agent: Agent) =>
    agent.projectId ? (projects().find((proj) => proj.id === agent.projectId) ?? null) : null

  const agentMatchesQuery = (agent: Agent) => {
    const query = listQuery().trim().toLowerCase()
    if (!query) return true
    return (
      agent.name.toLowerCase().includes(query) ||
      (agent.description ?? '').toLowerCase().includes(query) ||
      agent.workspacePath.toLowerCase().includes(query) ||
      agent.provider.toLowerCase().includes(query)
    )
  }
  const foreman = createMemo(() => agents().find((a) => isForeman(a)))
  const coworkers = () => agents().filter((a) => !isForeman(a))
  const agentsOfProject = (projectId: string | null) =>
    coworkers().filter((a) => (a.projectId ?? null) === projectId && agentMatchesQuery(a))

  const handleSwitchEffort = async (agentId: string, effort: ProviderEffort | '') => {
    try {
      if (window.orchbot) {
        const updated = await window.orchbot.updateAgent({
          id: agentId,
          effort: effort === '' ? null : effort,
        })
        setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)))
      }
    } catch (err: unknown) {
      alert(`Erro ao trocar esforço: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSwitchRole = async (agentId: string, role: AgentRole) => {
    try {
      if (window.orchbot) {
        const updated = await window.orchbot.updateAgent({ id: agentId, role })
        setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)))
      }
    } catch (err: unknown) {
      alert(`Erro ao trocar tipo: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSwitchContextMode = async (agentId: string, mode: ContextMode) => {
    try {
      if (window.orchbot) {
        const updated = await window.orchbot.updateAgent({
          id: agentId,
          contextMode: mode,
        })
        setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)))
      }
    } catch (err: unknown) {
      alert(`Erro ao trocar contexto: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSwitchBrowserAccess = async (agentId: string, enabled: boolean) => {
    try {
      if (window.orchbot) {
        const updated = await window.orchbot.updateAgent({
          id: agentId,
          browserAccess: enabled,
        })
        setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)))
      }
    } catch (err: unknown) {
      alert(`Erro ao trocar navegador: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const teamOf = (agent: Agent) =>
    agents().filter(
      (a) =>
        a.id !== agent.id &&
        a.role !== 'orchestrator' &&
        (!agent.projectId || a.projectId === agent.projectId),
    )

  const STATUS_CACHE_KEY = 'orchbot:provider-status'
  const withStatus = (c: ProviderConnection, s: ProviderInfo): ProviderConnection => ({
    ...c,
    available: s.available,
    version: s.version,
    path: s.path,
    authStatus: s.authStatus,
    readiness: s.readiness,
    loginHint: s.loginHint,
    installHint: s.installHint ?? c.installHint,
    error: s.error,
  })
  const readStatusCache = (): Partial<Record<string, ProviderInfo>> => {
    try {
      return JSON.parse(localStorage.getItem(STATUS_CACHE_KEY) ?? '{}')
    } catch {
      return {}
    }
  }

  // Um pedido por provedor: cada card atualiza quando o seu CLI responde, sem esperar o mais lento.
  const loadProviderStatuses = async () => {
    if (!window.orchbot) return
    const ids = (connections().length ? connections() : await window.orchbot.listConnections()).map(
      (c) => c.providerId,
    )
    await Promise.all(
      ids.map(async (id) => {
        try {
          const { status } = await window.orchbot.testConnection(id)
          if (!status) return
          setProviderStatuses((prev) => ({ ...(prev ?? {}), [id]: status }) as typeof prev)
          setConnections((prev) =>
            prev.map((c) => (c.providerId === id ? withStatus(c, status) : c)),
          )
          try {
            localStorage.setItem(
              STATUS_CACHE_KEY,
              JSON.stringify({ ...readStatusCache(), [id]: status }),
            )
          } catch {}
        } catch (err) {
          console.error('Erro ao verificar provedor:', id, err)
        }
      }),
    )
  }

  const loadConnections = async () => {
    try {
      if (window.orchbot) {
        if (connections().length === 0) {
          // Último status conhecido aparece na hora; os testes ao vivo corrigem em seguida.
          const cached = readStatusCache()
          const quick = await window.orchbot.listConnections()
          setConnections(
            quick.map((c) =>
              cached[c.providerId] ? withStatus(c, cached[c.providerId] as ProviderInfo) : c,
            ),
          )
        }
        const list = await window.orchbot.getConnections()
        setConnections(list)
        catalogGeneration++
        pendingCatalogs.clear()
        setModelCatalogs({})
        for (const connection of list) {
          if (connection.enabled) void loadModelCatalog(connection.providerId)
        }
        const accountLists = await Promise.all(
          list.map(
            async (connection) =>
              [
                connection.providerId,
                await window.orchbot.getProviderAccounts(connection.providerId),
              ] as const,
          ),
        )
        setProviderAccounts(Object.fromEntries(accountLists))
        const drafts: Record<
          string,
          {
            name?: string
            apiKey?: string
            endpoint?: string
            defaultModel?: string
            cliPath?: string
            cliArgs?: string
            apiKeyEnv?: string
            effort?: ProviderEffort
          }
        > = {}
        for (const c of list) {
          drafts[c.providerId] = {
            name: c.name,
            endpoint: c.endpoint || '',
            defaultModel: c.defaultModel,
            cliPath: c.cliPath || '',
            cliArgs: JSON.stringify(c.cliArgs ?? []),
            apiKeyEnv: c.apiKeyEnv || '',
            effort: c.effort,
          }
        }
        setConnectionDrafts(drafts)
      }
    } catch (err) {
      console.error('Erro ao carregar conexões:', err)
    }
  }

  const loadSystemStatus = async () => {
    try {
      if (window.orchbot) {
        const status = await window.orchbot.getSystemStatus()
        setSystemStatus(status)
      }
    } catch (err) {
      console.error('Erro ao carregar status do sistema:', err)
    }
  }

  const loadQueue = async (agentId: string) => {
    try {
      if (window.orchbot) {
        const queueList = await window.orchbot.getQueue(agentId)
        setTasks(queueList)
        const paused = await window.orchbot.isQueuePaused(agentId)
        setIsQueuePaused(paused)
      }
    } catch (err) {
      console.error('Erro ao carregar fila:', err)
    }
  }

  const loadThreadAndMessages = async (agentId: string, preferredThreadId?: string) => {
    try {
      if (window.orchbot) {
        const threads = await window.orchbot.getThreads(agentId)
        setAgentThreads(threads)
        if (threads.length > 0) {
          const activeId = activeThread()?.id
          const selected =
            (preferredThreadId && threads.find((t) => t.id === preferredThreadId)) ||
            (activeId && threads.find((t) => t.id === activeId)) ||
            threads[0]
          setActiveThread(selected)
          const msgs = await window.orchbot.getMessages(selected.id)
          setMessages(msgs)
          setTimeout(scrollToBottom, 50)
        } else {
          setActiveThread(null)
          setMessages([])
        }
      }
    } catch (err) {
      console.error('Erro ao carregar mensagens:', err)
    }
  }

  const loadBrowserTabs = async (agentId: string) => {
    try {
      if (window.orchbot) {
        const tabs = await window.orchbot.browserGetTabs(agentId)
        setBrowserTabs(tabs)
        if (tabs.length > 0) {
          const current = tabs.find((t) => t.id === activeTabId()) || tabs[tabs.length - 1]
          setActiveTabId(current.id)
          setBrowserUrlInput(current.url)
        } else {
          setActiveTabId(null)
          setBrowserInspectData(null)
          setBrowserScreenshotUrl(null)
        }
      }
    } catch (err) {
      console.error('Erro ao carregar abas do navegador:', err)
    }
  }

  const handleOpenBrowserTab = async (targetUrl?: string) => {
    const agent = currentAgent()
    if (!agent || !window.orchbot) return
    const url = targetUrl || browserUrlInput()
    if (!url.trim()) return

    setBrowserLoading(true)
    setBrowserStatusMsg(null)
    try {
      const tab = await window.orchbot.browserOpenTab(agent.id, url.trim())
      await loadBrowserTabs(agent.id)
      setActiveTabId(tab.id)
      setBrowserUrlInput(tab.url)
      setMiniBrowserOpen(true)
      setBrowserInspectData(null)
      setBrowserScreenshotUrl(null)
    } catch (err: unknown) {
      alert(`Erro ao abrir URL: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBrowserLoading(false)
    }
  }

  const handleCloseBrowserTab = async (tabId: string) => {
    const agent = currentAgent()
    if (!agent || !window.orchbot) return
    try {
      await window.orchbot.browserCloseTab(agent.id, tabId)
      await loadBrowserTabs(agent.id)
    } catch (err) {
      console.error('Erro ao fechar aba:', err)
    }
  }

  const handleBrowserNavigate = async (action: 'back' | 'forward' | 'reload') => {
    const agent = currentAgent()
    const tabId = activeTabId()
    if (!agent || !tabId || !window.orchbot) return
    setBrowserLoading(true)
    try {
      const tab = await window.orchbot.browserNavigate(agent.id, tabId, action)
      setBrowserUrlInput(tab.url)
      await loadBrowserTabs(agent.id)
    } catch (err: unknown) {
      alert(`Erro ao navegar: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBrowserLoading(false)
    }
  }

  const handleBrowserInspect = async () => {
    const agent = currentAgent()
    const tabId = activeTabId()
    if (!agent || !tabId || !window.orchbot) return
    try {
      const data = await window.orchbot.browserInspect(agent.id, tabId)
      setBrowserInspectData(data)
    } catch (err: unknown) {
      alert(`Erro ao inspecionar DOM: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleBrowserScreenshot = async () => {
    const agent = currentAgent()
    const tabId = activeTabId()
    if (!agent || !tabId || !window.orchbot) return
    try {
      const res = await window.orchbot.browserScreenshot(agent.id, tabId)
      setBrowserScreenshotUrl(res.base64)
    } catch (err: unknown) {
      alert(`Erro ao capturar screenshot: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleBrowserClick = async (selector: string) => {
    const agent = currentAgent()
    const tabId = activeTabId()
    if (!agent || !tabId || !window.orchbot || !selector.trim()) return

    // Modo Cauteloso: Solicita confirmação explícita antes de qualquer clique
    if (agent.autonomyLevel === 'cautious') {
      const confirmed = window.confirm(
        `🛡️ [Modo Cauteloso]\n\nO agente está configurado para pedir permissão antes de ações de navegação.\n\nDeseja confirmar a execução do clique no elemento CSS:\n"${selector.trim()}"?`,
      )
      if (!confirmed) return
    }

    try {
      await window.orchbot.browserClick(agent.id, tabId, selector.trim())
      setBrowserStatusMsg(`Elemento "${selector}" clicado com sucesso!`)
      setTimeout(() => setBrowserStatusMsg(null), 3000)
    } catch (err: unknown) {
      alert(`Erro ao clicar: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleBrowserFill = async (selector: string, value: string) => {
    const agent = currentAgent()
    const tabId = activeTabId()
    if (!agent || !tabId || !window.orchbot || !selector.trim()) return

    // Modo Cauteloso: Solicita confirmação explícita antes de qualquer digitação/preenchimento
    if (agent.autonomyLevel === 'cautious') {
      const confirmed = window.confirm(
        `🛡️ [Modo Cauteloso]\n\nO agente está configurado para pedir permissão antes de ações de formulário.\n\nDeseja confirmar o preenchimento do campo CSS:\n"${selector.trim()}" com o valor:\n"${value}"?`,
      )
      if (!confirmed) return
    }

    try {
      await window.orchbot.browserFill(agent.id, tabId, selector.trim(), value)
      setBrowserStatusMsg(`Campo "${selector}" preenchido com sucesso!`)
      setTimeout(() => setBrowserStatusMsg(null), 3000)
    } catch (err: unknown) {
      alert(`Erro ao preencher: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  onMount(() => {
    void loadSettings()
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onMq = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq?.addEventListener?.('change', onMq)
    onCleanup(() => mq?.removeEventListener?.('change', onMq))
    const onResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    onCleanup(() => window.removeEventListener('resize', onResize))
    const onGlobalShortcut = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return
      const mod = event.ctrlKey || event.metaKey
      if (mod && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'p')) {
        event.preventDefault()
        setPaletteQuery('')
        setPaletteIndex(0)
        setShowCommandPalette((prev) => !prev)
        return
      }
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        openNewAgent()
        return
      }
      if (mod && event.key === '1') {
        event.preventDefault()
        setActiveSection('board')
        return
      }
      if (mod && event.key === '2') {
        event.preventDefault()
        setActiveSection('agents')
        return
      }
      if (mod && event.key === '3') {
        event.preventDefault()
        setActiveSection('channels')
        return
      }
      if (mod && event.key === ',') {
        event.preventDefault()
        openSettings()
        return
      }
    }
    window.addEventListener('keydown', onGlobalShortcut)
    onCleanup(() => window.removeEventListener('keydown', onGlobalShortcut))

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showCommandPalette()) {
        setShowCommandPalette(false)
        return
      }
      if (event.key !== 'Escape' || !settingsOpen()) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }
      if (
        showModal() ||
        showProjectModal() ||
        brainProject() ||
        showRulesModal() ||
        showSearchModal() ||
        showCronModal() ||
        showAutomationModal() ||
        showDelegationModal() ||
        showCustomProvider() ||
        accountsProvider()
      ) {
        return
      }
      closeSettings()
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))

    const offLink = window.orchbot?.onDeepLink((link) => {
      if (link.kind === 'agent') {
        setActiveSection('agents')
        setSelectedAgentId(link.id)
      } else if (link.kind === 'channel') {
        setActiveSection('channels')
        setSelectedChannelId(link.id)
      } else if (link.kind === 'section') {
        if (link.name === 'connections') openSettings('provedores')
        else setActiveSection(link.name)
      } else if (link.kind === 'new-agent') setShowModal(true)
    })
    if (offLink) onCleanup(offLink)

    void (async () => {
      await loadSettings()
      await loadProfileStats()
      void loadProviderUpdates()
      void loadComputerStatus()
      await loadAgents()
      // Restaurar o último espaço de trabalho ao iniciar
      const s = settings()
      if (s.restoreWorkspace && s.lastAgentId && agents().some((a) => a.id === s.lastAgentId)) {
        setSelectedAgentId(s.lastAgentId)
      }
    })()
    loadProjects()
    void loadChannels()
    loadConnections()
    loadProviderStatuses()
    loadSystemStatus()

    if (!window.orchbot) return

    // Registra listeners de streaming IPC
    const unsubChunk = window.orchbot.onStreamChunk((data) => {
      if (activeThread() && data.threadId === activeThread()?.id) {
        setStreamingText(data.fullText)
        setIsStreaming(true)
        scrollToBottom()
      }
    })

    void loadApprovals()
    const unsubFinished = window.orchbot.onTurnFinished((data) => {
      // Respostas de agentes em canais mudam o resumo do canal na barra lateral.
      void loadChannels()
      void loadApprovals()
      if (activeThread() && data.threadId === activeThread()?.id) {
        setMessages((prev) => [...prev, data.message])
        setStreamingText('')
        setIsStreaming(false)
        scrollToBottom()
      }
    })

    const unsubError = window.orchbot.onTurnError((data) => {
      if (activeThread() && data.threadId === activeThread()?.id) {
        setChatError(data.error)
        setIsStreaming(false)
        setStreamingText('')
      }
    })

    const unsubTask = window.orchbot.onTaskStatusChanged((data) => {
      const owner = data.task.agentId
      const isOpen = owner === selectedAgentId() && activeSection() === 'agents'
      setAgentState(owner, stateFromTask(agentStates()[owner] ?? 'idle', data.task, isOpen))
      setAllAgentQueues((prev) => {
        const list = prev[owner] ?? []
        const index = list.findIndex((t) => t.id === data.task.id)
        if (index >= 0) {
          const next = [...list]
          next[index] = data.task
          return { ...prev, [owner]: next }
        }
        return { ...prev, [owner]: [data.task, ...list] }
      })
      const agentId = selectedAgentId()
      if (agentId && data.task.agentId === agentId) {
        setTasks((prev) => {
          const index = prev.findIndex((t) => t.id === data.task.id)
          if (index >= 0) {
            const next = [...prev]
            next[index] = data.task
            return next
          }
          return [data.task, ...prev]
        })
      }
    })

    const unsubBrowserTab = window.orchbot.onBrowserTabUpdated((updatedTab) => {
      const agentId = selectedAgentId()
      if (!agentId || updatedTab.agentId !== agentId) return
      const previous = browserTabs().find((tab) => tab.id === updatedTab.id)
      setBrowserTabs((prev) => {
        const index = prev.findIndex((t) => t.id === updatedTab.id)
        if (index >= 0) {
          const next = [...prev]
          next[index] = updatedTab
          return next
        }
        return [...prev, updatedTab]
      })
      if (!previous || previous.url !== updatedTab.url) {
        setActiveTabId(updatedTab.id)
        setBrowserUrlInput(updatedTab.url)
        setMiniBrowserOpen(true)
        return
      }
      if (activeTabId() === updatedTab.id) setBrowserUrlInput(updatedTab.url)
    })

    const unsubCronTriggered = window.orchbot.onScheduledTaskTriggered?.((task) => {
      const agentId = selectedAgentId()
      if (agentId && task.agentId === agentId) {
        loadScheduledTasks(agentId)
      }
    })

    onCleanup(() => {
      unsubChunk()
      unsubFinished()
      unsubError()
      unsubTask()
      unsubBrowserTab()
      unsubCronTriggered?.()
    })
  })

  createEffect(() => {
    const id = selectedAgentId()
    const threadId = activeThread()?.id
    const current = settings()
    if (!id || !current.restoreWorkspace) return
    if (current.lastAgentId === id && current.lastThreadId === threadId) return
    void updateSettings({ lastAgentId: id, lastThreadId: threadId })
  })

  // Efeito quando troca de agente selecionado
  createEffect(() => {
    const id = selectedAgentId()
    if (id) {
      setStreamingText('')
      setIsStreaming(false)
      setChatError(null)
      setStagedFiles([])
      setBrowserInspectData(null)
      setBrowserScreenshotUrl(null)
      setMiniBrowserOpen(false)
      setSearchResults(null)
      setSearchQuery('')
      loadThreadAndMessages(id)
      loadQueue(id)
      loadBrowserTabs(id)
      loadWorkspaceRulesData(id)
      loadScheduledTasks(id)
      handleIndexWorkspace(id)
    }
  })

  const currentAgent = () => {
    const id = selectedAgentId()
    return agents().find((a) => a.id === id) || null
  }

  const currentActiveTab = () => {
    const id = activeTabId()
    return browserTabs().find((t) => t.id === id) || null
  }

  const otherAgents = () => {
    const id = selectedAgentId()
    return coworkers().filter((a) => a.id !== id)
  }

  const pendingTasksCount = () => {
    return tasks().filter((t) => t.status === 'pending' || t.status === 'running').length
  }

  const filteredMentionAgents = createMemo(() => {
    const q = mentionQuery()
    if (q === null) return []
    const others = otherAgents()
    if (!q.trim()) return others
    const lower = q.toLowerCase()
    return others.filter(
      (a) => a.name.toLowerCase().includes(lower) || Boolean(a.role?.toLowerCase().includes(lower)),
    )
  })

  const updateMentionState = (textarea: HTMLTextAreaElement) => {
    const pos = textarea.selectionStart ?? 0
    const val = textarea.value
    const beforeCursor = val.slice(0, pos)
    const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor)
    if (match && otherAgents().length > 0) {
      setMentionQuery(match[1])
      setMentionSelectedIndex(0)
    } else {
      setMentionQuery(null)
    }
  }

  const applyMention = (teammate: Agent) => {
    const textarea = chatTextareaRef
    const val = inputText()
    const pos = textarea?.selectionStart ?? val.length
    const beforeCursor = val.slice(0, pos)
    const afterCursor = val.slice(pos)
    const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor)

    const mentionText = teammate.name.includes(' ') ? `@"${teammate.name}" ` : `@${teammate.name} `

    let newText: string
    let newCursorPos: number
    if (match) {
      const atIndex = match.index + (match[0].startsWith('@') ? 0 : 1)
      newText = val.slice(0, atIndex) + mentionText + afterCursor
      newCursorPos = atIndex + mentionText.length
    } else {
      newText = (val ? `${val.trimEnd()} ` : '') + mentionText
      newCursorPos = newText.length
    }

    setInputText(newText)
    setMentionQuery(null)

    setTimeout(() => {
      if (chatTextareaRef) {
        chatTextareaRef.focus()
        chatTextareaRef.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }

  const handleProviderChange = (p: SupportedProvider) => {
    setProvider(p)
    const conn = connections().find((c) => c.providerId === p)
    if (conn) {
      setModel(conn.defaultModel)
    } else {
      setModel(DEFAULT_PROVIDER_MODELS[p] ?? '')
    }
  }

  const handleToggleConnection = async (conn: ProviderConnection, enabled: boolean) => {
    // Marca na hora: recarregar as conexões testa todos os CLIs e leva segundos.
    setConnections((prev) =>
      prev.map((c) => (c.providerId === conn.providerId ? { ...c, enabled } : c)),
    )
    try {
      if (window.orchbot) {
        await window.orchbot.updateConnection({
          providerId: conn.providerId,
          enabled,
        })
        await loadConnections()
        await loadProviderStatuses()
      }
    } catch (err) {
      console.error('Erro ao alternar conexão:', err)
      void loadConnections()
    }
  }

  const handleSaveConnection = async (conn: ProviderConnection) => {
    const draft = connectionDrafts()[conn.providerId] || {}
    setSavingConnection(conn.providerId)
    try {
      if (window.orchbot) {
        await window.orchbot.updateConnection({
          providerId: conn.providerId,
          name: draft.name ?? conn.name,
          enabled: conn.enabled,
          apiKey: draft.apiKey,
          endpoint: draft.endpoint !== undefined ? draft.endpoint : conn.endpoint,
          defaultModel: draft.defaultModel !== undefined ? draft.defaultModel : conn.defaultModel,
          cliPath: draft.cliPath !== undefined ? draft.cliPath : conn.cliPath,
          cliArgs: draft.cliArgs !== undefined ? JSON.parse(draft.cliArgs || '[]') : conn.cliArgs,
          apiKeyEnv: draft.apiKeyEnv !== undefined ? draft.apiKeyEnv : conn.apiKeyEnv,
          effort: draft.effort !== undefined ? draft.effort : conn.effort,
        })
        await loadConnections()
        await loadProviderStatuses()
        setSaveMessage((prev) => ({
          ...prev,
          [conn.providerId]: 'Configurações salvas com sucesso!',
        }))
        setTimeout(() => {
          setSaveMessage((prev) => {
            const next = { ...prev }
            delete next[conn.providerId]
            return next
          })
        }, 3000)
        return true
      }
      return false
    } catch (err: unknown) {
      alert(`Erro ao salvar configurações: ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      setSavingConnection(null)
    }
  }

  const handleTestConnection = async (providerId: SupportedProvider) => {
    setTestingConnection(providerId)
    try {
      if (window.orchbot) {
        const res = await window.orchbot.testConnection(providerId)
        setTestResults((prev) => ({ ...prev, [providerId]: res }))
        if (res.status)
          setConnections((prev) =>
            prev.map((connection) =>
              connection.providerId === providerId ? { ...connection, ...res.status } : connection,
            ),
          )
      }
    } catch (err: unknown) {
      setTestResults((prev) => ({
        ...prev,
        [providerId]: {
          success: false,
          message: err instanceof Error ? err.message : String(err),
        },
      }))
    } finally {
      setTestingConnection(null)
    }
  }

  const toggleShowApiKey = (providerId: string) => {
    setShowApiKeys((prev) => ({
      ...prev,
      [providerId]: !prev[providerId],
    }))
  }

  const openProviderConfig = (providerId: SupportedProvider) => {
    openSettings('provedores')
    setConfigProviderId(providerId)
  }

  const handleDiscoverModels = async (providerId: SupportedProvider) => {
    if (!window.orchbot) return
    setDiscoveringProvider(providerId)
    try {
      await loadModelCatalog(providerId, undefined, true)
    } catch (err: unknown) {
      setDiscoverMessage((prev) => ({
        ...prev,
        [providerId]: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      setDiscoveringProvider(null)
    }
  }

  const configConnection = () => {
    const id = configProviderId()
    return id ? (connections().find((c) => c.providerId === id) ?? null) : null
  }

  const updateDraftField = (
    providerId: string,
    field:
      | 'name'
      | 'apiKey'
      | 'endpoint'
      | 'defaultModel'
      | 'cliPath'
      | 'cliArgs'
      | 'apiKeyEnv'
      | 'effort',
    value: string,
  ) => {
    setConnectionDrafts((prev) => ({
      ...prev,
      [providerId]: {
        ...prev[providerId],
        [field]: value,
      },
    }))
  }

  const handleSwitchProviderMidChat = async (agentId: string, newProvider: SupportedProvider) => {
    try {
      const conn = connections().find((c) => c.providerId === newProvider)
      const newModel = conn?.defaultModel || DEFAULT_PROVIDER_MODELS[newProvider] || ''

      if (window.orchbot) {
        const updated = await window.orchbot.updateAgent({
          id: agentId,
          provider: newProvider,
          model: newModel,
        })
        setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)))
      }
    } catch (err: unknown) {
      alert(`Erro ao trocar provedor: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSwitchAccount = async (agentId: string, accountId: string) => {
    try {
      const updated = await window.orchbot.updateAgent({
        id: agentId,
        accountId: accountId || null,
      })
      setAgents((previous) => previous.map((item) => (item.id === agentId ? updated : item)))
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  const handleSwitchModelMidChat = async (agentId: string, newModel: string) => {
    try {
      if (window.orchbot) {
        const agent = agents().find((item) => item.id === agentId)
        const info =
          agent &&
          modelCatalogs()[catalogKey(agent.provider, agent.accountId)]?.find(
            (item) => item.id === newModel,
          )
        const effort = agent?.effort
        const updated = await window.orchbot.updateAgent({
          id: agentId,
          model: newModel,
          effort:
            effort && info?.supportedEfforts && !info.supportedEfforts.includes(effort)
              ? (info.defaultEffort ?? info.supportedEfforts[0] ?? null)
              : effort,
        })
        setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)))
      }
    } catch (err: unknown) {
      alert(`Erro ao trocar modelo: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSwitchAutonomyLevel = async (agentId: string, newLevel: AutonomyLevel) => {
    try {
      if (window.orchbot) {
        const updated = await window.orchbot.updateAgent({
          id: agentId,
          autonomyLevel: newLevel,
        })
        setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)))
      }
    } catch (err: unknown) {
      alert(
        `Erro ao trocar nível de autonomia: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const applyCoworkerTemplate = (tpl: CoworkerTemplate) => {
    setName(tpl.name)
    setNewAvatar(tpl.avatar)
    setAgentRole(tpl.role)
    setDescription(tpl.description)
    setInstructions(templateInstructions(tpl))
    setAutonomyLevel(tpl.autonomyLevel)
    if (tpl.effort) setAgentEffort(tpl.effort)
    setDraftNote(`Perfil "${tpl.name}" aplicado. Ajuste se quiser e clique em Criar agente.`)
  }

  const openNewAgent = (tpl?: CoworkerTemplate) => {
    const first = principalConnection(connections(), settings().defaultProvider)
    setProvider(first?.providerId ?? 'codex')
    setModel(first?.defaultModel ?? DEFAULT_PROVIDER_MODELS.codex)
    if (tpl && 'instructions' in tpl) {
      applyCoworkerTemplate(tpl)
    } else {
      setDraftNote('')
    }
    setShowModal(true)
  }

  const PrincipalProviderSelect = () => (
    <label class="principal-provider">
      <span>Provedor principal</span>
      <select
        class="settings-select"
        value={principalConnection(connections(), settings().defaultProvider)?.providerId ?? ''}
        disabled={!connections().some((c) => c.enabled)}
        onChange={(e) => updateSettings({ defaultProvider: e.currentTarget.value })}
      >
        <Show when={!connections().some((c) => c.enabled)}>
          <option value="">Ative um provedor primeiro</option>
        </Show>
        <For each={connections().filter((c) => c.enabled)}>
          {(c) => <option value={c.providerId}>{c.name}</option>}
        </For>
      </select>
    </label>
  )

  // Escolha única da primeira abertura; nada vem marcado.
  const [setupChoice, setSetupChoice] = createSignal<SupportedProvider | ''>('')
  const [savingSetup, setSavingSetup] = createSignal(false)
  const [setupError, setSetupError] = createSignal('')
  const readyProviders = createMemo(() => connections().filter((c) => c.readiness === 'ready'))
  const otherProviders = createMemo(() => connections().filter((c) => c.readiness !== 'ready'))

  const finishProvidersSetup = async (choice: SupportedProvider | '') => {
    setSavingSetup(true)
    setSetupError('')
    try {
      if (choice && window.orchbot) {
        // O coordenador nasce no boot com a 1ª IA ativa; passa para a escolhida.
        const f = foreman()
        if (f && f.provider !== choice) await handleSwitchProviderMidChat(f.id, choice)
        setBoardProviderId('')
        setBoardModel('')
        // Começa só com a escolhida; provedores de outros agentes que já existem continuam ativos.
        const inUse = new Set(
          agents()
            .filter((a) => !isForeman(a))
            .map((a) => a.provider),
        )
        const next = connections().map((c) => ({
          ...c,
          enabled: c.providerId === choice || (c.enabled && inUse.has(c.providerId)),
        }))
        await Promise.all(
          next.map((c, i) =>
            c.enabled === connections()[i].enabled
              ? undefined
              : window.orchbot.updateConnection({ providerId: c.providerId, enabled: c.enabled }),
          ),
        )
        setConnections(next)
      }
      setSettings(
        await window.orchbot.updateSettings({ providersSetupDone: true, defaultProvider: choice }),
      )
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setSavingSetup(false)
    }
    // Fora do caminho da janela: recarregar testa todos os CLIs e leva segundos.
    if (choice) {
      void loadConnections()
      void loadProviderStatuses()
    }
    return true
  }

  const SetupProvider = (props: { connection: ProviderConnection }) => (
    <div class="setup-provider">
      <button
        type="button"
        class="provider-card"
        classList={{ selected: setupChoice() === props.connection.providerId }}
        aria-pressed={setupChoice() === props.connection.providerId}
        onClick={() => setSetupChoice(props.connection.providerId)}
      >
        <span class="provider-card-name">{props.connection.name}</span>
        <span class="provider-card-meta">{providerStatusLabel(props.connection)}</span>
      </button>
      <Show when={props.connection.readiness !== 'ready'}>
        <p class="setup-provider-hint">Confira a instalação e o login na configuração.</p>
        <button
          type="button"
          class="btn-link"
          aria-label={`Configurar ${props.connection.name}`}
          disabled={savingSetup()}
          onClick={async () => {
            if (await finishProvidersSetup('')) openProviderConfig(props.connection.providerId)
          }}
        >
          Configurar
        </button>
      </Show>
    </div>
  )

  const handleCreateAgent = async (e: Event) => {
    e.preventDefault()
    setErrorMessage(null)
    setLoading(true)

    try {
      if (!window.orchbot) {
        throw new Error('API do Orchbot não disponível no window')
      }

      const newAgent = await window.orchbot.createAgent({
        name: name(),
        avatar: newAvatar() || undefined,
        role: agentRole(),
        description: description().trim() || undefined,
        projectId: agentProjectId() || undefined,
        provider: provider(),
        accountId: newAccountId() || undefined,
        model: model(),
        effort: agentEffort() || undefined,
        contextMode: agentContextMode(),
        browserAccess: agentBrowserAccess(),
        localScripts:
          capLocalScripts() === 'on' ? true : capLocalScripts() === 'off' ? false : undefined,
        startsNewChats:
          capStartsChats() === 'on' ? true : capStartsChats() === 'off' ? false : undefined,
        showPlanBeforeLongTasks:
          capShowPlan() === 'on' ? true : capShowPlan() === 'off' ? false : undefined,
        steerMode:
          capSteer() === 'imediato' ? 'imediato' : capSteer() === 'fila' ? 'fila' : undefined,
        computerUse: capComputer() === 'on' ? true : capComputer() === 'off' ? false : undefined,
        workspacePath: workspacePath(),
        instructions: instructions(),
        autonomyLevel: autonomyLevel(),
      })

      await loadAgents()
      setSelectedAgentId(newAgent.id)
      setActiveSection('agents')
      setShowModal(false)

      // Limpar formulário
      setName('')
      setNewAvatar('')
      setAiPrompt('')
      setDraftNote('')
      setAgentRole('worker')
      setDescription('')
      setAgentProjectId('')
      setAgentEffort('')
      setCapLocalScripts('')
      setCapStartsChats('')
      setCapShowPlan('')
      setCapSteer('')
      setCapComputer('')
      setAgentContextMode('padrao')
      setAgentBrowserAccess(true)
      setInstructions('')
      setAutonomyLevel('autonomous')
      setWorkspacePath('')
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteAgent = async (id: string) => {
    if (!confirm('Deseja realmente remover este agente?')) return

    try {
      if (window.orchbot) {
        await window.orchbot.deleteAgent(id)
        if (selectedAgentId() === id) {
          setSelectedAgentId(null)
          setActiveThread(null)
          setAgentThreads([])
          setMessages([])
          setTasks([])
        }
        await loadAgents()
      }
    } catch (err) {
      alert(`Erro ao deletar agente: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSelectFiles = async () => {
    if (!window.orchbot) return
    try {
      const files = await window.orchbot.selectFiles()
      if (files.length > 0) {
        setStagedFiles((prev) => [...prev, ...files])
      }
    } catch (err) {
      console.error('Erro ao selecionar arquivos:', err)
    }
  }

  const removeStagedFile = (index: number) => {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleOpenFile = async (filePath: string) => {
    if (!window.orchbot) return
    try {
      await window.orchbot.openAttachment(filePath)
    } catch (err) {
      console.error('Erro ao abrir anexo:', err)
    }
  }

  const handleSendMessage = async (e: Event) => {
    e.preventDefault()
    const text = inputText().trim()
    const thread = activeThread()
    const agent = currentAgent()
    if (!text || !thread || !agent) return

    const parsed = parseComposerInput(text, otherAgents())

    // Comandos rápidos (/quadro, /equipe, /novo-topico, /limpar, /delegar)
    if (parsed.kind === 'slash') {
      if (parsed.command === 'quadro') {
        setInputText('')
        setActiveSection('board')
        return
      }
      if (parsed.command === 'equipe') {
        setInputText('')
        handleOpenDelegationModal()
        return
      }
      if (parsed.command === 'novo-topico') {
        setInputText('')
        await handleCreateThread(parsed.argumentText || undefined)
        return
      }
      if (parsed.command === 'limpar') {
        setInputText('')
        await handleResetCliSession()
        return
      }
      if (parsed.command === 'delegar') {
        setInputText('')
        if (parsed.targetAgent && parsed.argumentText) {
          try {
            await window.orchbot.delegateTask({
              fromAgentId: agent.id,
              toAgentId: parsed.targetAgent.id,
              prompt: parsed.argumentText,
            })
            void refreshAgentState(parsed.targetAgent.id)
            setMessages((prev) => [
              ...prev,
              {
                id: `delegated-${Date.now()}`,
                threadId: thread.id,
                role: 'user',
                text: `🤝 [DELEGAÇÃO ENVIADA PARA ${parsed.targetAgent?.name}]\n${parsed.argumentText}`,
                createdAt: new Date().toISOString(),
              },
            ])
            scrollToBottom()
          } catch (err: unknown) {
            setChatError(err instanceof Error ? err.message : String(err))
          }
          return
        }
        handleOpenDelegationModal(parsed.targetAgent?.id, parsed.argumentText)
        return
      }
    }

    // Menção direta @NomeDoAgente <tarefa> -> Delegação instantânea em 1 passo
    if (parsed.kind === 'mention' && parsed.targetAgent && parsed.argumentText) {
      setInputText('')
      setChatError(null)
      try {
        await window.orchbot.delegateTask({
          fromAgentId: agent.id,
          toAgentId: parsed.targetAgent.id,
          prompt: parsed.argumentText,
        })
        void refreshAgentState(parsed.targetAgent.id)
        setMessages((prev) => [
          ...prev,
          {
            id: `delegated-${Date.now()}`,
            threadId: thread.id,
            role: 'user',
            text: `🤝 [DELEGAÇÃO DIRETA PARA @${parsed.targetAgent?.name}]\n${parsed.argumentText}`,
            createdAt: new Date().toISOString(),
          },
        ])
        scrollToBottom()
      } catch (err: unknown) {
        setChatError(err instanceof Error ? err.message : String(err))
      }
      return
    }

    const filePaths = stagedFiles().map((f) => f.filePath)

    setInputText('')
    setStagedFiles([])
    setChatError(null)

    try {
      if (window.orchbot) {
        const res = await window.orchbot.sendMessage(thread.id, text, filePaths)
        setMessages((prev) => [...prev, res.userMessage])
        setTasks((prev) => [res.task, ...prev])
        scrollToBottom()
      }
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleOpenDelegationModal = (preferredTargetId?: string, initialPrompt?: string) => {
    const others = otherAgents()
    if (others.length === 0) {
      alert('Você precisa ter pelo menos mais um agente cadastrado para delegar tarefas.')
      return
    }
    setDelegationTargetId(preferredTargetId || others[0].id)
    setDelegationPrompt(initialPrompt ?? '')
    setDelegationError(null)
    setShowDelegationModal(true)
  }

  const handleExecuteDelegation = async (e: Event) => {
    e.preventDefault()
    const from = currentAgent()
    const toId = delegationTargetId()
    const prompt = delegationPrompt().trim()
    if (!from || !toId || !prompt || !window.orchbot) return

    setDelegationLoading(true)
    setDelegationError(null)

    try {
      await window.orchbot.delegateTask({
        fromAgentId: from.id,
        toAgentId: toId,
        prompt,
      })
      void refreshAgentState(toId)
      setShowDelegationModal(false)
      const targetName = agents().find((a) => a.id === toId)?.name ?? 'especialista'
      const activeT = activeThread()
      if (activeT) {
        setMessages((prev) => [
          ...prev,
          {
            id: `delegated-${Date.now()}`,
            threadId: activeT.id,
            role: 'user',
            text: `🤝 [DELEGAÇÃO ENVIADA PARA ${targetName}]\n${prompt}`,
            createdAt: new Date().toISOString(),
          },
        ])
        scrollToBottom()
      }
    } catch (err: unknown) {
      setDelegationError(err instanceof Error ? err.message : String(err))
    } finally {
      setDelegationLoading(false)
    }
  }

  // --- Quadro da Equipe & Despacho Rápido (Foreman) ---
  const boardSummary = () => computeBoardSummary(coworkers(), agentStates(), sidebarChannels())

  const filteredBoardAgents = () => {
    const projFilter = boardFilterProject()
    return coworkers().filter((a) => {
      if (projFilter !== 'all') {
        if (projFilter === 'none' && a.projectId) return false
        if (projFilter !== 'none' && a.projectId !== projFilter) return false
      }
      return agentMatchesQuery(a)
    })
  }

  const getDefaultProviderAndModel = (): { provider: SupportedProvider; model: string } => {
    const first =
      connections().find((c) => c.enabled && c.providerId === boardProviderId()) ??
      principalConnection(connections(), settings().defaultProvider)
    const prov = first?.providerId ?? 'codex'
    const mod =
      first?.defaultModel ?? DEFAULT_PROVIDER_MODELS[prov] ?? DEFAULT_PROVIDER_MODELS.codex
    return { provider: prov, model: mod }
  }

  const supportsEffort = (provider: string) =>
    !!connections().find((c) => c.providerId === provider)?.supportsEffort

  const currentBoardProvider = createMemo<SupportedProvider>(() => {
    if (boardProviderId()) return boardProviderId() as SupportedProvider
    const f = foreman()
    if (f) return f.provider
    return getDefaultProviderAndModel().provider
  })

  const currentBoardModel = createMemo(() => {
    if (boardModel()) return boardModel()
    const f = foreman()
    if (f) return f.model
    return getDefaultProviderAndModel().model
  })

  const currentBoardEffort = createMemo<ProviderEffort | ''>(() => {
    if (boardEffort() !== '') return boardEffort()
    const f = foreman()
    if (f?.effort) return f.effort
    return ''
  })

  const handleBoardProviderChange = async (prov: SupportedProvider) => {
    setBoardProviderId(prov)
    setIsCustomBoardModel(false)
    const conn = connections().find((c) => c.providerId === prov)
    const newModel = conn?.defaultModel || DEFAULT_PROVIDER_MODELS[prov] || ''
    setBoardModel(newModel)
    setBoardEffort('')
    const f = foreman()
    if (f && window.orchbot) {
      await handleSwitchProviderMidChat(f.id, prov)
      await handleSwitchModelMidChat(f.id, newModel)
    }
  }

  const handleBoardModelChange = async (newModel: string) => {
    setBoardModel(newModel)
    const f = foreman()
    if (f && window.orchbot) {
      await handleSwitchModelMidChat(f.id, newModel)
    }
  }

  const handleBoardEffortChange = async (effort: ProviderEffort | '') => {
    setBoardEffort(effort)
    const f = foreman()
    if (f && window.orchbot) {
      await handleSwitchEffort(f.id, effort)
    }
  }

  // Várias equipes = vários líderes: "Líder", "Líder 2", ...
  const uniqueAgentName = (base: string) => {
    const taken = new Set(agents().map((a) => a.name.toLowerCase()))
    let n = 1
    let name = base
    while (taken.has(name.toLowerCase())) name = `${base} ${++n}`
    return name
  }

  const handleQuickHireTemplate = async (tpl: CoworkerTemplate, openChatAfter = false) => {
    if (!window.orchbot) {
      openNewAgent(tpl)
      return
    }
    setInstantHiringId(tpl.id)
    try {
      const { provider: prov, model: mod } = getDefaultProviderAndModel()
      const projectFilter = boardFilterProject()
      const projectId =
        projectFilter !== 'all' && projectFilter !== 'none' ? projectFilter : undefined
      const created = await window.orchbot.createAgent({
        name: tpl.role === 'orchestrator' ? uniqueAgentName(tpl.name) : tpl.name,
        avatar: tpl.avatar,
        role: tpl.role,
        description: tpl.description,
        projectId,
        provider: prov,
        model: mod,
        effort: tpl.effort,
        contextMode: 'padrao',
        browserAccess: true,
        workspacePath: '',
        instructions: templateInstructions(tpl),
        autonomyLevel: tpl.autonomyLevel,
      })
      await loadAgents()
      setSelectedAgentId(created.id)
      if (openChatAfter) {
        setActiveSection('agents')
      } else {
        setBoardDispatchMsg(
          `✅ ${created.avatar ?? '🤖'} ${created.name} foi adicionado à sua equipe! Clique em "Conversar" ou envie uma missão acima.`,
        )
        setTimeout(() => setBoardDispatchMsg(null), 5000)
      }
    } catch (err: unknown) {
      alert(`Erro ao adicionar agente: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setInstantHiringId(null)
    }
  }

  const handleQuickHireStarterTeam = async (preset: StarterTeamPreset) => {
    if (!window.orchbot) return
    setInstantHiringId(preset.id)
    try {
      const { provider: prov, model: mod } = getDefaultProviderAndModel()
      const projectFilter = boardFilterProject()
      const projectId =
        projectFilter !== 'all' && projectFilter !== 'none' ? projectFilter : undefined

      for (const tplId of preset.templateIds) {
        const tpl = COWORKER_TEMPLATES.find((t) => t.id === tplId)
        if (!tpl) continue
        const existing = coworkers().find(
          (a) => a.name.toLowerCase() === tpl.name.toLowerCase() && a.projectId === projectId,
        )
        if (existing) continue
        await window.orchbot.createAgent({
          name: tpl.name,
          avatar: tpl.avatar,
          role: tpl.role,
          description: tpl.description,
          projectId,
          provider: prov,
          model: mod,
          effort: tpl.effort,
          contextMode: 'padrao',
          browserAccess: true,
          workspacePath: '',
          instructions: templateInstructions(tpl),
          autonomyLevel: tpl.autonomyLevel,
        })
      }

      await loadAgents()
      setBoardDispatchMsg(
        `🎉 "${preset.title}" pronta. Peça na caixa acima e o coordenador distribui o trabalho.`,
      )
      setTimeout(() => setBoardDispatchMsg(null), 6000)
    } catch (err: unknown) {
      alert(`Erro ao montar equipe: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setInstantHiringId(null)
    }
  }

  const handleBoardForemanDispatch = async (e: Event) => {
    e.preventDefault()
    const prompt = boardForemanPrompt().trim()
    if (!prompt || !window.orchbot) return

    const f = foreman()
    if (!f) {
      alert('Conecte uma inteligência artificial para o coordenador poder falar.')
      return
    }

    try {
      if (boardModel() && f.model !== boardModel()) {
        await window.orchbot.updateAgent({ id: f.id, model: boardModel() })
      }
      if (boardEffort() !== '' && (f.effort ?? '') !== boardEffort()) {
        await window.orchbot.updateAgent({
          id: f.id,
          effort: boardEffort() as ProviderEffort,
        })
      }
    } catch {
      // continua com o envio caso a atualização falhe silenciosamente
    }

    const projectFilter = boardFilterProject()
    const projectId =
      projectFilter !== 'all' && projectFilter !== 'none' ? projectFilter : undefined
    const projectName = projectId ? projects().find((p) => p.id === projectId)?.name : undefined

    try {
      const threads = await window.orchbot.getThreads(f.id)
      let targetThread = threads.find((t) => (t.projectId ?? undefined) === projectId)
      if (!targetThread) {
        targetThread = await window.orchbot.createThread(
          f.id,
          projectName ? `Pedido · ${projectName}` : 'Pedido ao coordenador',
          projectId,
        )
      }
      await window.orchbot.sendMessage(targetThread.id, prompt, [])
      setBoardForemanPrompt('')
      setBoardDispatchMsg('Pedido enviado ao coordenador. Abrindo a conversa…')
      void refreshAgentState(f.id)
      openAgent(f.id)
      setTimeout(() => setBoardDispatchMsg(null), 4000)
    } catch (err: unknown) {
      alert(`Erro ao enviar pedido: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // --- Aprovações, Foreman (montar equipe), webhooks e cadeia ---
  const loadApprovals = async () => {
    if (window.orchbot) setApprovals(await window.orchbot.listApprovals())
  }

  const decideApproval = async (approval: Approval, approved: boolean) => {
    try {
      await window.orchbot.decideApproval(approval.id, approved)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err))
    }
    await loadApprovals()
  }

  const ApprovalCard = (p: { approval: Approval }) => (
    <div class="approval-card">
      <strong>
        ✋ {agents().find((a) => a.id === p.approval.agentId)?.name ?? 'Um agente'} pede sua
        aprovação
      </strong>
      <div class="approval-card-text">{p.approval.text}</div>
      <div class="approval-card-actions">
        <button
          type="button"
          class="btn-primary"
          onClick={() => void decideApproval(p.approval, true)}
        >
          Aprovar
        </button>
        <button
          type="button"
          class="btn-secondary"
          onClick={() => void decideApproval(p.approval, false)}
        >
          Recusar
        </button>
      </div>
    </div>
  )

  const handleDraftTeam = async () => {
    const prompt = boardForemanPrompt().trim()
    if (!prompt || !window.orchbot) return
    setTeamDrafting(true)
    try {
      setTeamDraft(await window.orchbot.draftTeam(prompt))
    } catch (err: unknown) {
      alert(`Erro ao montar a equipe: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTeamDrafting(false)
    }
  }

  /** Contrata só os especialistas e manda o pedido ao coordenador fixo. */
  const handleHireTeam = async () => {
    const team = teamDraft()
    if (!team || !window.orchbot) return
    setTeamDrafting(true)
    try {
      const { provider: prov, model: mod } = getDefaultProviderAndModel()
      const projectFilter = boardFilterProject()
      const projectId =
        projectFilter !== 'all' && projectFilter !== 'none' ? projectFilter : undefined
      for (const draft of team) {
        if (draft.role === 'orchestrator') continue
        await window.orchbot.createAgent({
          name: draft.name,
          avatar: draft.avatar,
          role: 'worker',
          description: draft.description,
          projectId,
          provider: prov,
          model: mod,
          effort: 'medium',
          contextMode: 'padrao',
          browserAccess: true,
          workspacePath: '',
          instructions: draft.instructions,
          autonomyLevel: 'autonomous',
        })
      }
      await loadAgents()
      setTeamDraft(null)
      await handleBoardForemanDispatch(new Event('submit'))
    } catch (err: unknown) {
      alert(`Erro ao contratar a equipe: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTeamDrafting(false)
    }
  }

  const openAutomationModal = async () => {
    const agent = currentAgent()
    if (!agent || !window.orchbot) return
    setShowAutomationModal(true)
    setWebhookBase(await window.orchbot.getWebhookBaseUrl())
    setWebhooks(await window.orchbot.listWebhookTriggers(agent.id))
  }

  const handleSetHandoff = async (agentId: string, handoffAgentId: string) => {
    try {
      await window.orchbot.updateAgent({ id: agentId, handoffAgentId: handoffAgentId || null })
      await loadAgents()
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  const handleCreateWebhook = async (e: Event) => {
    e.preventDefault()
    const agent = currentAgent()
    if (!agent) return
    try {
      await window.orchbot.createWebhookTrigger(agent.id, webhookTitle(), webhookInstruction())
      setWebhookTitle('')
      setWebhookInstruction('')
      setWebhooks(await window.orchbot.listWebhookTriggers(agent.id))
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDeleteWebhook = async (trigger: WebhookTrigger) => {
    if (
      !confirm(
        `Apagar o webhook "${trigger.title}"? Quem usa esta URL deixa de conseguir chamar o agente.`,
      )
    )
      return
    await window.orchbot.deleteWebhookTrigger(trigger.id)
    setWebhooks(await window.orchbot.listWebhookTriggers(trigger.agentId))
  }

  const handleToggleAgentQueueFromBoard = async (agent: Agent) => {
    if (!window.orchbot) return
    const paused = allAgentPaused()[agent.id] ?? false
    if (paused) {
      await window.orchbot.resumeQueue(agent.id)
    } else {
      await window.orchbot.pauseQueue(agent.id)
    }
    await refreshAgentState(agent.id)
    if (selectedAgentId() === agent.id) {
      await loadQueue(agent.id)
    }
  }

  // --- Paleta de Comandos Handlers ---
  const paletteItems = () => {
    const all = buildCommandPaletteItems(agents(), projects(), agentStates())
    return filterPaletteItems(all, paletteQuery())
  }

  const executePaletteItem = (item: PaletteItem) => {
    setShowCommandPalette(false)
    if (item.kind === 'agent' && item.agentId) {
      openAgent(item.agentId)
      return
    }
    if (item.kind === 'template' && item.templateId) {
      const tpl = COWORKER_TEMPLATES.find((t) => t.id === item.templateId)
      if (tpl) void handleQuickHireTemplate(tpl, true)
      return
    }
    if (item.kind === 'section' && item.sectionId) {
      setActiveSection(item.sectionId)
      return
    }
    if (item.kind === 'action') {
      if (item.actionId === 'new-agent') openNewAgent()
      else if (item.actionId === 'new-channel') {
        setActiveSection('channels')
        setCreatingChannel(true)
      } else if (item.actionId === 'new-project') setShowProjectModal(true)
      else if (item.actionId === 'delegate') handleOpenDelegationModal()
      else if (item.actionId === 'search-memory') setShowSearchModal(true)
      else if (item.actionId === 'settings') openSettings()
      else if (item.actionId === 'providers') openSettings('provedores')
    }
  }

  const handleResetCliSession = async () => {
    const thread = activeThread()
    if (!thread || !window.orchbot) return
    if (
      !confirm(
        'Iniciar uma nova memória de conversa? As mensagens atuais continuarão salvas na tela.',
      )
    )
      return
    try {
      await window.orchbot.resetProviderSession(thread.id)
      setChatError('')
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error))
    }
  }

  const handleInterrupt = async () => {
    const thread = activeThread()
    if (!thread) return

    try {
      if (window.orchbot) {
        await window.orchbot.interruptTurn(thread.id)
        setIsStreaming(false)
        if (streamingText()) {
          setMessages((prev) => [
            ...prev,
            {
              id: `interrupted-${Date.now()}`,
              threadId: thread.id,
              role: 'assistant',
              text: `${streamingText()}\n\n[Execução interrompida pelo usuário]`,
              createdAt: new Date().toISOString(),
            },
          ])
          setStreamingText('')
        }
      }
    } catch (err) {
      console.error('Erro ao interromper turno:', err)
    }
  }

  const handleSelectThread = async (thread: Thread) => {
    setActiveThread(thread)
    setChatError(null)
    setStreamingText('')
    setIsStreaming(false)
    if (window.orchbot) {
      const msgs = await window.orchbot.getMessages(thread.id)
      setMessages(msgs)
      setTimeout(scrollToBottom, 50)
    }
  }

  const handleCreateThread = async (presetTitle?: string) => {
    const agentId = selectedAgentId()
    if (!agentId || !window.orchbot) return
    const defaultTitle =
      presetTitle ||
      (agentThreads().length === 1 && agentThreads()[0].title === 'Conversa Inicial'
        ? 'Nova Tarefa'
        : `Conversa ${agentThreads().length + 1}`)

    const titlePrompt = window.prompt(
      'Nome da nova conversa (ex: Criar site, Pesquisar preços, Revisar texto):',
      defaultTitle,
    )
    if (titlePrompt === null) return
    const finalTitle = titlePrompt.trim() || defaultTitle

    try {
      const newThread = await window.orchbot.createThread(agentId, finalTitle)
      await loadThreadAndMessages(agentId, newThread.id)
    } catch (err) {
      console.error('Erro ao criar conversa:', err)
    }
  }

  const handleDeleteThread = async (thread: Thread, e: MouseEvent) => {
    e.stopPropagation()
    const agentId = selectedAgentId()
    if (!agentId || !window.orchbot) return
    if (agentThreads().length <= 1) {
      alert('Não é possível excluir a única conversa do agente.')
      return
    }
    const confirmed = window.confirm(
      `Deseja realmente excluir a conversa "${thread.title}"? Todas as mensagens dela serão apagadas.`,
    )
    if (!confirmed) return

    try {
      await window.orchbot.deleteThread(thread.id)
      const remaining = agentThreads().filter((t) => t.id !== thread.id)
      const nextThreadId = activeThread()?.id === thread.id ? remaining[0]?.id : activeThread()?.id
      await loadThreadAndMessages(agentId, nextThreadId)
    } catch (err) {
      console.error('Erro ao excluir conversa:', err)
    }
  }

  const handleRenameThread = async (thread: Thread, e: MouseEvent) => {
    e.stopPropagation()
    const agentId = selectedAgentId()
    if (!agentId || !window.orchbot) return
    const newTitle = window.prompt('Novo nome para esta conversa:', thread.title)
    if (!newTitle || newTitle.trim() === '' || newTitle.trim() === thread.title) return

    try {
      await window.orchbot.updateThreadTitle(thread.id, newTitle.trim())
      await loadThreadAndMessages(agentId, activeThread()?.id)
    } catch (err) {
      console.error('Erro ao renomear conversa:', err)
    }
  }

  const loadWorkspaceRulesData = async (agentId: string) => {
    try {
      if (window.orchbot) {
        const rules = await window.orchbot.getWorkspaceRules(agentId)
        setWorkspaceRules(rules)
      }
    } catch (err) {
      console.error('Erro ao buscar regras do workspace:', err)
    }
  }

  const handleIndexWorkspace = async (agentId?: string) => {
    const id = agentId || selectedAgentId()
    if (!id || !window.orchbot) return
    setIsIndexing(true)
    setIndexingMsg('Organizando arquivos da pasta para busca rápida...')
    try {
      const res = await window.orchbot.indexWorkspace(id)
      setIndexingMsg(`${res.indexedCount} arquivos prontos para busca!`)
      setTimeout(() => setIndexingMsg(null), 3000)
    } catch {
      setIndexingMsg('Erro ao indexar pasta')
      setTimeout(() => setIndexingMsg(null), 3000)
    } finally {
      setIsIndexing(false)
    }
  }

  const handleSearchMemory = async (e?: Event) => {
    e?.preventDefault()
    const id = selectedAgentId()
    const query = searchQuery().trim()
    if (!id || !query || !window.orchbot) return
    setIsSearching(true)
    try {
      const results = await window.orchbot.searchProjectMemory(id, query)
      setSearchResults(results)
    } catch (err) {
      console.error('Erro na busca:', err)
    } finally {
      setIsSearching(false)
    }
  }

  const handleSelectSearchResultThread = async (threadId: string) => {
    const thread = agentThreads().find((t) => t.id === threadId)
    if (thread) {
      await handleSelectThread(thread)
    }
    setShowSearchModal(false)
  }

  // --- Agendamentos & Tarefas em Background (Cron) Handlers ---
  const loadScheduledTasks = async (agentId?: string) => {
    try {
      const id = agentId || selectedAgentId()
      if (!id || !window.orchbot) return
      const list = await window.orchbot.getScheduledTasks(id)
      setScheduledTasks(list)
    } catch (err) {
      console.error('Erro ao carregar agendamentos:', err)
    }
  }

  const handleCreateScheduledTask = async (e: Event) => {
    e.preventDefault()
    const agentId = selectedAgentId()
    if (!agentId || !window.orchbot) return
    const title = cronFormTitle().trim()
    const prompt = cronFormPrompt().trim()
    const cronExpr = cronFormExpr().trim()

    if (!title || !prompt || !cronExpr) {
      alert('Preencha o nome da rotina, o que fazer e o horário.')
      return
    }

    try {
      await window.orchbot.createScheduledTask({
        agentId,
        title,
        prompt,
        cronExpression: cronExpr,
        taskType: cronFormType(),
        targetUrl: cronFormType() === 'browser_monitor' ? cronFormTargetUrl().trim() : undefined,
        threadId: cronFormThreadId() || activeThread()?.id,
      })

      setCronSuccessMsg('Rotina automática criada com sucesso!')
      setTimeout(() => setCronSuccessMsg(null), 3000)
      setCronFormTitle('')
      setCronFormPrompt('')
      setCronFormTargetUrl('')
      await loadScheduledTasks(agentId)
    } catch (err: unknown) {
      alert(`Erro ao criar agendamento: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleToggleScheduledTask = async (task: ScheduledTask) => {
    if (!window.orchbot) return
    try {
      await window.orchbot.updateScheduledTask({
        id: task.id,
        enabled: !task.enabled,
      })
      await loadScheduledTasks(task.agentId)
    } catch (err: unknown) {
      alert(`Erro ao alternar agendamento: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleRunScheduledTaskNow = async (task: ScheduledTask) => {
    if (!window.orchbot) return
    setCronRunningId(task.id)
    try {
      await window.orchbot.runScheduledTaskNow(task.id)
      setCronSuccessMsg(`Rotina "${task.title}" iniciada agora!`)
      setTimeout(() => setCronSuccessMsg(null), 3000)
      await loadScheduledTasks(task.agentId)
    } catch (err: unknown) {
      alert(`Erro ao disparar agendamento: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCronRunningId(null)
    }
  }

  const handleDeleteScheduledTask = async (task: ScheduledTask) => {
    if (!confirm(`Deseja realmente remover a rotina "${task.title}"?`)) return
    if (!window.orchbot) return
    try {
      await window.orchbot.deleteScheduledTask(task.id)
      await loadScheduledTasks(task.agentId)
    } catch (err: unknown) {
      alert(`Erro ao remover agendamento: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const applyCronPreset = (
    title: string,
    cron: string,
    type: ScheduledTaskType,
    prompt: string,
    url = '',
  ) => {
    setCronFormTitle(title)
    setCronFormExpr(cron)
    setCronFormType(type)
    setCronFormPrompt(prompt)
    setCronFormTargetUrl(url)
  }

  const togglePauseQueue = async () => {
    const agent = currentAgent()
    if (!agent || !window.orchbot) return

    if (isQueuePaused()) {
      await window.orchbot.resumeQueue(agent.id)
      setIsQueuePaused(false)
    } else {
      await window.orchbot.pauseQueue(agent.id)
      setIsQueuePaused(true)
    }
    void refreshAgentState(agent.id)
  }

  const handleCancelTask = async (taskId: string) => {
    if (!window.orchbot) return
    await window.orchbot.cancelTask(taskId)
    const agent = currentAgent()
    if (agent) loadQueue(agent.id)
  }

  const handleRetryTask = async (taskId: string) => {
    if (!window.orchbot) return
    await window.orchbot.retryTask(taskId)
    const agent = currentAgent()
    if (agent) loadQueue(agent.id)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (mentionQuery() !== null && filteredMentionAgents().length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionSelectedIndex((prev) => (prev + 1) % filteredMentionAgents().length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionSelectedIndex((prev) =>
          prev === 0 ? filteredMentionAgents().length - 1 : prev - 1,
        )
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const selected = filteredMentionAgents()[mentionSelectedIndex()]
        if (selected) {
          applyMention(selected)
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }

    if (e.key !== 'Enter' || e.shiftKey) return
    if (settings().sendShortcut === 'ctrl-enter' && !(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    handleSendMessage(e)
  }

  /** Agentes que precisam de atenção do usuário. */
  const needsYouAgents = () => coworkers().filter((a) => needsYou(agentStates()[a.id] ?? 'idle'))

  const openAgent = (agentId: string) => {
    setSelectedAgentId(agentId)
    setActiveSection('agents')
    if (agentStates()[agentId] === 'responded') setAgentState(agentId, 'idle')
  }

  const agentRow = (agent: Agent) => {
    const state = () => agentStates()[agent.id] ?? 'idle'
    return (
      <button
        type="button"
        class="agent-item"
        classList={{
          active: selectedAgentId() === agent.id && activeSection() === 'agents',
        }}
        onClick={() => openAgent(agent.id)}
        title={agent.name}
        aria-label={`${agent.name}${state() !== 'idle' ? `: ${AGENT_STATE_LABEL[state()]}` : ''}`}
      >
        <span class="agent-avatar" style={{ background: agentColor(agent.name) }}>
          {agent.avatar || initialsOf(agent.name)}
          <Show when={state() !== 'idle'}>
            <span class={`agent-status-dot ${state()}`} title={AGENT_STATE_LABEL[state()]} />
          </Show>
        </span>
        <span class="agent-item-copy">
          <div class="agent-item-top">
            <span class="agent-item-name">{agent.name}</span>
            <Show
              when={state() !== 'idle'}
              fallback={<span class="agent-item-date">{formatShortDate(agent.updatedAt)}</span>}
            >
              <span class={`agent-state ${state()}`}>{AGENT_STATE_LABEL[state()]}</span>
            </Show>
          </div>
          <div class="agent-item-workspace">{agent.description || 'Pronto para ajudar'}</div>
        </span>
      </button>
    )
  }

  createEffect(() => {
    const agent = currentAgent()
    if (agent && connections().some((c) => c.providerId === agent.provider && c.enabled))
      void loadModelCatalog(agent.provider, agent.accountId)
  })

  createEffect(() => {
    const prov = currentBoardProvider()
    if (connections().some((c) => c.providerId === prov && c.enabled)) void loadModelCatalog(prov)
  })

  createEffect(() => {
    if (showModal() && connections().some((c) => c.providerId === provider() && c.enabled))
      void loadModelCatalog(provider(), newAccountId() || undefined)
  })

  createEffect(() => {
    const selected = agentEffort()
    if (
      selected &&
      !effortsFor(provider(), model(), newAccountId() || undefined).some(
        ([value]) => value === selected,
      )
    )
      setAgentEffort('')
  })

  return (
    <div
      class="app-container"
      classList={{ 'compact-sidebar-layout': isSidebarCompact() }}
      style={{ zoom: settings().uiScale / 100 }}
    >
      <ConsentGate />
      <ThemeApplier
        customTheme={settings().customTheme}
        effectiveTheme={effectiveTheme() === 'light' ? 'light' : 'dark'}
      />
      <nav class="icon-rail" aria-label="Navegação principal">
        <button
          type="button"
          class="rail-logo"
          classList={{ active: activeSection() === 'board' }}
          style={{ background: settings().logoColor }}
          onClick={() => setActiveSection('board')}
          title="Início (Ctrl+1)"
          aria-label="Início — coordenador (Ctrl+1)"
          aria-current={activeSection() === 'board' ? 'page' : undefined}
        >
          ✦
          <Show when={boardSummary().working > 0}>
            <span class="rail-badge">{boardSummary().working}</span>
          </Show>
        </button>
        <For
          each={
            [
              ['agents', 'chat', 'Conversas (Ctrl+2)'],
              ['channels', 'channels', 'Grupos (Ctrl+3)'],
              ['skills', 'skills', 'Habilidades'],
            ] as const
          }
        >
          {([section, icon, label]) => (
            <button
              type="button"
              class="rail-btn"
              classList={{ active: activeSection() === section }}
              onClick={() => setActiveSection(section)}
              title={label}
              aria-label={label}
              aria-current={activeSection() === section ? 'page' : undefined}
            >
              <RailIcon name={icon} />
            </button>
          )}
        </For>
        <div class="rail-spacer" />
        <button
          type="button"
          class="rail-btn"
          onClick={() => openSettings('provedores')}
          title={
            connections().some((c) => c.enabled && c.readiness === 'ready')
              ? 'IA conectada'
              : 'Conectar inteligência artificial'
          }
          aria-label="Conexões de IA"
        >
          <span
            class={`status-dot rail-status ${connections().some((c) => c.readiness === 'ready' && c.enabled) ? 'online' : ''}`}
          />
        </button>
        <button
          type="button"
          class="rail-btn"
          onClick={() => {
            setPaletteQuery('')
            setPaletteIndex(0)
            setShowCommandPalette(true)
          }}
          title="Busca rápida (Ctrl+K)"
          aria-label="Busca rápida"
        >
          <RailIcon name="command" />
        </button>
        <button
          type="button"
          class="rail-btn"
          classList={{ active: settingsOpen() }}
          onClick={() => openSettings()}
          title="Configurações"
          aria-label="Configurações"
        >
          <RailIcon name="gear" />
        </button>
      </nav>
      <aside class="sidebar" classList={{ 'sidebar-compact': isSidebarCompact() }}>
        <div class="sidebar-header">
          <Show
            when={!isSidebarCompact()}
            fallback={
              <button
                type="button"
                class="btn-icon-gear sidebar-compact-search-btn"
                onClick={() => {
                  setPaletteQuery('')
                  setPaletteIndex(0)
                  setShowCommandPalette(true)
                }}
                title="Buscar (Ctrl+K)"
                aria-label="Buscar"
              >
                <RailIcon name="search" />
              </button>
            }
          >
            <label class="list-search">
              <RailIcon name="search" />
              <input
                type="search"
                placeholder="Buscar"
                value={listQuery()}
                onInput={(event) => setListQuery(event.currentTarget.value)}
                aria-label="Buscar agentes"
              />
            </label>
          </Show>
          <div class="sidebar-top-actions">
            <div class="menu-anchor" onKeyDown={(e) => e.key === 'Escape' && setShowNewMenu(false)}>
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={showNewMenu()}
                onClick={() => setShowNewMenu(!showNewMenu())}
                class="btn-icon-gear new-btn"
                title="Criar"
                aria-label="Criar"
              >
                +
              </button>
              <Show when={showNewMenu()}>
                <button
                  type="button"
                  class="menu-backdrop"
                  tabIndex={-1}
                  aria-label="Fechar menu"
                  onClick={() => setShowNewMenu(false)}
                />
                <div class="dropdown-menu" role="menu">
                  <button
                    type="button"
                    class="dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setShowNewMenu(false)
                      openNewAgent()
                    }}
                  >
                    Criar agente
                  </button>
                  <button
                    type="button"
                    class="dropdown-item"
                    role="menuitem"
                    disabled={agents().length === 0}
                    title="Reúna vários agentes em uma mesma sala para trabalharem juntos"
                    onClick={() => {
                      setShowNewMenu(false)
                      setActiveSection('channels')
                      setCreatingChannel(true)
                    }}
                  >
                    Novo grupo
                  </button>
                  <button
                    type="button"
                    class="dropdown-item"
                    role="menuitem"
                    title="Uma pasta para organizar seus agentes por assunto ou trabalho"
                    onClick={() => {
                      setShowNewMenu(false)
                      setShowProjectModal(true)
                    }}
                  >
                    Nova pasta de projeto
                  </button>
                </div>
              </Show>
            </div>
            <button
              type="button"
              class="btn-icon-gear sidebar-toggle-btn"
              onClick={toggleSidebarCompact}
              title={isSidebarCompact() ? 'Expandir lateral' : 'Recolher lateral'}
              aria-label={isSidebarCompact() ? 'Expandir lateral' : 'Recolher lateral'}
            >
              <RailIcon name={isSidebarCompact() ? 'chevron-right' : 'chevron-left'} />
            </button>
          </div>
        </div>

        <div class="agent-list">
          <Show when={needsYouAgents().length > 0}>
            <div class="project-group needs-you">
              <div class="project-group-header" title="Aguardando você">
                <span class="compact-group-indicator" title="Aguardando você">
                  <span class="compact-indicator-dot warning" />
                </span>
                <span class="project-group-name">Aguardando você</span>
                <span class="nav-badge">{needsYouAgents().length}</span>
              </div>
              <For each={needsYouAgents()}>{(agent) => agentRow(agent)}</For>
            </div>
          </Show>

          <Show
            when={coworkers().length > 0}
            fallback={
              <button
                type="button"
                class="agent-item"
                title="Coordenador"
                aria-label="Coordenador"
                onClick={() => setActiveSection('board')}
              >
                <span class="agent-avatar" style={{ background: settings().logoColor }}>
                  <RailIcon name="board" />
                </span>
                <span class="agent-item-copy">
                  <span class="agent-item-name">Coordenador</span>
                  <span class="agent-item-workspace">Descreva a tarefa para montar sua equipe</span>
                </span>
              </button>
            }
          >
            <For each={projects()}>
              {(project) => (
                <Show when={!listQuery().trim() || agentsOfProject(project.id).length > 0}>
                  <div class="project-group">
                    <div
                      class="project-group-header"
                      title={project.description || project.workspacePath || project.name}
                    >
                      <span class="compact-group-indicator" title={project.name}>
                        <RailIcon name="folder" />
                      </span>
                      <span class="project-group-name">{project.name}</span>
                      <span class="nav-badge">{agentsOfProject(project.id).length}</span>
                      <button
                        type="button"
                        class="btn-icon-gear small"
                        onClick={() => setBrainProject(project)}
                        title={`Cérebro de ${project.name}`}
                        aria-label={`Cérebro de ${project.name}`}
                      >
                        <RailIcon name="brain" />
                      </button>
                      <button
                        type="button"
                        class="btn-icon-gear small"
                        onClick={() => handleDeleteProject(project)}
                        title={`Remover pasta ${project.name}`}
                        aria-label={`Remover pasta ${project.name}`}
                      >
                        <RailIcon name="trash" />
                      </button>
                    </div>
                    <For each={agentsOfProject(project.id)}>{(agent) => agentRow(agent)}</For>
                  </div>
                </Show>
              )}
            </For>
            <Show when={agentsOfProject(null).length > 0}>
              <div class="project-group">
                <div class="project-group-header" title="Sua Equipe">
                  <span class="compact-group-indicator" title="Sua Equipe">
                    <RailIcon name="users" />
                  </span>
                  <span class="project-group-name">Sua Equipe</span>
                  <span class="nav-badge">{agentsOfProject(null).length}</span>
                </div>
                <For each={agentsOfProject(null)}>{(agent) => agentRow(agent)}</For>
              </div>
            </Show>
            <Show
              when={
                !!listQuery().trim() &&
                projects().every((project) => agentsOfProject(project.id).length === 0) &&
                agentsOfProject(null).length === 0
              }
            >
              <div class="list-empty">Nenhum agente encontrado.</div>
            </Show>
          </Show>

          <div class="project-group">
            <div class="project-group-header" title="Grupos">
              <Show when={isSidebarCompact()}>
                <button
                  type="button"
                  class="compact-group-link"
                  title="Grupos"
                  aria-label="Grupos"
                  onClick={() => setActiveSection('channels')}
                >
                  <RailIcon name="channels" />
                </button>
              </Show>
              <span class="project-group-name">Grupos</span>
              <button
                type="button"
                class="btn-icon-gear small"
                disabled={agents().length === 0}
                onClick={() => {
                  setActiveSection('channels')
                  setCreatingChannel(true)
                }}
                title="Novo grupo"
                aria-label="Novo grupo"
              >
                +
              </button>
            </div>
            <For
              each={sidebarChannels()}
              fallback={
                <Show when={!isSidebarCompact()}>
                  <div class="list-empty">Nenhum grupo criado.</div>
                </Show>
              }
            >
              {(channel) => (
                <button
                  type="button"
                  class="agent-item"
                  classList={{
                    active: activeSection() === 'channels' && selectedChannelId() === channel.id,
                    muted: channel.archived,
                  }}
                  title={channel.title}
                  aria-label={channel.title}
                  onClick={() => {
                    setSelectedChannelId(channel.id)
                    setActiveSection('channels')
                  }}
                >
                  <span class="agent-avatar channel-avatar">
                    <RailIcon name="users" />
                  </span>
                  <span class="agent-item-copy">
                    <div class="agent-item-top">
                      <span class="agent-item-name">{channel.title}</span>
                    </div>
                    <div class="agent-item-workspace">
                      {channel.archived
                        ? 'Arquivada'
                        : channel.status === 'stopped'
                          ? 'Pausada'
                          : `Coordenador: ${agents().find((a) => a.id === channel.ownerAgentId)?.name ?? '—'}`}
                    </div>
                  </span>
                </button>
              )}
            </For>
            <button
              type="button"
              class="btn-link sidebar-small-link"
              title={showArchivedChannels() ? 'Ocultar grupos arquivados' : 'Ver grupos arquivados'}
              aria-label={
                showArchivedChannels() ? 'Ocultar grupos arquivados' : 'Ver grupos arquivados'
              }
              aria-pressed={showArchivedChannels()}
              onClick={() => {
                setShowArchivedChannels(!showArchivedChannels())
                void loadChannels()
              }}
            >
              <Show
                when={isSidebarCompact()}
                fallback={
                  showArchivedChannels() ? 'Ocultar grupos arquivados' : 'Ver grupos arquivados'
                }
              >
                <RailIcon name="folder" />
              </Show>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <main class="main-content">
        <Show when={settingsOpen()}>
          <dialog
            ref={focusDialog}
            aria-modal="true"
            class="settings-overlay"
            open
            aria-label="Configurações"
            onClick={(e) => e.target === e.currentTarget && closeSettings()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                closeSettings()
              }
            }}
          >
            <div class="settings-shell">
              <aside class="settings-nav">
                <div class="settings-nav-head">
                  <h1>Configurações</h1>
                </div>
                <label class="list-search">
                  <RailIcon name="search" />
                  <input
                    type="search"
                    placeholder="Pesquisar configurações..."
                    value={settingsQuery()}
                    onInput={(event) => setSettingsQuery(event.currentTarget.value)}
                    aria-label="Pesquisar configurações"
                  />
                </label>
                <nav class="settings-nav-list" aria-label="Seções de configuração">
                  <For
                    each={visibleSettingsPanes()}
                    fallback={<p class="settings-nav-empty">Nenhuma configuração encontrada.</p>}
                  >
                    {(pane) => (
                      <button
                        type="button"
                        class="settings-nav-btn"
                        classList={{
                          active: currentSettingsPane()?.id === pane.id,
                        }}
                        onClick={() => selectSettingsPane(pane.id)}
                      >
                        <SettingsGlyph id={pane.id} />
                        {pane.label}
                      </button>
                    )}
                  </For>
                </nav>
              </aside>
              <div class="settings-stage">
                <div class="settings-page-head">
                  <h1>{currentSettingsPane()?.label ?? 'Configurações'}</h1>
                  <button
                    type="button"
                    class="settings-close"
                    onClick={closeSettings}
                    aria-label="Fechar configurações"
                    title="Fechar configurações (Esc)"
                  >
                    <RailIcon name="close" />
                    Fechar
                  </button>
                </div>
                <Show
                  when={currentSettingsPane()?.id === 'perfil'}
                  fallback={
                    <div class="settings-view">
                      <Show when={currentSettingsPane()?.id === 'provedores'}>
                        <div class="connections-view">
                          <LocalRuntimes onAdded={loadConnections} />
                          <Show when={visibleUpdates().length > 0}>
                            <div class="updates-banner">
                              <span>
                                ⬆ {visibleUpdates().length} atualização(ões) de provedor
                                disponível(is):{' '}
                                {visibleUpdates()
                                  .map(
                                    (u) =>
                                      `${u.providerId} v${u.installedVersion} → v${u.latestVersion}`,
                                  )
                                  .join(' · ')}
                              </span>
                              <button
                                type="button"
                                class="btn-outline"
                                onClick={() => visibleUpdates().forEach(handleDismissUpdate)}
                              >
                                Depois
                              </button>
                            </div>
                          </Show>
                          <div class="connections-header">
                            <div class="connections-header-left">
                              <p class="connections-desc">
                                Ative suas IAs e escolha um provedor para configurar contas e
                                modelos.
                              </p>
                              <PrincipalProviderSelect />
                            </div>
                            <div class="connections-header-actions">
                              <button
                                type="button"
                                class="btn-outline"
                                onClick={() => setShowCustomProvider(true)}
                              >
                                Adicionar provedor
                              </button>
                              <button
                                type="button"
                                class="btn-outline"
                                onClick={() => {
                                  loadConnections()
                                  loadProviderStatuses()
                                }}
                                title="Atualizar status de todas as conexões"
                              >
                                Verificar conexões
                              </button>
                            </div>
                          </div>

                          <div class="connections-split">
                            <div class="connections-list">
                              <For each={connections()}>
                                {(c) => (
                                  <div
                                    class="connections-row"
                                    classList={{
                                      active: activeConnectionId() === c.providerId,
                                    }}
                                  >
                                    <button
                                      type="button"
                                      class="connections-row-main"
                                      aria-pressed={activeConnectionId() === c.providerId}
                                      onClick={() => setSelectedConnId(c.providerId)}
                                    >
                                      <span>
                                        <strong>{c.name}</strong>
                                        <small>
                                          {c.enabled ? providerStatusLabel(c) : 'Desativado'}
                                        </small>
                                      </span>
                                    </button>
                                    <label class="toggle-switch-wrapper" title="Ativar/desativar">
                                      <div class="toggle-switch">
                                        <input
                                          type="checkbox"
                                          checked={c.enabled}
                                          aria-label={`Ativar ${c.name}`}
                                          onChange={(e) =>
                                            handleToggleConnection(c, e.currentTarget.checked)
                                          }
                                        />
                                        <span class="toggle-slider" />
                                      </div>
                                    </label>
                                  </div>
                                )}
                              </For>
                            </div>
                            <div class="connections-grid">
                              <For
                                each={connections().filter(
                                  (c) => c.providerId === activeConnectionId(),
                                )}
                              >
                                {(conn) => {
                                  const draft = () => connectionDrafts()[conn.providerId] || {}
                                  const isTesting = () => testingConnection() === conn.providerId
                                  const isSaving = () => savingConnection() === conn.providerId
                                  const testResult = () => testResults()[conn.providerId]
                                  const savedMsg = () => saveMessage()[conn.providerId]
                                  const isKeyVisible = () => Boolean(showApiKeys()[conn.providerId])

                                  return (
                                    <div
                                      class={`connection-box ${conn.enabled ? `active-${conn.providerId}` : 'disabled'}`}
                                    >
                                      <div class="connection-box-top">
                                        <div class="connection-brand">
                                          <div>
                                            <div class="connection-name">{conn.name}</div>
                                            <div
                                              style={{
                                                'font-size': '11px',
                                                color: 'var(--text-muted)',
                                              }}
                                            >
                                              ID: <code>{conn.providerId}</code>
                                              <Show when={conn.version}>
                                                {' • '}
                                                <span
                                                  style={{
                                                    color: 'var(--text-main)',
                                                  }}
                                                >
                                                  {conn.version}
                                                </span>
                                              </Show>
                                            </div>
                                          </div>
                                        </div>

                                        <div
                                          style={{
                                            display: 'flex',
                                            'align-items': 'center',
                                            gap: '10px',
                                          }}
                                        >
                                          <Show
                                            when={conn.enabled}
                                            fallback={
                                              <span class="connection-status-pill disabled">
                                                ○ Desativado
                                              </span>
                                            }
                                          >
                                            <span
                                              class={`connection-status-pill ${conn.readiness === 'ready' ? 'online' : 'warning'}`}
                                              title={conn.error || conn.version || ''}
                                            >
                                              {conn.readiness === 'ready' ? '●' : '⚠'}{' '}
                                              {providerStatusLabel(conn)}
                                            </span>
                                          </Show>

                                          <label
                                            class="toggle-switch-wrapper"
                                            title={
                                              conn.enabled ? 'Desativar conexão' : 'Ativar conexão'
                                            }
                                          >
                                            <div class="toggle-switch">
                                              <input
                                                type="checkbox"
                                                checked={conn.enabled}
                                                aria-label={`Ativar ${conn.name}`}
                                                onChange={(e) =>
                                                  handleToggleConnection(
                                                    conn,
                                                    e.currentTarget.checked,
                                                  )
                                                }
                                              />
                                              <span class="toggle-slider" />
                                            </div>
                                          </label>
                                        </div>
                                      </div>

                                      <div class="connection-fields">
                                        <div class="connection-field">
                                          <label
                                            class="connection-field-label"
                                            for={`conn-model-${conn.providerId}`}
                                          >
                                            Modelo Padrão
                                          </label>
                                          <ModelPicker
                                            id={`conn-model-${conn.providerId}`}
                                            models={modelsFor(conn.providerId)}
                                            class="connection-input"
                                            value={draft().defaultModel ?? conn.defaultModel}
                                            onChange={(value) =>
                                              updateDraftField(
                                                conn.providerId,
                                                'defaultModel',
                                                value,
                                              )
                                            }
                                            disabled={!conn.enabled}
                                          />
                                        </div>
                                        <Show when={conn.supportsEffort}>
                                          <div class="connection-field">
                                            <label
                                              class="connection-field-label"
                                              for={`conn-effort-${conn.providerId}`}
                                            >
                                              Raciocínio
                                            </label>
                                            <select
                                              id={`conn-effort-${conn.providerId}`}
                                              class="connection-input"
                                              value={draft().effort ?? conn.effort ?? ''}
                                              disabled={!conn.enabled}
                                              onChange={(e) =>
                                                updateDraftField(
                                                  conn.providerId,
                                                  'effort',
                                                  e.currentTarget.value,
                                                )
                                              }
                                            >
                                              <option value="" disabled>
                                                Padrão do provedor
                                              </option>
                                              <For
                                                each={effortsFor(
                                                  conn.providerId,
                                                  draft().defaultModel ?? conn.defaultModel,
                                                ).slice(1)}
                                              >
                                                {([value, label]) => (
                                                  <option value={value}>{label}</option>
                                                )}
                                              </For>
                                            </select>
                                          </div>
                                        </Show>

                                        <div class="connection-field">
                                          <label
                                            class="connection-field-label"
                                            for={`conn-key-${conn.providerId}`}
                                          >
                                            Chave de Acesso / API Key
                                          </label>
                                          <div class="api-key-group">
                                            <input
                                              id={`conn-key-${conn.providerId}`}
                                              type={isKeyVisible() ? 'text' : 'password'}
                                              class="connection-input"
                                              placeholder={
                                                conn.hasApiKey
                                                  ? 'Chave cadastrada; digite para substituir'
                                                  : 'CLI local / variável de ambiente / chave personalizada...'
                                              }
                                              value={draft().apiKey ?? ''}
                                              onInput={(e) =>
                                                updateDraftField(
                                                  conn.providerId,
                                                  'apiKey',
                                                  e.currentTarget.value,
                                                )
                                              }
                                              disabled={!conn.enabled}
                                            />
                                            <button
                                              type="button"
                                              class="btn-icon-eye"
                                              aria-label={
                                                isKeyVisible() ? 'Ocultar chave' : 'Mostrar chave'
                                              }
                                              onClick={() => toggleShowApiKey(conn.providerId)}
                                              title={
                                                isKeyVisible() ? 'Ocultar chave' : 'Mostrar chave'
                                              }
                                              disabled={!conn.enabled}
                                            >
                                              {isKeyVisible() ? 'Ocultar' : 'Mostrar'}
                                            </button>
                                          </div>
                                          <Show when={conn.keyStorageError}>
                                            <output>{conn.keyStorageError}</output>
                                          </Show>
                                          <Show when={conn.hasApiKey}>
                                            <button
                                              type="button"
                                              disabled={!conn.enabled}
                                              onClick={() =>
                                                updateDraftField(conn.providerId, 'apiKey', '')
                                              }
                                            >
                                              Remover chave ao salvar
                                            </button>
                                            <Show when={draft().apiKey === ''}>
                                              <output>A chave será removida ao salvar.</output>
                                            </Show>
                                          </Show>
                                        </div>

                                        <Show when={conn.providerId !== 'acp'}>
                                          <div class="connection-field">
                                            <label
                                              class="connection-field-label"
                                              for={`conn-endpoint-${conn.providerId}`}
                                            >
                                              {isCustomProvider(conn.providerId)
                                                ? 'URL base da API'
                                                : 'Endpoint Customizado (Opcional)'}
                                            </label>
                                            <input
                                              id={`conn-endpoint-${conn.providerId}`}
                                              type="text"
                                              class="connection-input"
                                              placeholder="Ex: https://api.x.ai/v1 ou proxy local..."
                                              value={draft().endpoint ?? (conn.endpoint || '')}
                                              onInput={(e) =>
                                                updateDraftField(
                                                  conn.providerId,
                                                  'endpoint',
                                                  e.currentTarget.value,
                                                )
                                              }
                                              disabled={!conn.enabled}
                                            />
                                          </div>
                                        </Show>
                                      </div>

                                      <Show when={testResult()}>
                                        {(res) => (
                                          <div
                                            class={`connection-result-msg ${res().success ? 'success' : 'error'}`}
                                          >
                                            <strong>
                                              {res().success ? '✓ Sucesso: ' : '✗ Erro: '}
                                            </strong>
                                            {res().message}
                                          </div>
                                        )}
                                      </Show>

                                      <Show when={savedMsg()}>
                                        {(msg) => (
                                          <div class="connection-save-feedback">✓ {msg()}</div>
                                        )}
                                      </Show>

                                      <div class="connection-card-actions">
                                        <div
                                          style={{
                                            display: 'flex',
                                            gap: '6px',
                                            'align-items': 'center',
                                          }}
                                        >
                                          <button
                                            type="button"
                                            class="btn-outline"
                                            onClick={() => setAccountsProvider(conn.providerId)}
                                          >
                                            Contas (
                                            {providerAccounts()[conn.providerId]?.length ?? 1})
                                          </button>
                                          <button
                                            type="button"
                                            class="btn-icon-gear"
                                            onClick={() => setConfigProviderId(conn.providerId)}
                                            title={`Configurar ${conn.name} (CLI, esforço, modelos)`}
                                            aria-label={`Configurar ${conn.name}`}
                                          >
                                            <RailIcon name="gear" />
                                          </button>
                                          <button
                                            type="button"
                                            class="btn-outline"
                                            onClick={() => handleTestConnection(conn.providerId)}
                                            disabled={!conn.enabled || isTesting()}
                                            title="Testar comunicação com a CLI ou API do provedor"
                                          >
                                            {isTesting() ? 'Verificando…' : 'Testar conexão'}
                                          </button>
                                        </div>

                                        <button
                                          type="button"
                                          class="btn-primary"
                                          onClick={() => handleSaveConnection(conn)}
                                          disabled={!conn.enabled || isSaving()}
                                        >
                                          {isSaving() ? 'Salvando…' : 'Salvar'}
                                        </button>
                                      </div>
                                    </div>
                                  )
                                }}
                              </For>
                            </div>
                          </div>
                        </div>
                      </Show>
                      <Show when={currentSettingsPane()?.id === 'geral'}>
                        <section class="settings-section">
                          <h2>Aparência</h2>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Tema</div>
                              <div class="settings-row-desc">
                                Cores claras ou escuras. “Sistema” segue o ajuste do seu
                                dispositivo.
                              </div>
                            </div>
                            <select
                              class="settings-select"
                              value={settings().theme}
                              onChange={(e) =>
                                updateSettings({
                                  theme: e.currentTarget.value as AppSettings['theme'],
                                })
                              }
                            >
                              <option value="dark">Escuro</option>
                              <option value="light">Claro</option>
                              <option value="system">Sistema</option>
                            </select>
                          </div>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Idioma</div>
                              <div class="settings-row-desc">
                                O Orchbot mostra menus, botões e mensagens neste idioma.
                              </div>
                            </div>
                            <select
                              class="settings-select"
                              value={settings().language}
                              onChange={(e) =>
                                updateSettings({
                                  language: e.currentTarget.value,
                                })
                              }
                            >
                              <option value="pt-BR">Português (Brasil)</option>
                            </select>
                          </div>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Tamanho da interface</div>
                              <div class="settings-row-desc">
                                O tamanho do texto e dos controles no Orchbot.
                              </div>
                            </div>
                            <select
                              class="settings-select"
                              value={settings().uiScale}
                              onChange={(e) =>
                                updateSettings({
                                  uiScale: Number(e.currentTarget.value),
                                })
                              }
                            >
                              <option value={75}>75%</option>
                              <option value={90}>90%</option>
                              <option value={100}>100%</option>
                              <option value={110}>110%</option>
                              <option value={125}>125%</option>
                            </select>
                          </div>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Cor do logotipo</div>
                              <div class="settings-row-desc">
                                Aparece no topo do app, na barra de tarefas e no ícone.
                              </div>
                            </div>
                            <div class="logo-color-swatches">
                              <For each={LOGO_COLORS}>
                                {(color) => (
                                  <button
                                    type="button"
                                    class={`logo-swatch ${settings().logoColor === color ? 'active' : ''}`}
                                    style={{ background: color }}
                                    onClick={() => updateSettings({ logoColor: color })}
                                    aria-label={`Cor do logotipo ${color}`}
                                  />
                                )}
                              </For>
                            </div>
                          </div>
                        </section>

                        <section class="settings-section">
                          <h2>Conversas</h2>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Atalho de envio</div>
                              <div class="settings-row-desc">
                                Escolha as teclas que enviam uma mensagem neste dispositivo e
                                navegador.
                              </div>
                            </div>
                            <select
                              class="settings-select"
                              value={settings().sendShortcut}
                              onChange={(e) =>
                                updateSettings({
                                  sendShortcut: e.currentTarget
                                    .value as AppSettings['sendShortcut'],
                                })
                              }
                            >
                              <option value="enter">Enter para enviar</option>
                              <option value="ctrl-enter">Ctrl+Enter para enviar</option>
                            </select>
                          </div>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Mostrar etapas do agente</div>
                              <div class="settings-row-desc">
                                Abre por padrão o raciocínio, as etapas de ferramentas e as mudanças
                                de memória de cada turno neste dispositivo e navegador.
                              </div>
                            </div>
                            <Switch
                              pressed={settings().showAgentSteps}
                              label="Mostrar etapas do agente"
                              onChange={() =>
                                updateSettings({
                                  showAgentSteps: !settings().showAgentSteps,
                                })
                              }
                            />
                          </div>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Abrir links externos em</div>
                              <div class="settings-row-desc">
                                Links de chats, páginas de login e páginas de cobrança abrem aqui.
                              </div>
                            </div>
                            <select
                              class="settings-select"
                              value={settings().externalLinks}
                              onChange={(e) =>
                                updateSettings({
                                  externalLinks: e.currentTarget
                                    .value as AppSettings['externalLinks'],
                                })
                              }
                            >
                              <option value="default-browser">Navegador padrão</option>
                              <option value="embedded">Navegador embutido</option>
                            </select>
                          </div>
                        </section>

                        <DistributionSettings
                          settings={settings()}
                          update={updateSettings}
                          Switch={Switch}
                        />
                        <section class="settings-section">
                          <h2>Comportamento do app</h2>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Iniciar o Orchbot ao entrar</div>
                              <div class="settings-row-desc">
                                Abra o app quando você entrar neste computador.
                              </div>
                            </div>
                            <Switch
                              pressed={settings().startAtLogin}
                              label="Iniciar o Orchbot ao entrar"
                              onChange={() =>
                                updateSettings({
                                  startAtLogin: !settings().startAtLogin,
                                })
                              }
                            />
                          </div>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Contexto Git no turno</div>
                              <div class="settings-row-desc">
                                Envia ao agente a branch, os arquivos alterados e os commits
                                recentes do workspace (e o diff no modo de contexto completo). Só
                                leitura.
                              </div>
                            </div>
                            <Switch
                              pressed={settings().gitContext}
                              label="Contexto Git no turno"
                              onChange={() =>
                                updateSettings({
                                  gitContext: !settings().gitContext,
                                })
                              }
                            />
                          </div>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Conexão rápida a servidores</div>
                              <div class="settings-row-desc">
                                Mantenha o status dos provedores em cache entre as inicializações. O
                                Orchbot inicia cerca de um segundo mais rápido.
                              </div>
                            </div>
                            <Switch
                              pressed={settings().quickConnection}
                              label="Conexão rápida a servidores"
                              onChange={() =>
                                updateSettings({
                                  quickConnection: !settings().quickConnection,
                                })
                              }
                            />
                          </div>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">
                                Manter o Orchbot em execução em segundo plano
                              </div>
                              <div class="settings-row-desc">
                                Mantenha as tarefas ativas em execução após fechar a janela. Reabra
                                pela barra de tarefas/Dock.
                              </div>
                            </div>
                            <Switch
                              pressed={settings().keepRunningInBackground}
                              label="Manter o Orchbot em execução em segundo plano"
                              onChange={() =>
                                updateSettings({
                                  keepRunningInBackground: !settings().keepRunningInBackground,
                                })
                              }
                            />
                          </div>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">
                                Restaurar o último espaço de trabalho ao iniciar
                              </div>
                              <div class="settings-row-desc">
                                Abra o espaço de trabalho e as tarefas da sessão anterior.
                              </div>
                            </div>
                            <Switch
                              pressed={settings().restoreWorkspace}
                              label="Restaurar o último espaço de trabalho ao iniciar"
                              onChange={() =>
                                updateSettings({
                                  restoreWorkspace: !settings().restoreWorkspace,
                                })
                              }
                            />
                          </div>
                        </section>
                      </Show>

                      <Show when={currentSettingsPane()?.id === 'agents'}>
                        <section class="settings-section">
                          <h2>Padrões</h2>
                          <p class="settings-section-desc">
                            O que os agentes deste computador podem fazer quando você não define
                            isso em um agente.
                          </p>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Scripts locais</div>
                              <div class="settings-row-desc">
                                Padrão: {settings().defaultLocalScripts ? 'ligado' : 'desligado'} •{' '}
                                {
                                  agents().filter(
                                    (a) => effectiveCapabilities(a, settings()).localScripts,
                                  ).length
                                }{' '}
                                de {agents().length} ativos
                              </div>
                            </div>
                            <Switch
                              pressed={settings().defaultLocalScripts}
                              label="Scripts locais"
                              onChange={() =>
                                updateSettings({
                                  defaultLocalScripts: !settings().defaultLocalScripts,
                                })
                              }
                            />
                          </div>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">O agente inicia novos chats</div>
                              <div class="settings-row-desc">
                                Padrão: {settings().defaultStartsNewChats ? 'ligado' : 'desligado'}{' '}
                                •{' '}
                                {
                                  agents().filter(
                                    (a) => effectiveCapabilities(a, settings()).startsNewChats,
                                  ).length
                                }{' '}
                                de {agents().length} ativos
                              </div>
                            </div>
                            <Switch
                              pressed={settings().defaultStartsNewChats}
                              label="O agente inicia novos chats"
                              onChange={() =>
                                updateSettings({
                                  defaultStartsNewChats: !settings().defaultStartsNewChats,
                                })
                              }
                            />
                          </div>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">
                                Mostrar o plano antes de tarefas longas
                              </div>
                              <div class="settings-row-desc">
                                Padrão:{' '}
                                {settings().defaultShowPlanBeforeLongTasks ? 'ligado' : 'desligado'}{' '}
                                •{' '}
                                {
                                  agents().filter(
                                    (a) =>
                                      effectiveCapabilities(a, settings()).showPlanBeforeLongTasks,
                                  ).length
                                }{' '}
                                de {agents().length} ativos
                              </div>
                            </div>
                            <Switch
                              pressed={settings().defaultShowPlanBeforeLongTasks}
                              label="Mostrar o plano antes de tarefas longas"
                              onChange={() =>
                                updateSettings({
                                  defaultShowPlanBeforeLongTasks:
                                    !settings().defaultShowPlanBeforeLongTasks,
                                })
                              }
                            />
                          </div>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">
                                Orientar agentes enquanto trabalham
                              </div>
                              <div class="settings-row-desc">
                                Padrão:{' '}
                                {settings().defaultSteerMode === 'imediato' ? 'imediato' : 'fila'} •{' '}
                                {
                                  agents().filter(
                                    (a) =>
                                      effectiveCapabilities(a, settings()).steerMode === 'imediato',
                                  ).length
                                }{' '}
                                de {agents().length} em imediato
                              </div>
                            </div>
                            <select
                              class="settings-select"
                              value={settings().defaultSteerMode}
                              onChange={(e) =>
                                updateSettings({
                                  defaultSteerMode: e.currentTarget
                                    .value as AppSettings['defaultSteerMode'],
                                })
                              }
                            >
                              <option value="fila">Fila</option>
                              <option value="imediato">Imediato (interrompe)</option>
                            </select>
                          </div>
                        </section>
                      </Show>

                      <Show when={currentSettingsPane()?.id === 'computer'}>
                        <section class="settings-section">
                          <h2>Uso do computador</h2>
                          <p class="settings-section-desc">
                            Permita que os agentes do Orchbot deste computador vejam e usem os apps
                            dele. Agentes de outro servidor usam o computador desse servidor.
                          </p>
                          <Show
                            when={computerStatus()}
                            fallback={
                              <p class="settings-section-desc">Verificando este computador…</p>
                            }
                          >
                            {(st) => (
                              <div class={`computer-status ${st().ready ? 'ready' : 'warn'}`}>
                                <strong>
                                  {st().ready
                                    ? '✓ O Uso do computador está pronto'
                                    : '⚠ O Uso do computador não está pronto'}
                                </strong>
                                <span>{st().message}</span>
                                <span class="computer-tools">
                                  Screenshot: {st().screenshotTool ?? '—'} • Janelas:{' '}
                                  {st().windowTool ?? '—'} • Teclado: {st().inputTool ?? '—'} •
                                  Sessão: {st().sessionType}
                                </span>
                              </div>
                            )}
                          </Show>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Permitir por padrão</div>
                              <div class="settings-row-desc">
                                Padrão: {settings().computerUseEnabled ? 'ligado' : 'desligado'} •{' '}
                                {
                                  agents().filter(
                                    (a) => effectiveCapabilities(a, settings()).computerUse,
                                  ).length
                                }{' '}
                                de {agents().length} ativos. Cada robô pode mudar o seu na criação.
                              </div>
                            </div>
                            <Switch
                              pressed={settings().computerUseEnabled}
                              label="Permitir uso do computador por padrão"
                              onChange={() =>
                                updateSettings({
                                  computerUseEnabled: !settings().computerUseEnabled,
                                })
                              }
                            />
                          </div>
                        </section>
                      </Show>

                      <Show when={currentSettingsPane()?.id === 'permissoes'}>
                        <section class="settings-section">
                          <h2>Permissões</h2>
                          <div class="settings-row">
                            <div>
                              <div class="settings-row-title">Compartilhar análises do produto</div>
                              <div class="settings-row-desc">
                                Envie metadados de uso e confiabilidade com o ID e o e-mail da sua
                                conta para o serviço de análise hospedado pelo próprio Orchbot.
                              </div>
                            </div>
                            <Switch
                              pressed={settings().shareAnalytics}
                              label="Compartilhar análises do produto"
                              onChange={() =>
                                updateSettings({
                                  shareAnalytics: !settings().shareAnalytics,
                                })
                              }
                            />
                          </div>
                        </section>
                      </Show>
                    </div>
                  }
                >
                  <div class="profile-view">
                    <div class="profile-head">
                      <div class="profile-avatar">{initialsOf(settings().profileName)}</div>
                      <div>
                        <h1 class="connections-title">{settings().profileName}</h1>
                        <p class="connections-desc">Gerencie como você aparece no Orchbot.</p>
                      </div>
                    </div>

                    <Show
                      when={profileStats()}
                      fallback={<p class="connections-desc">Carregando uso deste computador…</p>}
                    >
                      {(stats) => (
                        <>
                          <div class="profile-cards">
                            <div class="profile-card">
                              <div class="profile-card-label">Tokens</div>
                              <div class="profile-card-value">
                                {formatCompact(stats().totalTokens)}
                              </div>
                              <div class="profile-card-sub">
                                Último ano ·{' '}
                                {stats().totalTokens > 0
                                  ? `${Math.round((stats().measuredTokens / stats().totalTokens) * 100)}% medido pelas CLIs, o resto estimado`
                                  : 'sem uso ainda'}
                              </div>
                              <div class="profile-card-row">
                                <span>Dia recorde</span>
                                <strong>
                                  <Show when={stats().recordDay} fallback="Sem atividade">
                                    {(rec) =>
                                      `${formatCompact(rec().tokens)} • ${formatDatePt(rec().date)}`
                                    }
                                  </Show>
                                </strong>
                              </div>
                            </div>
                            <div class="profile-card">
                              <div class="profile-card-label">Mensagens</div>
                              <div class="profile-card-value">{stats().totalMessages}</div>
                              <div class="profile-card-sub">Último ano</div>
                              <div class="profile-card-row">
                                <span>Sequência atual</span>
                                <strong>
                                  {stats().currentStreakDays} dia
                                  {stats().currentStreakDays === 1 ? '' : 's'}
                                  {stats().currentStreakDays === 0 ? ' • Sem atividade' : ''}
                                </strong>
                              </div>
                              <div class="profile-card-row">
                                <span>Maior sequência</span>
                                <strong>
                                  <Show when={stats().longestStreak} fallback="Sem atividade">
                                    {(s) =>
                                      `${s().days} dia${s().days === 1 ? '' : 's'} • ${formatDatePt(s().endDate)}`
                                    }
                                  </Show>
                                </strong>
                              </div>
                            </div>
                          </div>

                          <section class="settings-section">
                            <h2>Atividade neste computador</h2>
                            <p class="settings-section-desc">
                              {stats().activeDaysLastYear} dia
                              {stats().activeDaysLastYear === 1 ? '' : 's'} ativo
                              {stats().activeDaysLastYear === 1 ? '' : 's'} no último ano
                            </p>
                            {(() => {
                              const max = Math.max(1, ...stats().daily.map((d) => d.tokens))
                              const months = [
                                'jan.',
                                'fev.',
                                'mar.',
                                'abr.',
                                'mai.',
                                'jun.',
                                'jul.',
                                'ago.',
                                'set.',
                                'out.',
                                'nov.',
                                'dez.',
                              ]
                              const firstMonth = new Date(
                                `${stats().daily[0]?.date}T12:00:00`,
                              ).getMonth()
                              const labels = Array.from(
                                { length: 13 },
                                (_, i) => months[(firstMonth + i) % 12],
                              )
                              return (
                                <>
                                  <div class="heatmap-months">
                                    <For each={labels}>{(m) => <span>{m}</span>}</For>
                                  </div>
                                  <div
                                    class="heatmap"
                                    role="img"
                                    aria-label="Mapa de atividade do último ano"
                                  >
                                    <For each={stats().daily}>
                                      {(d) => {
                                        const level =
                                          d.tokens === 0
                                            ? 0
                                            : d.tokens / max <= 0.25
                                              ? 1
                                              : d.tokens / max <= 0.5
                                                ? 2
                                                : d.tokens / max <= 0.75
                                                  ? 3
                                                  : 4
                                        return (
                                          <span
                                            class={`heat-cell l${level}`}
                                            title={`${formatDatePt(d.date)}: ${d.messages} mensagens, ~${d.tokens} tokens`}
                                          />
                                        )
                                      }}
                                    </For>
                                  </div>
                                  <div class="heatmap-legend">
                                    <span>Menos</span>
                                    <span class="heat-cell l0" />
                                    <span class="heat-cell l1" />
                                    <span class="heat-cell l2" />
                                    <span class="heat-cell l3" />
                                    <span class="heat-cell l4" />
                                    <span>Mais</span>
                                  </div>
                                </>
                              )
                            })()}
                          </section>

                          <section class="settings-section">
                            <h2>Destaques</h2>
                            <div class="settings-row">
                              <div class="settings-row-title">Provedor mais usado</div>
                              <strong>
                                {stats().topProvider
                                  ? `${stats().topProvider?.name} · ${stats().topProvider?.percent}%`
                                  : 'Sem dados'}
                              </strong>
                            </div>
                            <div class="settings-row">
                              <div class="settings-row-title">Modelo principal</div>
                              <strong>{stats().topModel?.model ?? 'Sem dados'}</strong>
                            </div>
                            <div class="settings-row">
                              <div class="settings-row-title">Dia mais ativo</div>
                              <strong>{stats().topWeekday ?? 'Sem dados'}</strong>
                            </div>
                            <div class="settings-row">
                              <div class="settings-row-title">Custo estimado</div>
                              <strong>
                                US$ {stats().estimatedCostUsd.toFixed(2).replace('.', ',')}
                              </strong>
                            </div>
                          </section>

                          <section class="settings-section">
                            <h2>Colegas mais ativos</h2>
                            <Show
                              when={stats().topAgents.length > 0}
                              fallback={
                                <p class="settings-section-desc">
                                  Nenhum agente com atividade ainda.
                                </p>
                              }
                            >
                              <For each={stats().topAgents}>
                                {(a) => (
                                  <div class="settings-row">
                                    <div class="settings-row-title">{a.name}</div>
                                    <strong>{formatCompact(a.tokens)}</strong>
                                  </div>
                                )}
                              </For>
                            </Show>
                          </section>

                          <section class="settings-section">
                            <h2>Uso de modelos</h2>
                            <Show
                              when={stats().modelUsage.length > 0}
                              fallback={
                                <p class="settings-section-desc">Sem uso de modelos ainda.</p>
                              }
                            >
                              <For each={stats().modelUsage}>
                                {(m) => (
                                  <div class="model-usage-row">
                                    <span>{m.model}</span>
                                    <div class="model-usage-bar">
                                      <span
                                        style={{
                                          width: `${Math.max(3, m.percent)}%`,
                                        }}
                                      />
                                    </div>
                                    <strong>{m.percent}%</strong>
                                  </div>
                                )}
                              </For>
                            </Show>
                          </section>
                        </>
                      )}
                    </Show>

                    <section class="settings-section">
                      <h2>Conta</h2>
                      <div class="form-group">
                        <label for="profile-name">Nome</label>
                        <input
                          id="profile-name"
                          type="text"
                          value={settings().profileName}
                          onInput={(e) =>
                            updateSettings({
                              profileName: e.currentTarget.value,
                            })
                          }
                        />
                      </div>
                      <div class="form-group">
                        <label for="profile-email">E-mail</label>
                        <input
                          id="profile-email"
                          type="email"
                          value={settings().profileEmail}
                          onInput={(e) =>
                            updateSettings({
                              profileEmail: e.currentTarget.value,
                            })
                          }
                        />
                        <span class="settings-section-desc">Usado para entrar no Orchbot.</span>
                      </div>
                      <div class="settings-row">
                        <div>
                          <div class="settings-row-title">Sessões da conta</div>
                          <div class="settings-row-desc">
                            Este computador • {systemStatus()?.platform ?? 'local'} • v
                            {systemStatus()?.appVersion ?? ''} (sessão atual)
                          </div>
                        </div>
                        <span class="connection-status-pill online">● Ativa agora</span>
                      </div>
                    </section>
                  </div>
                </Show>
              </div>
            </div>
          </dialog>
        </Show>
        <Show when={activeSection() === 'board'}>
          <div class="board-view">
            <div class="board-container">
              {/* Aprovações pendentes */}
              <Show when={approvals().length > 0}>
                <div class="board-approvals-wrap">
                  <For each={approvals()}>{(a) => <ApprovalCard approval={a} />}</For>
                </div>
              </Show>

              {/* Cabeçalho de boas-vindas / Hero */}
              <div class="board-hero">
                <div class="board-hero-emblem" aria-hidden="true">
                  <RailIcon name="sparkles" />
                </div>
                <h1 class="board-hero-title">O que vamos fazer hoje?</h1>
                <p class="board-hero-subtitle">
                  Descreva sua tarefa ou monte uma equipe sob medida para o seu objetivo.
                </p>
              </div>

              {/* Compositor flutuante — proporções e estilo fiéis ao OpenBot */}
              <form class="board-composer-card" onSubmit={handleBoardForemanDispatch}>
                <textarea
                  class="board-composer-textarea"
                  rows={3}
                  autofocus
                  placeholder="Descreva o que você precisa… (Pressione Enter para enviar, Shift+Enter para nova linha)"
                  value={boardForemanPrompt()}
                  onInput={(e) => setBoardForemanPrompt(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (boardForemanPrompt().trim()) {
                        e.currentTarget.form?.requestSubmit()
                      }
                    }
                  }}
                />

                <div class="board-composer-toolbar">
                  <div class="board-composer-pills">
                    {/* Provedor de IA (quando houver mais de uma conexão ativa) */}
                    <Show when={connections().filter((c) => c.enabled).length > 1}>
                      <select
                        class="composer-pill-select"
                        aria-label="Provedor de inteligência artificial"
                        title="Provedor de IA"
                        value={currentBoardProvider()}
                        onChange={(e) =>
                          void handleBoardProviderChange(e.currentTarget.value as SupportedProvider)
                        }
                      >
                        <For each={connections().filter((c) => c.enabled)}>
                          {(c) => (
                            <option value={c.providerId}>
                              {c.name}
                              {c.readiness === 'ready' ? '' : ` (${providerStatusLabel(c)})`}
                            </option>
                          )}
                        </For>
                      </select>
                    </Show>

                    {/* Modelo de IA */}
                    <Show
                      when={isCustomBoardModel()}
                      fallback={
                        <select
                          class="composer-pill-select composer-model-select"
                          aria-label="Modelo de inteligência artificial"
                          title="Modelo de IA"
                          value={currentBoardModel()}
                          onChange={(e) => {
                            if (e.currentTarget.value === '__custom__') {
                              setIsCustomBoardModel(true)
                            } else {
                              void handleBoardModelChange(e.currentTarget.value)
                            }
                          }}
                        >
                          <Show
                            when={!modelsFor(currentBoardProvider()).includes(currentBoardModel())}
                          >
                            <option value={currentBoardModel()} selected>
                              {currentBoardModel()}
                            </option>
                          </Show>
                          {/* selected por opção: a lista é refeita ao recarregar e o value do select não se reaplica */}
                          <For each={modelsFor(currentBoardProvider())}>
                            {(m) => (
                              <option value={m} selected={m === currentBoardModel()}>
                                {m}
                              </option>
                            )}
                          </For>
                          <option value="__custom__">Outro modelo…</option>
                        </select>
                      }
                    >
                      <div class="composer-custom-model-wrap">
                        <input
                          class="composer-pill-input"
                          aria-label="ID do modelo personalizado"
                          placeholder="ID do modelo"
                          value={currentBoardModel()}
                          onInput={(e) => void handleBoardModelChange(e.currentTarget.value.trim())}
                          autofocus
                        />
                        <button
                          type="button"
                          class="composer-custom-model-close"
                          title="Voltar à lista de modelos"
                          aria-label="Voltar à lista de modelos"
                          onClick={() => setIsCustomBoardModel(false)}
                        >
                          ✕
                        </button>
                      </div>
                    </Show>

                    {/* Nível de raciocínio (effort) */}
                    <Show when={supportsEffort(currentBoardProvider())}>
                      <select
                        class="composer-pill-select composer-effort-select"
                        aria-label="Nível de raciocínio"
                        title="Nível de raciocínio: mais alto pensa mais, mas demora e gasta mais"
                        value={currentBoardEffort()}
                        onChange={(e) =>
                          void handleBoardEffortChange(e.currentTarget.value as ProviderEffort | '')
                        }
                      >
                        <For each={effortsFor(currentBoardProvider(), currentBoardModel())}>
                          {([value, label]) => <option value={value}>{label}</option>}
                        </For>
                      </select>
                    </Show>

                    {/* Pasta do projeto */}
                    <Show when={projects().length > 0}>
                      <select
                        class="composer-pill-select composer-project-select"
                        aria-label="Pasta do projeto"
                        title="Pasta do projeto"
                        value={boardFilterProject()}
                        onChange={(e) => setBoardFilterProject(e.currentTarget.value)}
                      >
                        <option value="all">Todas as pastas</option>
                        <For each={projects()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
                      </select>
                    </Show>
                  </div>

                  <div class="board-composer-actions">
                    <button
                      type="button"
                      class="board-btn-secondary"
                      disabled={!boardForemanPrompt().trim() || teamDrafting()}
                      onClick={() => void handleDraftTeam()}
                      title="Sugerir uma equipe para realizar esta tarefa"
                    >
                      <RailIcon name="users" />
                      <span>{teamDrafting() ? 'Montando…' : 'Montar equipe'}</span>
                    </button>
                    <button
                      type="submit"
                      class="board-btn-send"
                      disabled={!boardForemanPrompt().trim()}
                      title="Enviar tarefa para o coordenador"
                      aria-label="Enviar tarefa"
                    >
                      <RailIcon name="send" />
                    </button>
                  </div>
                </div>

                <Show when={boardDispatchMsg()}>
                  {(msg) => <div class="foreman-dispatch-feedback">{msg()}</div>}
                </Show>

                <Show when={teamDraft()}>
                  {(team) => (
                    <div class="board-team-draft">
                      <strong>Equipe sugerida</strong>
                      <For each={team()}>
                        {(d) => (
                          <div class="board-team-member">
                            <span class="board-team-avatar">{d.avatar}</span>
                            <div>
                              <strong>
                                {d.name}
                                {d.role === 'orchestrator' ? ' · líder' : ''}
                              </strong>
                              <span>{d.description}</span>
                            </div>
                          </div>
                        )}
                      </For>
                      <div class="approval-card-actions">
                        <button
                          type="button"
                          class="btn-primary"
                          disabled={teamDrafting()}
                          onClick={() => void handleHireTeam()}
                        >
                          Contratar e começar
                        </button>
                        <button
                          type="button"
                          class="btn-secondary"
                          onClick={() => setTeamDraft(null)}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </Show>
              </form>

              {/* Sugestões de tarefas */}
              <section class="board-suggestions-section" aria-label="Sugestões de tarefas">
                <div class="board-section-header">
                  <span>Sugestões</span>
                </div>
                <div class="board-suggestions-grid">
                  <For each={BOARD_SUGGESTIONS}>
                    {(s) => (
                      <button
                        type="button"
                        class="board-suggestion-card"
                        onClick={() => setBoardForemanPrompt(s.prompt)}
                      >
                        <strong class="board-suggestion-title">{s.title}</strong>
                        <span class="board-suggestion-desc">{s.desc}</span>
                      </button>
                    )}
                  </For>
                </div>
              </section>

              {/* Links de navegação secundária */}
              <div class="board-footer-nav">
                <Show when={agents().find((a) => isForeman(a))}>
                  {(foreman) => (
                    <button
                      type="button"
                      class="board-nav-link"
                      onClick={() => openAgent(foreman().id)}
                    >
                      <RailIcon name="chat" />
                      <span>Conversar com o coordenador</span>
                    </button>
                  )}
                </Show>
                <button type="button" class="board-nav-link" onClick={() => openNewAgent()}>
                  <RailIcon name="users" />
                  <span>Criar agente personalizado</span>
                </button>
              </div>
            </div>
          </div>
        </Show>

        <Show when={activeSection() === 'channels'}>
          <Channels
            agents={coworkers()}
            selectedId={selectedChannelId()}
            onSelect={setSelectedChannelId}
            creating={creatingChannel()}
            onCreatingChange={setCreatingChannel}
            onChanged={() => void loadChannels()}
          />
        </Show>
        <Show when={activeSection() === 'skills'}>
          <SkillsPlugins agents={coworkers()} />
        </Show>
        <Show when={activeSection() === 'agents'}>
          <Show
            when={currentAgent()}
            fallback={
              <div class="welcome-view">
                <div class="welcome-icon">👋</div>
                <Show
                  when={agents().length === 0}
                  fallback={
                    <>
                      <h1 class="welcome-title">Com quem você quer conversar?</h1>
                      <p class="welcome-desc">
                        Escolha um agente na lista à esquerda ou volte para a tela de{' '}
                        <strong>Início</strong> para ver toda a sua equipe.
                      </p>
                      <div
                        style={{
                          display: 'flex',
                          gap: '10px',
                          'justify-content': 'center',
                        }}
                      >
                        <button
                          type="button"
                          class="btn-primary"
                          onClick={() => setActiveSection('board')}
                        >
                          🏠 Ir para o Início (Início)
                        </button>
                        <button type="button" class="btn-outline" onClick={() => openNewAgent()}>
                          + Criar Agente
                        </button>
                      </div>
                    </>
                  }
                >
                  <h1 class="welcome-title">Bem-vindo ao Orchbot</h1>
                  <p class="welcome-desc">
                    Sua equipe de agentes inteligentes que trabalham juntos para você. Comece em
                    dois passos simples:
                  </p>
                  <ol class="first-run-steps">
                    <li
                      class="first-run-step"
                      classList={{ done: connections().some((c) => c.enabled) }}
                    >
                      <h2 class="welcome-subtitle">1. Escolha a Inteligência Artificial</h2>
                      <p class="first-run-hint">
                        Clique para ativar a IA que você tem no seu computador.
                      </p>
                      <div class="provider-picker">
                        <For each={connections()}>
                          {(conn) => (
                            <button
                              type="button"
                              class={`provider-card ${conn.enabled ? 'selected' : ''} ${conn.available ? '' : 'missing'}`}
                              aria-pressed={conn.enabled}
                              onClick={() => handleToggleConnection(conn, !conn.enabled)}
                            >
                              <span class="provider-card-name">{conn.name}</span>
                              <span class="provider-card-meta">
                                {conn.enabled
                                  ? providerStatusLabel(conn)
                                  : conn.available
                                    ? 'Instalado'
                                    : 'Não instalado'}
                              </span>
                              <span class="provider-card-check">{conn.enabled ? '✓' : '+'}</span>
                            </button>
                          )}
                        </For>
                      </div>
                      <button
                        type="button"
                        class="btn-link"
                        onClick={() => openSettings('provedores')}
                      >
                        Precisa de ajuda para conectar sua IA? Clique aqui
                      </button>
                    </li>
                    <li class="first-run-step">
                      <h2 class="welcome-subtitle">2. Monte sua equipe com 1 clique</h2>
                      <p class="first-run-hint">
                        No início, descreva o que precisa. O coordenador monta a equipe e distribui
                        o trabalho.
                      </p>
                      <div
                        style={{
                          display: 'flex',
                          gap: '8px',
                          'flex-wrap': 'wrap',
                        }}
                      >
                        <button
                          type="button"
                          class="btn-primary"
                          onClick={() => setActiveSection('board')}
                        >
                          🏠 Abrir Início
                        </button>
                      </div>
                    </li>
                  </ol>
                </Show>
              </div>
            }
          >
            {(agent) => (
              <div class="chat-workspace">
                {/* Header do Agente — Limpo e Compacto */}
                <header class="agent-detail-header">
                  <div class="agent-info">
                    <div class="agent-title-row">
                      <span class="agent-avatar" style={{ background: agentColor(agent().name) }}>
                        {agent().avatar || initialsOf(agent().name)}
                      </span>
                      <h2 title={agent().description || agent().name}>{agent().name}</h2>
                      <Show when={isForeman(agent()) || agent().role === 'orchestrator'}>
                        <span class="agent-role-pill">Coordenador</span>
                      </Show>
                      <Show when={isQueuePaused() || pendingTasksCount() > 0}>
                        <button
                          type="button"
                          class="cron-badge"
                          onClick={() => setShowQueuePanel(!showQueuePanel())}
                        >
                          {isQueuePaused() ? 'Trabalho pausado' : `${pendingTasksCount()} na fila`}
                        </button>
                      </Show>
                    </div>
                  </div>

                  <div class="mode-switcher">
                    <button
                      type="button"
                      class={`btn-mode ${mainViewMode() === 'chat' ? 'active' : ''}`}
                      onClick={() => setMainViewMode('chat')}
                    >
                      Conversa
                    </button>
                    <button
                      type="button"
                      class={`btn-mode ${mainViewMode() === 'browser' ? 'active' : ''}`}
                      onClick={() => {
                        setMainViewMode('browser')
                        const a = currentAgent()
                        if (a) loadBrowserTabs(a.id)
                      }}
                    >
                      Navegador {browserTabs().length > 0 ? `(${browserTabs().length})` : ''}
                    </button>
                    <Show when={browserTabs().length > 0 && !miniBrowserOpen()}>
                      <button
                        type="button"
                        class="btn-mode"
                        onClick={() => setMiniBrowserOpen(true)}
                      >
                        Ver página
                      </button>
                    </Show>
                  </div>

                  <div class="header-actions">
                    <div
                      class="menu-anchor"
                      onKeyDown={(e) => e.key === 'Escape' && setShowAgentMenu(false)}
                    >
                      <button
                        type="button"
                        class="btn-outline"
                        aria-label="Ações do agente"
                        title="Passar tarefa, configurar e outras ações"
                        aria-haspopup="menu"
                        aria-expanded={showAgentMenu()}
                        onClick={() => setShowAgentMenu(!showAgentMenu())}
                      >
                        Ações
                      </button>
                      <Show when={showAgentMenu()}>
                        <button
                          type="button"
                          class="menu-backdrop"
                          tabIndex={-1}
                          aria-label="Fechar menu"
                          onClick={() => setShowAgentMenu(false)}
                        />
                        <div class="dropdown-menu" role="menu">
                          <Show when={otherAgents().length > 0}>
                            <button
                              type="button"
                              class="dropdown-item"
                              role="menuitem"
                              onClick={() => {
                                setShowAgentMenu(false)
                                handleOpenDelegationModal()
                              }}
                            >
                              Passar tarefa
                            </button>
                          </Show>
                          <button
                            type="button"
                            class="dropdown-item"
                            role="menuitem"
                            onClick={() => {
                              setShowAgentMenu(false)
                              setShowAgentSettings(true)
                            }}
                          >
                            Configurar agente
                          </button>
                          <button
                            type="button"
                            class="dropdown-item"
                            role="menuitem"
                            onClick={() => {
                              setShowAgentMenu(false)
                              setShowAiEdit(true)
                            }}
                          >
                            Melhorar com IA
                          </button>
                          <button
                            type="button"
                            class="dropdown-item"
                            role="menuitem"
                            onClick={() => {
                              setShowAgentMenu(false)
                              void refreshMemories(agent().id)
                              setShowMemoryModal(true)
                            }}
                          >
                            Memórias
                          </button>
                          <button
                            type="button"
                            class="dropdown-item"
                            role="menuitem"
                            onClick={() => {
                              setShowAgentMenu(false)
                              setShowCronModal(true)
                            }}
                          >
                            Tarefas agendadas
                            {scheduledTasks().length > 0 ? ` (${scheduledTasks().length})` : ''}
                          </button>
                          <button
                            type="button"
                            class="dropdown-item"
                            role="menuitem"
                            onClick={() => {
                              setShowAgentMenu(false)
                              void openAutomationModal()
                            }}
                          >
                            Webhooks e automação
                          </button>
                          <button
                            type="button"
                            class="dropdown-item"
                            role="menuitem"
                            onClick={() => {
                              setShowAgentMenu(false)
                              setShowSearchModal(true)
                            }}
                          >
                            Pesquisar histórico
                          </button>
                          <Show when={workspaceRules()?.exists}>
                            <button
                              type="button"
                              class="dropdown-item"
                              role="menuitem"
                              onClick={() => {
                                setShowAgentMenu(false)
                                setShowRulesModal(true)
                              }}
                            >
                              Regras da pasta ({workspaceRules()?.filename})
                            </button>
                          </Show>
                          <button
                            type="button"
                            class="dropdown-item"
                            role="menuitem"
                            onClick={() => {
                              setShowAgentMenu(false)
                              setShowQueuePanel(!showQueuePanel())
                            }}
                          >
                            Fila de pedidos ({pendingTasksCount()})
                          </button>
                          <button
                            type="button"
                            class="dropdown-item"
                            role="menuitem"
                            onClick={() => {
                              setShowAgentMenu(false)
                              togglePauseQueue()
                            }}
                          >
                            {isQueuePaused() ? 'Continuar trabalhos' : 'Pausar trabalhos'}
                          </button>
                          <Show
                            when={agent().provider === 'codex' || agent().provider === 'claude'}
                          >
                            <button
                              type="button"
                              class="dropdown-item"
                              role="menuitem"
                              title="Limpa a memória temporária da sessão mantendo o histórico na tela"
                              disabled={
                                !activeThread() ||
                                isStreaming() ||
                                tasks().some(
                                  (task) =>
                                    task.threadId === activeThread()?.id &&
                                    task.status === 'running',
                                )
                              }
                              onClick={() => {
                                setShowAgentMenu(false)
                                handleResetCliSession()
                              }}
                            >
                              Renovar sessão da conversa
                            </button>
                          </Show>
                          <hr class="dropdown-separator" />
                          <button
                            type="button"
                            class="dropdown-item danger"
                            role="menuitem"
                            onClick={() => {
                              setShowAgentMenu(false)
                              void handleDeleteAgent(agent().id)
                            }}
                          >
                            Remover este agente
                          </button>
                        </div>
                      </Show>
                    </div>
                  </div>
                </header>

                {/* Ajustes do agente */}
                <Show when={showAgentSettings()}>
                  <dialog
                    ref={focusDialog}
                    aria-modal="true"
                    class="modal-overlay"
                    open
                    onClick={() => setShowAgentSettings(false)}
                    onKeyDown={(e) => e.key === 'Escape' && setShowAgentSettings(false)}
                  >
                    <div
                      class="modal-content"
                      role="document"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Escape') setShowAgentSettings(false)
                      }}
                    >
                      <div class="modal-header">
                        <span class="modal-title">⚙️ Ajustes de {agent().name}</span>
                        <button
                          type="button"
                          class="modal-close"
                          onClick={() => setShowAgentSettings(false)}
                        >
                          ✕
                        </button>
                      </div>
                      <div class="modal-form">
                        <div class="midchat-switcher-group agent-settings-grid">
                          <div class="midchat-field">
                            <span class="midchat-label">Inteligência Artificial:</span>
                            <select
                              class={`chat-provider-select ${agent().provider}`}
                              value={agent().provider}
                              onChange={(e) =>
                                handleSwitchProviderMidChat(
                                  agent().id,
                                  e.currentTarget.value as SupportedProvider,
                                )
                              }
                            >
                              <For each={connections().filter((c) => c.enabled)}>
                                {(c) => <option value={c.providerId}>{c.name}</option>}
                              </For>
                            </select>
                          </div>

                          <Show
                            when={
                              !isForeman(agent()) &&
                              (providerAccounts()[agent().provider]?.length ?? 0) > 1
                            }
                          >
                            <div class="midchat-field">
                              <label class="midchat-label" for="robot-account">
                                Conta:
                              </label>
                              <select
                                id="robot-account"
                                class="chat-provider-select"
                                value={agent().accountId ?? ''}
                                disabled={tasks().some((task) => task.status === 'running')}
                                onChange={(event) =>
                                  handleSwitchAccount(agent().id, event.currentTarget.value)
                                }
                              >
                                <option value="">Automática (Padrão → habilitadas)</option>
                                <For each={providerAccounts()[agent().provider] ?? []}>
                                  {(account) => (
                                    <option value={account.id} disabled={!account.enabled}>
                                      {account.label}
                                      {!account.enabled ? ' (desativada)' : ''}
                                    </option>
                                  )}
                                </For>
                              </select>
                            </div>
                          </Show>

                          <div class="midchat-field">
                            <span class="midchat-label">Modelo do Cérebro:</span>
                            <ModelPicker
                              models={modelsFor(agent().provider, agent().accountId)}
                              message={
                                catalogWarnings()[catalogKey(agent().provider, agent().accountId)]
                              }
                              onRefresh={() =>
                                loadModelCatalog(agent().provider, agent().accountId, true)
                              }
                              class="chat-model-select"
                              value={agent().model}
                              onChange={(value) => handleSwitchModelMidChat(agent().id, value)}
                              style={{
                                width: '160px',
                                padding: '4px 8px',
                                'font-size': '12px',
                              }}
                            />
                          </div>

                          <div class="midchat-field">
                            <span class="midchat-label">Raciocínio:</span>
                            <select
                              class="chat-autonomy-select"
                              value={agent().effort ?? ''}
                              onChange={(e) =>
                                handleSwitchEffort(
                                  agent().id,
                                  e.currentTarget.value as ProviderEffort | '',
                                )
                              }
                            >
                              <For
                                each={effortsFor(
                                  agent().provider,
                                  agent().model,
                                  agent().accountId,
                                )}
                              >
                                {([value, label]) => <option value={value}>{label}</option>}
                              </For>
                            </select>
                          </div>
                          <div class="midchat-field">
                            <span class="midchat-label">Papel na equipe:</span>
                            <select
                              class="chat-autonomy-select"
                              value={agent().role ?? 'worker'}
                              onChange={(e) =>
                                handleSwitchRole(agent().id, e.currentTarget.value as AgentRole)
                              }
                            >
                              <option value="worker">Especialista (executa tarefas)</option>
                              <option value="orchestrator">Coordenador (distribui tarefas)</option>
                            </select>
                          </div>

                          <div class="midchat-field">
                            <span class="midchat-label">Liberdade de ação:</span>
                            <select
                              class={`chat-autonomy-select ${agent().autonomyLevel || 'autonomous'}`}
                              value={agent().autonomyLevel || 'autonomous'}
                              onChange={(e) =>
                                handleSwitchAutonomyLevel(
                                  agent().id,
                                  e.currentTarget.value as AutonomyLevel,
                                )
                              }
                            >
                              <option value="autonomous">
                                Automático (executa sem interromper)
                              </option>
                              <option value="cautious">Confirmar antes de cada passo</option>
                            </select>
                          </div>
                        </div>
                        <div class="agent-settings-extra">
                          <span class="context-switcher">
                            Tamanho da memória da conversa:
                            <select
                              class="chat-autonomy-select"
                              value={agent().contextMode ?? 'padrao'}
                              onChange={(e) =>
                                handleSwitchContextMode(
                                  agent().id,
                                  e.currentTarget.value as ContextMode,
                                )
                              }
                            >
                              <option value="economico">Curta (mais rápida)</option>
                              <option value="padrao">Equilibrada (Recomendado)</option>
                              <option value="completo">Longa (lembra de mais detalhes)</option>
                            </select>
                          </span>
                          <button
                            type="button"
                            class={`cron-badge ${agent().browserAccess === false ? 'off' : ''}`}
                            onClick={() =>
                              handleSwitchBrowserAccess(agent().id, agent().browserAccess === false)
                            }
                          >
                            Acesso à internet:{' '}
                            {agent().browserAccess === false ? 'Desligado' : 'Ligado'}
                          </button>
                        </div>
                        <div class="agent-settings-info">
                          <span>
                            Pasta onde guarda arquivos: <strong>{agent().workspacePath}</strong>
                          </span>
                          <Show when={agent().role === 'orchestrator'}>
                            <span class="orchestrator-team">
                              Colegas sob coordenação:{' '}
                              {teamOf(agent())
                                .map((a) => a.name)
                                .join(', ') || 'nenhum agente ainda'}
                            </span>
                          </Show>
                        </div>
                        <p class="first-run-hint">
                          As mudanças passam a valer na próxima mensagem enviada.
                        </p>
                      </div>
                    </div>
                  </dialog>
                </Show>

                {/* Drawer da Fila de Tarefas */}
                <Show when={showQueuePanel()}>
                  <div class="queue-panel">
                    <div class="queue-panel-header">
                      <span>Pedidos em andamento</span>
                      <span>{isQueuePaused() ? 'Pausado' : 'Ativo'}</span>
                    </div>

                    <For
                      each={tasks()}
                      fallback={
                        <div
                          style={{
                            color: 'var(--text-muted)',
                            'font-size': '12px',
                          }}
                        >
                          Nenhum pedido pendente na fila deste agente.
                        </div>
                      }
                    >
                      {(task) => (
                        <div class="queue-item">
                          <div class="queue-item-left">
                            <span class={`task-tag ${task.status}`}>{task.status}</span>
                            <span style={{ 'font-weight': '500' }}>{task.prompt}</span>
                            <Show when={task.error}>
                              <span
                                style={{
                                  color: '#f87171',
                                  'font-size': '11px',
                                }}
                              >
                                ({task.error})
                              </span>
                            </Show>
                          </div>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <Show when={task.status === 'pending' || task.status === 'running'}>
                              <button
                                type="button"
                                class="queue-btn-action"
                                onClick={() => handleCancelTask(task.id)}
                              >
                                Cancelar
                              </button>
                            </Show>
                            <Show
                              when={
                                task.status === 'failed' ||
                                task.status === 'interrupted' ||
                                task.status === 'cancelled'
                              }
                            >
                              <button
                                type="button"
                                class="queue-btn-action"
                                onClick={() => handleRetryTask(task.id)}
                              >
                                Tentar de novo
                              </button>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                {/* Modo Chat (Conversa) */}
                <Show when={mainViewMode() === 'chat'}>
                  {/* Barra de Assuntos da Conversa */}
                  <div class="threads-bar">
                    <div class="threads-bar-header">
                      <div class="threads-list" aria-label="Conversas">
                        <For each={agentThreads()}>
                          {(thread) => (
                            <div
                              class={`thread-chip ${activeThread()?.id === thread.id ? 'active' : ''}`}
                            >
                              <button
                                type="button"
                                class="thread-chip-select"
                                onClick={() => handleSelectThread(thread)}
                                title={`Conversa: ${thread.title}`}
                                aria-pressed={activeThread()?.id === thread.id}
                              >
                                <span class="thread-chip-title">{thread.title}</span>
                              </button>
                              <button
                                type="button"
                                class="thread-chip-action"
                                title="Renomear conversa"
                                aria-label={`Renomear ${thread.title}`}
                                onClick={(e) => handleRenameThread(thread, e)}
                              >
                                Renomear
                              </button>
                              <Show when={agentThreads().length > 1}>
                                <button
                                  type="button"
                                  class="thread-chip-action delete"
                                  title="Apagar esta conversa"
                                  aria-label={`Apagar ${thread.title}`}
                                  onClick={(e) => handleDeleteThread(thread, e)}
                                >
                                  <RailIcon name="close" />
                                </button>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="btn-new-thread"
                      onClick={() => handleCreateThread()}
                      title="Começar uma nova conversa separada com este agente"
                    >
                      <span aria-hidden="true">+</span> Nova conversa
                    </button>
                  </div>

                  {/* Lista de Mensagens / Conversa */}
                  <div class="chat-messages">
                    <Show
                      when={messages().length > 0 || isStreaming()}
                      fallback={
                        <div class="chat-empty-friendly">
                          <div
                            class="chat-empty-avatar"
                            style={{ background: agentColor(agent().name) }}
                          >
                            {agent().avatar || initialsOf(agent().name)}
                          </div>
                          <h3 class="chat-empty-title">Olá! Eu sou {agent().name}</h3>
                          <p class="chat-empty-desc">
                            {agent().description ||
                              'Estou pronto para ajudar. Escreva abaixo com suas próprias palavras o que você gostaria que eu fizesse!'}
                          </p>
                          <div class="quick-topics-row">
                            <span class="quick-topics-label">
                              💡 Clique em uma sugestão abaixo para começar:
                            </span>
                            <div class="quick-topics-buttons">
                              <button
                                type="button"
                                class="quick-topic-btn"
                                onClick={() =>
                                  setInputText(
                                    'Me explique passo a passo como você pode me ajudar hoje.',
                                  )
                                }
                              >
                                👋 Como você pode me ajudar?
                              </button>
                              <button
                                type="button"
                                class="quick-topic-btn"
                                onClick={() =>
                                  setInputText(
                                    'Analise os arquivos desta pasta e faça um resumo simples do que encontrou.',
                                  )
                                }
                              >
                                📂 Resumir o que há nesta pasta
                              </button>
                              <button
                                type="button"
                                class="quick-topic-btn"
                                onClick={() =>
                                  setInputText(
                                    'Quero começar uma tarefa nova. Me faça 3 perguntas simples para entender o que preciso.',
                                  )
                                }
                              >
                                🚀 Começar um novo trabalho guiado
                              </button>
                            </div>
                          </div>
                        </div>
                      }
                    >
                      <For each={visibleMessages()}>
                        {(msg) => {
                          const structured = () => parseStructuredMessage(msg.text)
                          return (
                            <div class={`message-row ${msg.role}`}>
                              <div class="message-author">
                                <span>{msg.role === 'user' ? 'Você' : agent().name}</span>
                                <span style={{ 'font-size': '10px', opacity: 0.6 }}>
                                  {new Date(msg.createdAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>

                              {/* Badge de Delegação se a mensagem veio de outro agente */}
                              <Show when={msg.senderAgentId}>
                                <span class="delegation-badge">
                                  🤝 Pedido vindo de um agente da equipe
                                </span>
                              </Show>

                              <div class={`message-bubble ${msg.role}`}>
                                <Show when={structured().delegationHeader}>
                                  {(header) => (
                                    <div class="structured-delegation-card">
                                      <span class="structured-delegation-icon">🤝</span>
                                      <span>{header()}</span>
                                    </div>
                                  )}
                                </Show>

                                <For each={structured().blocks}>
                                  {(block) => (
                                    <Show
                                      when={block.kind === 'code'}
                                      fallback={
                                        <Show
                                          when={msg.role === 'assistant'}
                                          fallback={
                                            <div class="msg-text-segment">{block.content}</div>
                                          }
                                        >
                                          <MessageText text={block.content} />
                                        </Show>
                                      }
                                    >
                                      <div class="code-block-card">
                                        <div class="code-block-header">
                                          <span>{block.language || 'código'}</span>
                                        </div>
                                        <pre class="code-block-pre">
                                          <code>{block.content}</code>
                                        </pre>
                                      </div>
                                    </Show>
                                  )}
                                </For>

                                {/* Lista de Anexos anexados na mensagem */}
                                <Show when={msg.attachments && msg.attachments.length > 0}>
                                  <div class="message-attachments-list">
                                    <For each={msg.attachments}>
                                      {(att) => (
                                        <button
                                          type="button"
                                          class="attachment-card"
                                          onClick={() => handleOpenFile(att.filePath)}
                                          title="Clique para abrir o arquivo"
                                        >
                                          <span class="attachment-icon">📎</span>
                                          <div class="attachment-info">
                                            <span class="attachment-name">{att.fileName}</span>
                                            <span class="attachment-size">
                                              {formatFileSize(att.fileSize)}
                                            </span>
                                          </div>
                                        </button>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </div>
                            </div>
                          )
                        }}
                      </For>

                      {/* Resposta em streaming em tempo real */}
                      <Show when={isStreaming()}>
                        <div class="message-row assistant">
                          <div class="message-author">
                            <span>{agent().name}</span>
                            <span class="streaming-pill">escrevendo...</span>
                          </div>
                          <div class="message-bubble assistant streaming">
                            <MessageText
                              text={streamingText() || 'Pensando e preparando sua resposta...'}
                            />
                            <div class="streaming-indicator">
                              <span class="pulse-dot" />
                              <span>Trabalhando no seu pedido...</span>
                            </div>
                          </div>
                        </div>
                      </Show>
                    </Show>

                    <div ref={messagesEndRef} />
                  </div>

                  {/* Alerta de erro se houver */}
                  <Show when={chatError()}>
                    <div class="error-banner">
                      <span>⚠️ Ops, algo deu errado: {chatError()}</span>
                      <button
                        type="button"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                        }}
                        onClick={() => setChatError(null)}
                      >
                        ✕
                      </button>
                    </div>
                  </Show>

                  <For each={approvals().filter((a) => a.threadId === activeThread()?.id)}>
                    {(a) => <ApprovalCard approval={a} />}
                  </For>

                  {/* Barra de input do chat — Simples e Intuitiva */}
                  <div class="chat-input-container">
                    {/* Menu flutuante de sugestões de menção @ */}
                    <Show when={mentionQuery() !== null && filteredMentionAgents().length > 0}>
                      <div class="composer-mention-menu">
                        <For each={filteredMentionAgents()}>
                          {(teammate, idx) => (
                            <button
                              type="button"
                              class="composer-mention-item"
                              classList={{ selected: idx() === mentionSelectedIndex() }}
                              onClick={() => applyMention(teammate)}
                              aria-label={`Mencionar ${teammate.name}`}
                            >
                              <span
                                class="agent-avatar"
                                style={{ background: agentColor(teammate.name) }}
                              >
                                {teammate.avatar || initialsOf(teammate.name)}
                              </span>
                              <span class="composer-mention-name">@{teammate.name}</span>
                              <Show when={teammate.role === 'orchestrator'}>
                                <span class="composer-mention-role">Coordenador</span>
                              </Show>
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>

                    <form class="chat-input-form" onSubmit={handleSendMessage}>
                      {/* Arquivos anexados antes do envio */}
                      <Show when={stagedFiles().length > 0}>
                        <div class="attachments-preview-bar">
                          <For each={stagedFiles()}>
                            {(file, index) => (
                              <div class="attachment-chip">
                                <span>
                                  📎 {file.fileName} ({formatFileSize(file.fileSize)})
                                </span>
                                <button
                                  type="button"
                                  class="attachment-chip-remove"
                                  onClick={() => removeStagedFile(index())}
                                >
                                  <RailIcon name="close" />
                                </button>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>

                      <textarea
                        ref={(el) => {
                          chatTextareaRef = el
                        }}
                        class="chat-textarea"
                        placeholder={`Mensagem para ${agent().name}…`}
                        aria-label={`Mensagem para ${agent().name}`}
                        value={inputText()}
                        onInput={(e) => {
                          setInputText(e.currentTarget.value)
                          updateMentionState(e.currentTarget)
                        }}
                        onKeyDown={handleKeyDown}
                        onClick={(e) => updateMentionState(e.currentTarget)}
                        onBlur={() => {
                          setTimeout(() => setMentionQuery(null), 200)
                        }}
                      />
                      <div class="chat-actions-bar">
                        <div class="composer-inline-pills">
                          <button
                            type="button"
                            class="btn-outline composer-action-btn"
                            onClick={handleSelectFiles}
                            title="Enviar um arquivo ou imagem junto com sua mensagem"
                            aria-label="Anexar arquivo"
                          >
                            <RailIcon name="link" />
                          </button>

                          <Show when={otherAgents().length > 0}>
                            <button
                              type="button"
                              class="btn-outline composer-action-btn"
                              onClick={() => {
                                const current = inputText()
                                const newText = current
                                  ? current.endsWith(' ')
                                    ? `${current}@`
                                    : `${current} @`
                                  : '@'
                                setInputText(newText)
                                setMentionQuery('')
                                setMentionSelectedIndex(0)
                                if (chatTextareaRef) {
                                  chatTextareaRef.focus()
                                  chatTextareaRef.setSelectionRange(newText.length, newText.length)
                                }
                              }}
                              title="Mencionar agente da equipe (@)"
                              aria-label="Mencionar agente"
                            >
                              @
                            </button>
                          </Show>

                          <button
                            type="button"
                            class={`composer-autonomy-pill ${agent().autonomyLevel || 'autonomous'}`}
                            onClick={() =>
                              handleSwitchAutonomyLevel(
                                agent().id,
                                (agent().autonomyLevel || 'autonomous') === 'autonomous'
                                  ? 'cautious'
                                  : 'autonomous',
                              )
                            }
                            title="Clique para alternar entre execução automática e confirmação prévia"
                          >
                            {(agent().autonomyLevel || 'autonomous') === 'cautious'
                              ? 'Pedir confirmação'
                              : 'Automático'}
                          </button>

                          <select
                            class="composer-model-select"
                            aria-label="Modelo de IA"
                            title="Trocar modelo de IA"
                            value={agent().model}
                            onChange={(e) => {
                              if (e.currentTarget.value === '__settings__') {
                                setShowAgentSettings(true)
                              } else {
                                void handleSwitchModelMidChat(agent().id, e.currentTarget.value)
                              }
                            }}
                          >
                            <Show
                              when={
                                !modelsFor(agent().provider, agent().accountId).includes(
                                  agent().model,
                                )
                              }
                            >
                              <option value={agent().model}>{agent().model}</option>
                            </Show>
                            <For each={modelsFor(agent().provider, agent().accountId)}>
                              {(m) => <option value={m}>{m}</option>}
                            </For>
                            <option value="__settings__">Ajustes…</option>
                          </select>
                          <Show when={supportsEffort(agent().provider)}>
                            <select
                              class="composer-effort-select"
                              aria-label="Nível de raciocínio"
                              title="Nível de raciocínio: mais alto pensa mais, mas demora e gasta mais"
                              value={agent().effort ?? ''}
                              onChange={(e) =>
                                handleSwitchEffort(
                                  agent().id,
                                  e.currentTarget.value as ProviderEffort | '',
                                )
                              }
                            >
                              <For
                                each={effortsFor(
                                  agent().provider,
                                  agent().model,
                                  agent().accountId,
                                )}
                              >
                                {([value, label]) => <option value={value}>{label}</option>}
                              </For>
                            </select>
                          </Show>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
                          <Show when={isStreaming()}>
                            <button
                              type="button"
                              class="btn-interrupt"
                              onClick={handleInterrupt}
                              aria-label="Parar geração"
                            >
                              <span class="btn-interrupt-icon" /> Parar
                            </button>
                          </Show>
                          <button
                            type="submit"
                            class="btn-primary btn-send-msg"
                            disabled={!inputText().trim() && stagedFiles().length === 0}
                          >
                            Enviar
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                </Show>

                {/* Modo Navegador Embarcado (Fase 5) */}
                <Show when={mainViewMode() === 'browser'}>
                  <div class="browser-workspace">
                    {/* Strip de Abas */}
                    <div class="browser-tabs-strip">
                      <For
                        each={browserTabs()}
                        fallback={
                          <span
                            style={{
                              'font-size': '11px',
                              color: 'var(--text-muted)',
                            }}
                          >
                            Nenhuma aba aberta
                          </span>
                        }
                      >
                        {(tab) => (
                          <div
                            role="tab"
                            tabIndex={0}
                            class={`browser-tab-chip ${activeTabId() === tab.id ? 'active' : ''}`}
                            onClick={() => {
                              setActiveTabId(tab.id)
                              setBrowserUrlInput(tab.url)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                setActiveTabId(tab.id)
                                setBrowserUrlInput(tab.url)
                              }
                            }}
                          >
                            <span
                              style={{
                                overflow: 'hidden',
                                'text-overflow': 'ellipsis',
                              }}
                            >
                              {tab.isLoading ? '⏳ ' : '🌐 '}
                              {tab.title || tab.url}
                            </span>
                            <button
                              type="button"
                              class="browser-tab-close"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleCloseBrowserTab(tab.id)
                              }}
                              title="Fechar aba"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </For>
                      <button
                        type="button"
                        class="btn-new-tab"
                        onClick={() => handleOpenBrowserTab('https://github.com')}
                        title="Abrir nova aba"
                      >
                        + Nova Aba
                      </button>
                    </div>

                    {/* Barra de Navegação */}
                    <div class="browser-navbar">
                      <button
                        type="button"
                        class="browser-nav-btn"
                        onClick={() => handleBrowserNavigate('back')}
                        title="Voltar"
                        disabled={!activeTabId()}
                      >
                        ⬅️
                      </button>
                      <button
                        type="button"
                        class="browser-nav-btn"
                        onClick={() => handleBrowserNavigate('forward')}
                        title="Avançar"
                        disabled={!activeTabId()}
                      >
                        ➡️
                      </button>
                      <button
                        type="button"
                        class="browser-nav-btn"
                        onClick={() => handleBrowserNavigate('reload')}
                        title="Recarregar"
                        disabled={!activeTabId()}
                      >
                        🔄
                      </button>

                      <input
                        type="text"
                        class="browser-url-input"
                        placeholder="Digite uma URL (ex: https://github.com)..."
                        value={browserUrlInput()}
                        onInput={(e) => setBrowserUrlInput(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            handleOpenBrowserTab(browserUrlInput())
                          }
                        }}
                      />

                      <button
                        type="button"
                        class="btn-primary"
                        disabled={browserLoading() || !browserUrlInput().trim()}
                        onClick={() => handleOpenBrowserTab(browserUrlInput())}
                      >
                        {browserLoading() ? 'Carregando...' : 'Ir'}
                      </button>
                    </div>

                    {/* Barra de Supervisão e Ações */}
                    <div class="browser-actions-bar">
                      <div class="browser-actions-group">
                        <button
                          type="button"
                          class="btn-outline"
                          style={{ padding: '4px 8px', 'font-size': '11.5px' }}
                          onClick={handleBrowserScreenshot}
                          disabled={!activeTabId()}
                          title="Capturar imagem atual da página"
                        >
                          📸 Capturar Tela
                        </button>
                        <button
                          type="button"
                          class="btn-outline"
                          style={{ padding: '4px 8px', 'font-size': '11.5px' }}
                          onClick={handleBrowserInspect}
                          disabled={!activeTabId()}
                          title="Inspecionar estrutura DOM e links sanitizados"
                        >
                          🔍 Inspecionar DOM
                        </button>
                      </div>

                      <div class="browser-actions-group">
                        <span
                          class="supervision-badge"
                          title="Sessão particionada exclusiva do agente com bloqueio de popups e downloads arbitrários"
                        >
                          🛡️ persist:agent-{agent().id.slice(0, 8)}
                        </span>
                      </div>
                    </div>

                    {/* Banner de status / mensagem de ação do navegador */}
                    <Show when={browserStatusMsg()}>
                      <div
                        class="error-banner"
                        style={{
                          background: 'rgba(16, 185, 129, 0.15)',
                          'border-color': 'rgba(16, 185, 129, 0.4)',
                          color: '#34d399',
                          margin: '10px 16px 0 16px',
                        }}
                      >
                        <span>✅ {browserStatusMsg()}</span>
                      </div>
                    </Show>

                    {/* Layout Viewport + Inspector */}
                    <div class="browser-viewport-layout">
                      <div class="browser-main-view">
                        <Show
                          when={currentActiveTab()}
                          fallback={
                            <div class="browser-empty-state">
                              <div class="browser-empty-icon">🌐</div>
                              <h3
                                style={{
                                  'font-size': '15px',
                                  'margin-bottom': '8px',
                                  color: 'var(--text-main)',
                                }}
                              >
                                Navegador Isolado do Agente
                              </h3>
                              <p
                                style={{
                                  'font-size': '12.5px',
                                  'line-height': '1.5',
                                }}
                              >
                                Abra páginas web com segurança em uma partição isolada com cookies e
                                cache próprios deste agente. O agente pode extrair dados,
                                inspecionar links e interagir com supervisão.
                              </p>
                              <div class="browser-shortcut-chips">
                                <button
                                  type="button"
                                  class="shortcut-chip"
                                  onClick={() => handleOpenBrowserTab('https://github.com')}
                                >
                                  GitHub
                                </button>
                                <button
                                  type="button"
                                  class="shortcut-chip"
                                  onClick={() =>
                                    handleOpenBrowserTab('https://news.ycombinator.com')
                                  }
                                >
                                  Hacker News
                                </button>
                                <button
                                  type="button"
                                  class="shortcut-chip"
                                  onClick={() => handleOpenBrowserTab('https://wikipedia.org')}
                                >
                                  Wikipédia
                                </button>
                              </div>
                            </div>
                          }
                        >
                          {(tab) => (
                            <>
                              <div class="browser-card">
                                <div class="browser-card-title">
                                  <span>{tab().title}</span>
                                  <span
                                    style={{
                                      'font-size': '11px',
                                      color: 'var(--text-muted)',
                                      'font-weight': 'normal',
                                    }}
                                  >
                                    ID: {tab().id}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    'font-size': '12px',
                                    color: '#60a5fa',
                                    'word-break': 'break-all',
                                  }}
                                >
                                  {tab().url}
                                </div>
                              </div>

                              {/* Visualizador de Screenshot */}
                              <div class="browser-card">
                                <div class="browser-card-title">
                                  <span>Visualização em Tempo Real</span>
                                  <button
                                    type="button"
                                    class="btn-outline"
                                    style={{
                                      padding: '2px 6px',
                                      'font-size': '10.5px',
                                    }}
                                    onClick={handleBrowserScreenshot}
                                  >
                                    Atualizar Visão
                                  </button>
                                </div>
                                <Show
                                  when={browserScreenshotUrl()}
                                  fallback={
                                    <div
                                      style={{
                                        padding: '30px',
                                        'text-align': 'center',
                                        color: 'var(--text-muted)',
                                        'font-size': '12px',
                                      }}
                                    >
                                      📸 Clique em "Capturar Tela" para renderizar o snapshot da
                                      página.
                                    </div>
                                  }
                                >
                                  <img
                                    src={browserScreenshotUrl() || ''}
                                    alt="Screenshot da página"
                                    class="browser-screenshot-img"
                                  />
                                </Show>
                              </div>

                              {/* Ações Rápidas de Interação Supervisionada */}
                              <div class="browser-card">
                                <div class="browser-card-title">
                                  <span>Interação Supervisionada (Clique & Preenchimento)</span>
                                </div>
                                <div class="quick-interact-bar">
                                  <div class="quick-interact-form">
                                    <span
                                      style={{
                                        'font-size': '11px',
                                        'font-weight': '600',
                                      }}
                                    >
                                      Clicar Elemento
                                    </span>
                                    <input
                                      type="text"
                                      class="quick-interact-input"
                                      placeholder="Seletor CSS (ex: #btn, .submit)"
                                      value={browserClickSelector()}
                                      onInput={(e) =>
                                        setBrowserClickSelector(e.currentTarget.value)
                                      }
                                    />
                                    <button
                                      type="button"
                                      class="btn-outline"
                                      style={{
                                        'font-size': '11px',
                                        padding: '4px',
                                      }}
                                      onClick={() => handleBrowserClick(browserClickSelector())}
                                      disabled={!browserClickSelector().trim()}
                                    >
                                      👆 Executar Clique
                                    </button>
                                  </div>

                                  <div class="quick-interact-form">
                                    <span
                                      style={{
                                        'font-size': '11px',
                                        'font-weight': '600',
                                      }}
                                    >
                                      Preencher Formulário
                                    </span>
                                    <input
                                      type="text"
                                      class="quick-interact-input"
                                      placeholder="Seletor CSS (ex: #search-box)"
                                      value={browserFillSelector()}
                                      onInput={(e) => setBrowserFillSelector(e.currentTarget.value)}
                                    />
                                    <input
                                      type="text"
                                      class="quick-interact-input"
                                      placeholder="Valor a digitar..."
                                      value={browserFillValue()}
                                      onInput={(e) => setBrowserFillValue(e.currentTarget.value)}
                                    />
                                    <button
                                      type="button"
                                      class="btn-outline"
                                      style={{
                                        'font-size': '11px',
                                        padding: '4px',
                                      }}
                                      onClick={() =>
                                        handleBrowserFill(browserFillSelector(), browserFillValue())
                                      }
                                      disabled={!browserFillSelector().trim()}
                                    >
                                      ✏️ Preencher Campo
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                        </Show>
                      </div>

                      {/* Painel Lateral: Inspetor DOM Sanitizado */}
                      <div class="browser-inspect-pane">
                        <div
                          style={{
                            'font-weight': '700',
                            'font-size': '13px',
                            display: 'flex',
                            'align-items': 'center',
                            'justify-content': 'space-between',
                          }}
                        >
                          <span>Inspeção DOM Sanitizada</span>
                          <Show when={browserInspectData()}>
                            <span
                              style={{
                                'font-size': '10.5px',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {browserInspectData()?.links.length || 0} links •{' '}
                              {browserInspectData()?.inputs.length || 0} campos
                            </span>
                          </Show>
                        </div>

                        <Show
                          when={browserInspectData()}
                          fallback={
                            <div
                              style={{
                                color: 'var(--text-muted)',
                                'font-size': '12px',
                                'line-height': '1.5',
                                margin: 'auto',
                                'text-align': 'center',
                                padding: '20px',
                              }}
                            >
                              🔍 Clique em <strong>"Inspecionar DOM"</strong> para extrair a
                              estrutura de links, campos e resumo textual sanitizado da página sem
                              risco de scripts adversários.
                            </div>
                          }
                        >
                          {(data) => (
                            <>
                              <div>
                                <div
                                  style={{
                                    'font-weight': '600',
                                    'font-size': '11.5px',
                                    'margin-bottom': '4px',
                                  }}
                                >
                                  Resumo Textual
                                </div>
                                <div class="inspect-summary-box">
                                  {data().textSummary ||
                                    'Nenhum texto detectado no corpo da página.'}
                                </div>
                              </div>

                              <div>
                                <div
                                  style={{
                                    'font-weight': '600',
                                    'font-size': '11.5px',
                                    'margin-bottom': '4px',
                                  }}
                                >
                                  Links Detectados ({data().links.length})
                                </div>
                                <div class="inspect-links-list">
                                  <For
                                    each={data().links}
                                    fallback={
                                      <span
                                        style={{
                                          'font-size': '11px',
                                          color: 'var(--text-muted)',
                                        }}
                                      >
                                        Nenhum link
                                      </span>
                                    }
                                  >
                                    {(link) => (
                                      <button
                                        type="button"
                                        class="inspect-link-btn"
                                        onClick={() => handleOpenBrowserTab(link.href)}
                                        title={`Abrir ${link.href}`}
                                      >
                                        🔗 {link.text || link.href}
                                      </button>
                                    )}
                                  </For>
                                </div>
                              </div>

                              <div>
                                <div
                                  style={{
                                    'font-weight': '600',
                                    'font-size': '11.5px',
                                    'margin-bottom': '4px',
                                  }}
                                >
                                  Campos de Formulário ({data().inputs.length})
                                </div>
                                <div class="inspect-inputs-list">
                                  <For
                                    each={data().inputs}
                                    fallback={
                                      <span
                                        style={{
                                          'font-size': '11px',
                                          color: 'var(--text-muted)',
                                        }}
                                      >
                                        Nenhum campo
                                      </span>
                                    }
                                  >
                                    {(input) => (
                                      <div class="inspect-input-row">
                                        <div>
                                          <span style={{ 'font-weight': '600' }}>
                                            {input.name || input.id || input.selector}
                                          </span>
                                          <span
                                            style={{
                                              color: 'var(--text-muted)',
                                              'margin-left': '4px',
                                            }}
                                          >
                                            ({input.type})
                                          </span>
                                        </div>
                                        <button
                                          type="button"
                                          class="queue-btn-action"
                                          onClick={() => {
                                            setBrowserFillSelector(input.selector)
                                          }}
                                          title="Selecionar para preenchimento"
                                        >
                                          Selecionar
                                        </button>
                                      </div>
                                    )}
                                  </For>
                                </div>
                              </div>
                            </>
                          )}
                        </Show>
                      </div>
                    </div>
                  </div>
                </Show>
                <Show when={miniBrowserOpen() ? currentActiveTab() : null}>
                  {(tab) => (
                    <MiniBrowser
                      tab={tab()}
                      scale={settings().uiScale}
                      onHide={() => setMiniBrowserOpen(false)}
                      onCloseTab={() => void handleCloseBrowserTab(tab().id)}
                    />
                  )}
                </Show>
              </div>
            )}
          </Show>
        </Show>
      </main>

      <Show when={accountsConnection()}>
        {(connection) => (
          <ProviderAccounts
            connection={connection()}
            onClose={() => setAccountsProvider(null)}
            onChange={loadConnections}
          />
        )}
      </Show>

      <Show when={settingsLoaded() && !settings().providersSetupDone}>
        <dialog
          ref={focusDialog}
          aria-modal="true"
          class="modal-overlay"
          aria-labelledby="providers-setup-title"
          open
        >
          <div class="modal-content providers-setup" role="document">
            <div class="modal-header">
              <h2 id="providers-setup-title">Com qual IA você quer começar?</h2>
            </div>
            <p class="first-run-hint">
              Escolha uma IA pronta para começar. Você pode mudar essa escolha ou ativar outras em
              Configurações → Provedores.
            </p>
            <Show
              when={readyProviders().length > 0}
              fallback={
                <p class="first-run-hint">
                  Abra Outros provedores para configurar sua primeira IA.
                </p>
              }
            >
              <div class="provider-picker" aria-label="Provedores prontos">
                <For each={readyProviders()}>
                  {(connection) => <SetupProvider connection={connection} />}
                </For>
              </div>
            </Show>
            <Show when={otherProviders().length > 0}>
              <details class="setup-other-providers">
                <summary>Outros provedores ({otherProviders().length})</summary>
                <div class="provider-picker">
                  <For each={otherProviders()}>
                    {(connection) => <SetupProvider connection={connection} />}
                  </For>
                </div>
              </details>
            </Show>
            <Show when={setupError()}>
              <p class="error-banner" role="alert">
                {setupError()}
              </p>
            </Show>
            <div class="modal-actions">
              <button
                type="button"
                class="btn-outline"
                disabled={savingSetup()}
                onClick={() => finishProvidersSetup('')}
              >
                Configurar depois
              </button>
              <button
                type="button"
                class="btn-primary"
                disabled={!setupChoice() || savingSetup()}
                onClick={() => finishProvidersSetup(setupChoice())}
              >
                Começar
              </button>
            </div>
          </div>
        </dialog>
      </Show>

      <Show when={showCustomProvider()}>
        <dialog
          ref={focusDialog}
          aria-modal="true"
          class="modal-overlay"
          aria-labelledby="custom-provider-title"
          open
          onClick={() => !creatingProvider() && closeCustomProvider()}
          onKeyDown={(e) => e.key === 'Escape' && !creatingProvider() && closeCustomProvider()}
        >
          <div
            class="modal-content"
            role="document"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape' && !creatingProvider()) closeCustomProvider()
            }}
          >
            <div class="modal-header">
              <h2 id="custom-provider-title">Adicionar provedor</h2>
            </div>
            <form
              class="modal-form"
              onSubmit={(e) => {
                e.preventDefault()
                void handleCreateCustomProvider()
              }}
            >
              <div class="form-group">
                <label for="custom-preset">Tipo</label>
                <select
                  id="custom-preset"
                  value={customPreset()}
                  disabled={creatingProvider()}
                  onChange={(e) => {
                    const preset = e.currentTarget.value as keyof typeof CUSTOM_PROVIDER_PRESETS
                    setCustomPreset(preset)
                    setCustomForm({
                      ...CUSTOM_PROVIDER_PRESETS[preset],
                      apiKey: '',
                    })
                  }}
                >
                  <option value="custom">OpenAI-compatible</option>
                  <option value="ollama">Ollama local</option>
                  <option value="openrouter">OpenRouter</option>
                  <option value="deepseek">DeepSeek</option>
                </select>
              </div>
              <div class="form-group">
                <label for="custom-name">Nome</label>
                <input
                  id="custom-name"
                  required
                  maxLength={100}
                  value={customForm().name}
                  disabled={creatingProvider()}
                  onInput={(e) =>
                    setCustomForm({
                      ...customForm(),
                      name: e.currentTarget.value,
                    })
                  }
                />
              </div>
              <div class="form-group">
                <label for="custom-endpoint">URL base da API</label>
                <input
                  id="custom-endpoint"
                  type="url"
                  required
                  value={customForm().endpoint}
                  disabled={creatingProvider()}
                  placeholder="http://localhost:11434/v1"
                  onInput={(e) =>
                    setCustomForm({
                      ...customForm(),
                      endpoint: e.currentTarget.value,
                    })
                  }
                />
                <small>
                  Informe a URL base, sem /chat/completions. O contexto das conversas será enviado a
                  esse endpoint.
                </small>
              </div>
              <div class="form-group">
                <label for="custom-model">Modelo padrão</label>
                <input
                  id="custom-model"
                  required
                  maxLength={200}
                  value={customForm().defaultModel}
                  disabled={creatingProvider()}
                  placeholder="ID exato do modelo disponível no provedor"
                  onInput={(e) =>
                    setCustomForm({
                      ...customForm(),
                      defaultModel: e.currentTarget.value,
                    })
                  }
                />
              </div>
              <div class="form-group">
                <label for="custom-key">API key (opcional para APIs locais)</label>
                <input
                  id="custom-key"
                  type="password"
                  autocomplete="new-password"
                  value={customForm().apiKey}
                  disabled={creatingProvider()}
                  onInput={(e) =>
                    setCustomForm({
                      ...customForm(),
                      apiKey: e.currentTarget.value,
                    })
                  }
                />
              </div>
              <Show when={customProviderError()}>
                <div class="connection-result-msg error" role="alert">
                  {customProviderError()}
                </div>
              </Show>
              <div class="modal-actions">
                <button
                  type="button"
                  class="btn-secondary"
                  disabled={creatingProvider()}
                  onClick={closeCustomProvider}
                >
                  Cancelar
                </button>
                <button type="submit" class="btn-primary" disabled={creatingProvider()}>
                  {creatingProvider() ? 'Salvando...' : 'Adicionar provedor'}
                </button>
              </div>
            </form>
          </div>
        </dialog>
      </Show>

      {/* Modal de Configuração do Provedor (ícone ⚙) */}
      <Show when={configConnection()}>
        {(conn) => {
          const draft = () => connectionDrafts()[conn().providerId] || {}
          const models = () => modelsFor(conn().providerId)
          return (
            <dialog
              ref={focusDialog}
              aria-modal="true"
              aria-label={`Configurar ${conn().name}`}
              class="modal-overlay"
              open
              onClick={() => setConfigProviderId(null)}
              onKeyDown={(e) => e.key === 'Escape' && setConfigProviderId(null)}
            >
              <div
                class="modal-content provider-config-modal"
                role="document"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Escape') setConfigProviderId(null)
                }}
              >
                <div class="modal-header">
                  <span class="modal-title">Configurar {conn().name}</span>
                  <button
                    type="button"
                    class="modal-close"
                    onClick={() => setConfigProviderId(null)}
                    aria-label="Fechar"
                  >
                    ✕
                  </button>
                </div>
                <div class="modal-form">
                  <div class="provider-config-status">
                    <span
                      class={`connection-status-pill ${!conn().enabled ? 'disabled' : conn().readiness === 'ready' ? 'online' : 'warning'}`}
                    >
                      {!conn().enabled ? '○ Desativado' : providerStatusLabel(conn())}
                    </span>
                    <Show when={conn().version}>
                      <span>{conn().version}</span>
                    </Show>
                  </div>
                  <Show when={conn().path || conn().cliCommand}>
                    <div class="provider-config-meta">
                      CLI: <code>{draft().cliPath || conn().path || conn().cliCommand}</code>
                      <Show when={conn().installHint}>
                        {' • '}Instalação: <code>{conn().installHint}</code>
                      </Show>
                    </div>
                  </Show>
                  <ManagedCliControls
                    providerId={conn().providerId}
                    onChange={() => {
                      void loadConnections()
                      void loadProviderUpdates()
                    }}
                  />
                  <Show when={conn().loginHint && conn().readiness !== 'ready'}>
                    <div class="provider-config-meta">
                      Para entrar: <code>{conn().loginHint}</code>
                    </div>
                  </Show>
                  <Show when={conn().error}>
                    <div class="connection-result-msg error">{conn().error}</div>
                  </Show>

                  <Show when={isCustomProvider(conn().providerId)}>
                    <div class="form-group">
                      <label for="cfg-provider-name">Nome do provedor</label>
                      <input
                        id="cfg-provider-name"
                        value={draft().name ?? conn().name}
                        onInput={(e) =>
                          updateDraftField(conn().providerId, 'name', e.currentTarget.value)
                        }
                      />
                    </div>
                  </Show>
                  <Show when={!isCustomProvider(conn().providerId)}>
                    <div class="form-group">
                      <label for="cfg-cli-path">Caminho da CLI (opcional)</label>
                      <input
                        id="cfg-cli-path"
                        type="text"
                        value={draft().cliPath ?? conn().cliPath ?? ''}
                        onInput={(e) =>
                          updateDraftField(conn().providerId, 'cliPath', e.currentTarget.value)
                        }
                        placeholder={`Padrão: ${conn().cliCommand || conn().providerId} (PATH)`}
                      />
                    </div>
                  </Show>

                  <Show when={conn().providerId === 'acp'}>
                    <div class="form-group">
                      <label for="cfg-cli-args">Argumentos ACP (lista JSON)</label>
                      <input
                        id="cfg-cli-args"
                        value={draft().cliArgs ?? JSON.stringify(conn().cliArgs ?? [])}
                        onInput={(e) =>
                          updateDraftField(conn().providerId, 'cliArgs', e.currentTarget.value)
                        }
                        placeholder={'["--acp"]'}
                      />
                      <small>
                        Informe o executável acima e os argumentos separados aqui. Sem shell. Faça
                        login na CLI antes de conectar.
                      </small>
                    </div>
                    <div class="form-group">
                      <label for="cfg-api-key-env">
                        Variável de ambiente da API key (opcional)
                      </label>
                      <input
                        id="cfg-api-key-env"
                        value={draft().apiKeyEnv ?? conn().apiKeyEnv ?? ''}
                        onInput={(e) =>
                          updateDraftField(conn().providerId, 'apiKeyEnv', e.currentTarget.value)
                        }
                        placeholder="Ex.: ANTHROPIC_API_KEY"
                      />
                      <small>
                        Se usar a chave salva abaixo, informe a variável esperada pelo agente. Sem
                        chave salva, o agente usa o login e o ambiente locais.
                      </small>
                    </div>
                  </Show>

                  <div class="form-group">
                    <label for="cfg-model">Modelo padrão</label>
                    <ModelPicker
                      id="cfg-model"
                      models={models()}
                      value={draft().defaultModel ?? conn().defaultModel}
                      onChange={(value) =>
                        updateDraftField(conn().providerId, 'defaultModel', value)
                      }
                    />
                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        'align-items': 'center',
                      }}
                    >
                      <button
                        type="button"
                        class="btn-outline"
                        onClick={() => handleDiscoverModels(conn().providerId)}
                        disabled={discoveringProvider() === conn().providerId}
                      >
                        {discoveringProvider() === conn().providerId
                          ? 'Descobrindo...'
                          : '↻ Descobrir modelos via CLI'}
                      </button>
                      <Show when={discoverMessage()[conn().providerId]}>
                        <span
                          style={{
                            'font-size': '11px',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {discoverMessage()[conn().providerId]}
                        </span>
                      </Show>
                    </div>
                  </div>

                  <Show when={conn().supportsEffort}>
                    <div class="form-group">
                      <label for="cfg-effort">Esforço de raciocínio</label>
                      <select
                        id="cfg-effort"
                        value={draft().effort ?? conn().effort ?? 'medium'}
                        onChange={(e) =>
                          updateDraftField(
                            conn().providerId,
                            'effort',
                            e.currentTarget.value as ProviderEffort,
                          )
                        }
                      >
                        <For
                          each={effortsFor(
                            conn().providerId,
                            draft().defaultModel ?? conn().defaultModel,
                          ).slice(1)}
                        >
                          {([value, label]) => <option value={value}>{label}</option>}
                        </For>
                      </select>
                    </div>
                  </Show>

                  <div class="form-group">
                    <label for="cfg-api-key">Chave de acesso / API Key</label>
                    <input
                      id="cfg-api-key"
                      type="password"
                      value={draft().apiKey ?? ''}
                      onInput={(e) =>
                        updateDraftField(conn().providerId, 'apiKey', e.currentTarget.value)
                      }
                      placeholder={
                        conn().hasApiKey
                          ? 'Chave cadastrada; digite para substituir'
                          : isCustomProvider(conn().providerId)
                            ? 'Opcional para APIs locais sem autenticação'
                            : 'Vazio = login da CLI / variável de ambiente'
                      }
                    />
                    <Show when={conn().keyStorageError}>
                      <output>{conn().keyStorageError}</output>
                    </Show>
                    <Show when={conn().hasApiKey}>
                      <button
                        type="button"
                        onClick={() => updateDraftField(conn().providerId, 'apiKey', '')}
                      >
                        Remover chave ao salvar
                      </button>
                      <Show when={draft().apiKey === ''}>
                        <output>A chave será removida ao salvar.</output>
                      </Show>
                    </Show>
                  </div>

                  <Show when={conn().providerId !== 'acp'}>
                    <div class="form-group">
                      <label for="cfg-endpoint">
                        {isCustomProvider(conn().providerId)
                          ? 'URL base da API'
                          : 'Endpoint customizado (opcional)'}
                      </label>
                      <input
                        id="cfg-endpoint"
                        type="text"
                        value={draft().endpoint ?? conn().endpoint ?? ''}
                        onInput={(e) =>
                          updateDraftField(conn().providerId, 'endpoint', e.currentTarget.value)
                        }
                        placeholder="Ex: https://api.x.ai/v1, http://localhost:11434/v1 (Ollama)..."
                      />
                    </div>
                  </Show>

                  <Show when={testResults()[conn().providerId]}>
                    {(res) => (
                      <div class={`connection-result-msg ${res().success ? 'success' : 'error'}`}>
                        <strong>{res().success ? '✓ Sucesso: ' : '✗ Erro: '}</strong>
                        {res().message}
                      </div>
                    )}
                  </Show>
                  <Show when={saveMessage()[conn().providerId]}>
                    {(msg) => <div class="connection-save-feedback">✓ {msg()}</div>}
                  </Show>

                  <div class="modal-actions">
                    <Show when={isCustomProvider(conn().providerId)}>
                      <button
                        type="button"
                        class="btn-outline"
                        onClick={() => handleDeleteCustomProvider(conn())}
                      >
                        Remover provedor
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="btn-outline"
                      onClick={() => handleTestConnection(conn().providerId)}
                      disabled={testingConnection() === conn().providerId}
                    >
                      {testingConnection() === conn().providerId
                        ? 'Testando...'
                        : '🧪 Testar conexão'}
                    </button>
                    <button
                      type="button"
                      class="btn-secondary"
                      onClick={() => setConfigProviderId(null)}
                    >
                      Fechar
                    </button>
                    <button
                      type="button"
                      class="btn-primary"
                      onClick={async () => {
                        if (await handleSaveConnection(conn())) setConfigProviderId(null)
                      }}
                      disabled={savingConnection() === conn().providerId}
                    >
                      {savingConnection() === conn().providerId ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>
                </div>
              </div>
            </dialog>
          )
        }}
      </Show>

      {/* Modal Delegar Tarefa para Outro Agente (Fase 4) */}
      <Show when={showDelegationModal()}>
        <dialog
          ref={focusDialog}
          aria-modal="true"
          class="modal-overlay"
          open
          onClick={() => setShowDelegationModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowDelegationModal(false)}
        >
          <div
            class="modal-content"
            role="document"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div class="modal-header">
              <span class="modal-title">Delegar Tarefa Entre Agentes</span>
              <button
                type="button"
                class="modal-close"
                onClick={() => setShowDelegationModal(false)}
              >
                ✕
              </button>
            </div>

            <form class="modal-form" onSubmit={handleExecuteDelegation}>
              <Show when={delegationError()}>
                <div style={{ color: 'var(--danger)', 'font-size': '12px' }}>
                  {delegationError()}
                </div>
              </Show>

              <div class="form-group">
                <label for="delegation-from">Agente de Origem</label>
                <input
                  id="delegation-from"
                  type="text"
                  value={currentAgent()?.name || ''}
                  disabled
                />
              </div>

              <div class="form-group">
                <label for="delegation-to">Delegar Para (Agente de Destino)</label>
                <select
                  id="delegation-to"
                  value={delegationTargetId()}
                  onChange={(e) => setDelegationTargetId(e.currentTarget.value)}
                  required
                >
                  <For each={otherAgents()}>
                    {(other) => (
                      <option value={other.id}>
                        {other.name} ({other.provider} • {other.model})
                      </option>
                    )}
                  </For>
                </select>
              </div>

              <div class="form-group">
                <label for="delegation-prompt">Instrução / Tarefa a ser Delegada</label>
                <textarea
                  id="delegation-prompt"
                  placeholder="Ex: Por favor, analise a consistência das funções exportadas neste arquivo..."
                  value={delegationPrompt()}
                  onInput={(e) => setDelegationPrompt(e.currentTarget.value)}
                  required
                />
              </div>

              <div class="modal-actions">
                <button
                  type="button"
                  class="btn-secondary"
                  onClick={() => setShowDelegationModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  class="btn-primary"
                  disabled={delegationLoading() || !delegationPrompt().trim()}
                >
                  {delegationLoading() ? 'Delegando...' : 'Confirmar Delegação'}
                </button>
              </div>
            </form>
          </div>
        </dialog>
      </Show>

      {/* Modal Criar Agente com Escolha de Provedor (Codex ou Claude) */}
      <Show when={brainProject()}>
        {(project) => <BrainPanel project={project()} onClose={() => setBrainProject(null)} />}
      </Show>

      {/* Modal Novo Projeto (pasta de robôs) */}
      <Show when={showProjectModal()}>
        <dialog
          ref={focusDialog}
          aria-modal="true"
          class="modal-overlay"
          open
          onClick={() => setShowProjectModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowProjectModal(false)}
        >
          <div
            class="modal-content"
            role="document"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div class="modal-header">
              <span class="modal-title">Novo Projeto</span>
              <button type="button" class="modal-close" onClick={() => setShowProjectModal(false)}>
                ✕
              </button>
            </div>
            <form class="modal-form" onSubmit={handleCreateProject}>
              <div class="form-group">
                <label for="project-name">Nome do projeto</label>
                <input
                  id="project-name"
                  type="text"
                  placeholder="Ex: Cliente X, Meu SaaS, Estudos..."
                  value={projectFormName()}
                  onInput={(e) => setProjectFormName(e.currentTarget.value)}
                  required
                />
              </div>
              <div class="form-group">
                <label for="project-desc">Descrição (opcional)</label>
                <input
                  id="project-desc"
                  type="text"
                  placeholder="O que os robôs deste projeto fazem juntos"
                  value={projectFormDescription()}
                  onInput={(e) => setProjectFormDescription(e.currentTarget.value)}
                />
              </div>
              <div class="form-group">
                <label for="project-path">Pasta do projeto (cria no disco)</label>
                <input
                  id="project-path"
                  type="text"
                  placeholder="Ex: /home/joao/Projetos/cliente-x"
                  value={projectFormPath()}
                  onInput={(e) => setProjectFormPath(e.currentTarget.value)}
                />
              </div>
              <div class="modal-actions">
                <button
                  type="button"
                  class="btn-secondary"
                  onClick={() => setShowProjectModal(false)}
                >
                  Cancelar
                </button>
                <button type="submit" class="btn-primary" disabled={!projectFormName().trim()}>
                  Criar Projeto
                </button>
              </div>
            </form>
          </div>
        </dialog>
      </Show>

      <Show when={showModal()}>
        <dialog
          ref={focusDialog}
          aria-modal="true"
          class="modal-overlay"
          aria-labelledby="new-agent-title"
          open
          onClick={() => setShowModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowModal(false)}
        >
          <div
            class="modal-content"
            role="document"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setShowModal(false)
            }}
          >
            <div class="modal-header">
              <span class="modal-title" id="new-agent-title">
                Novo agente
              </span>
              <button
                type="button"
                class="modal-close"
                aria-label="Fechar criação de agente"
                onClick={() => setShowModal(false)}
              >
                ✕
              </button>
            </div>

            <form class="modal-form" onSubmit={handleCreateAgent}>
              <Show when={errorMessage()}>
                <div style={{ color: 'var(--danger)', 'font-size': '12px' }}>{errorMessage()}</div>
              </Show>

              <div class="form-row form-row-avatar">
                <div class="form-group">
                  <label for="agent-name">Nome</label>
                  <input
                    id="agent-name"
                    type="text"
                    placeholder="Ex: Revisor de PRs, Pesquisador, Engenheiro..."
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class="form-group">
                  <label for="agent-avatar">Avatar (opcional)</label>
                  <input
                    id="agent-avatar"
                    type="text"
                    maxLength={8}
                    placeholder="🤖"
                    value={newAvatar()}
                    onInput={(e) => setNewAvatar(e.currentTarget.value)}
                  />
                </div>
              </div>

              <div class="form-group">
                <label for="agent-description">Descrição curta</label>
                <input
                  id="agent-description"
                  type="text"
                  placeholder="Ex: Revisa pull requests e aponta riscos de regressão"
                  value={description()}
                  onInput={(e) => setDescription(e.currentTarget.value)}
                />
              </div>

              <div class="form-group">
                <label for="agent-provider">IA</label>
                <Show
                  when={connections().some((c) => c.enabled)}
                  fallback={
                    <button
                      type="button"
                      class="btn-outline"
                      onClick={() => {
                        setShowModal(false)
                        openSettings('provedores')
                      }}
                    >
                      Ativar um provedor primeiro
                    </button>
                  }
                >
                  <select
                    id="agent-provider"
                    value={provider()}
                    onChange={(e) =>
                      handleProviderChange(e.currentTarget.value as SupportedProvider)
                    }
                  >
                    <For each={connections().filter((c) => c.enabled)}>
                      {(conn) => (
                        <option value={conn.providerId}>
                          {conn.name}
                          {conn.readiness === 'ready' ? '' : ` — ${providerStatusLabel(conn)}`}
                        </option>
                      )}
                    </For>
                  </select>
                </Show>
              </div>
              <div class="form-row agent-model-row">
                <div class="form-group">
                  <label for="agent-model">Modelo</label>
                  <ModelPicker
                    id="agent-model"
                    models={modelsFor(provider(), newAccountId() || undefined)}
                    message={catalogWarnings()[catalogKey(provider(), newAccountId() || undefined)]}
                    onRefresh={() =>
                      loadModelCatalog(provider(), newAccountId() || undefined, true)
                    }
                    value={model()}
                    onChange={setModel}
                  />
                </div>
                <div class="form-group">
                  <label for="agent-effort">Esforço de raciocínio</label>
                  <select
                    id="agent-effort"
                    value={agentEffort()}
                    onChange={(e) => setAgentEffort(e.currentTarget.value as ProviderEffort | '')}
                  >
                    <For each={effortsFor(provider(), model(), newAccountId() || undefined)}>
                      {([value, label]) => <option value={value}>{label}</option>}
                    </For>
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label for="agent-instructions">Instruções</label>
                <textarea
                  id="agent-instructions"
                  placeholder="Ex: Você é um desenvolvedor focado em testes limpos..."
                  value={instructions()}
                  onInput={(e) => setInstructions(e.currentTarget.value)}
                  aria-describedby="agent-instructions-count"
                />
                <OverLimitCounter id="agent-instructions-count" text={instructions()} />
              </div>

              {/* Perfis prontos recolhíveis */}
              <details class="creation-collapsible-box">
                <summary>Perfis prontos</summary>
                <div class="modal-template-strip">
                  <For each={COWORKER_TEMPLATES}>
                    {(tpl) => (
                      <button
                        type="button"
                        class={`modal-template-pill ${name() === tpl.name ? 'active' : ''}`}
                        onClick={() => applyCoworkerTemplate(tpl)}
                        title={tpl.description}
                      >
                        <span>{tpl.avatar}</span>
                        <span>{tpl.name}</span>
                        <span class={`role-mini-tag ${tpl.role}`}>
                          {tpl.role === 'orchestrator' ? 'Coordenador' : 'Especialista'}
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </details>

              {/* Geração de rascunho por IA recolhível */}
              <details class="creation-collapsible-box">
                <summary>Gerar rascunho com IA</summary>
                <div class="form-group ai-draft-box">
                  <label for="agent-ai-prompt">O que este agente deve fazer?</label>
                  <textarea
                    id="agent-ai-prompt"
                    rows={3}
                    placeholder="Ex: um revisor de código rigoroso que aponta riscos de segurança e sugere testes"
                    value={aiPrompt()}
                    onInput={(e) => setAiPrompt(e.currentTarget.value)}
                  />
                  <button
                    type="button"
                    class="btn-outline"
                    disabled={drafting() || !aiPrompt().trim()}
                    onClick={draftForCreate}
                  >
                    {drafting() ? 'Gerando…' : 'Gerar rascunho'}
                  </button>
                  <Show when={draftNote()}>
                    <div style={{ 'font-size': '11px', color: 'var(--text-muted)' }}>
                      {draftNote()}
                    </div>
                  </Show>
                </div>
              </details>

              <details class="advanced-box">
                <summary>Avançado: projeto, autonomia e permissões</summary>
                <div class="form-group">
                  <label for="agent-role">Tipo</label>
                  <select
                    id="agent-role"
                    value={agentRole()}
                    onChange={(e) => setAgentRole(e.currentTarget.value as AgentRole)}
                  >
                    <option value="worker">Especialista — executa tarefas</option>
                    <option value="orchestrator">
                      Coordenador — distribui tarefas aos especialistas
                    </option>
                  </select>
                  <Show when={agentRole() === 'orchestrator'}>
                    <div
                      style={{
                        'font-size': '11px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      Você fala só com ele: ele distribui subtarefas aos especialistas do mesmo
                      projeto e resume os resultados aqui.
                    </div>
                  </Show>
                </div>

                <div class="form-group">
                  <label for="agent-project">Projeto (pasta)</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select
                      id="agent-project"
                      style={{ flex: 1 }}
                      value={agentProjectId()}
                      onChange={(e) => {
                        const id = e.currentTarget.value
                        setAgentProjectId(id)
                        const proj = projects().find((x) => x.id === id)
                        if (proj?.workspacePath) setWorkspacePath(proj.workspacePath)
                      }}
                    >
                      <option value="">Sem projeto</option>
                      <For each={projects()}>
                        {(proj) => <option value={proj.id}>{proj.name}</option>}
                      </For>
                    </select>
                    <button
                      type="button"
                      class="btn-outline"
                      onClick={() => setShowProjectModal(true)}
                      title="Criar novo projeto"
                    >
                      + Novo projeto
                    </button>
                  </div>
                </div>

                <div class="form-group">
                  <label for="agent-workspace">Pasta de trabalho</label>
                  <input
                    id="agent-workspace"
                    type="text"
                    value={workspacePath()}
                    onInput={(e) => setWorkspacePath(e.currentTarget.value)}
                    placeholder="Automática: ~/Orchbot/<nome do agente>"
                  />
                </div>

                <Show when={(providerAccounts()[provider()]?.length ?? 0) > 1}>
                  <div class="form-group">
                    <label for="new-agent-account">Conta do provedor</label>
                    <select
                      id="new-agent-account"
                      value={newAccountId()}
                      onChange={(event) => setNewAccountId(event.currentTarget.value)}
                    >
                      <option value="">Automática (Padrão → habilitadas)</option>
                      <For each={providerAccounts()[provider()] ?? []}>
                        {(account) => (
                          <option value={account.id} disabled={!account.enabled}>
                            {account.label}
                            {!account.enabled ? ' (desativada)' : ''}
                          </option>
                        )}
                      </For>
                    </select>
                  </div>
                </Show>

                <div class="form-group">
                  <label for="agent-autonomy">Nível de Autonomia</label>
                  <select
                    id="agent-autonomy"
                    style={{
                      'background-color': 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      'border-radius': 'var(--radius-sm)',
                      padding: '8px 12px',
                      color: 'var(--text-main)',
                      'font-size': '13px',
                      outline: 'none',
                      width: '100%',
                    }}
                    value={autonomyLevel()}
                    onChange={(e) => setAutonomyLevel(e.currentTarget.value as AutonomyLevel)}
                  >
                    <option value="autonomous">
                      Automático (executa tarefas da fila sequencialmente)
                    </option>
                    <option value="cautious">
                      Confirmar antes de cada passo (pede confirmação para ações e cliques)
                    </option>
                  </select>
                </div>

                <div class="form-group">
                  <label for="agent-context-mode">Contexto por turno (economia de tokens)</label>
                  <select
                    id="agent-context-mode"
                    value={agentContextMode()}
                    onChange={(e) => setAgentContextMode(e.currentTarget.value as ContextMode)}
                  >
                    <option value="economico">Econômico (resumo + últimas 4 mensagens)</option>
                    <option value="padrao">Padrão (resumo + últimas 10 mensagens)</option>
                    <option value="completo">Completo (histórico amplo)</option>
                  </select>
                </div>

                <div class="form-group">
                  <label
                    style={{
                      display: 'flex',
                      gap: '8px',
                      'align-items': 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={agentBrowserAccess()}
                      onChange={(e) => setAgentBrowserAccess(e.currentTarget.checked)}
                    />
                    Pode abrir o navegador para tarefas na web
                  </label>
                </div>

                <div class="form-group">
                  <span class="form-label-title">
                    Permissões deste agente (Padrão = as das Configurações)
                  </span>
                  <div
                    style={{
                      display: 'grid',
                      'grid-template-columns': '1fr 1fr',
                      gap: '8px',
                    }}
                  >
                    <label style={{ 'font-size': '12px' }}>
                      Scripts locais
                      <select
                        value={capLocalScripts()}
                        onChange={(e) => setCapLocalScripts(e.currentTarget.value)}
                        style={{ width: '100%' }}
                      >
                        <option value="">Padrão</option>
                        <option value="on">Ligado</option>
                        <option value="off">Desligado</option>
                      </select>
                    </label>
                    <label style={{ 'font-size': '12px' }}>
                      Inicia novos chats
                      <select
                        value={capStartsChats()}
                        onChange={(e) => setCapStartsChats(e.currentTarget.value)}
                        style={{ width: '100%' }}
                      >
                        <option value="">Padrão</option>
                        <option value="on">Ligado</option>
                        <option value="off">Desligado</option>
                      </select>
                    </label>
                    <label style={{ 'font-size': '12px' }}>
                      Plano antes de tarefas longas
                      <select
                        value={capShowPlan()}
                        onChange={(e) => setCapShowPlan(e.currentTarget.value)}
                        style={{ width: '100%' }}
                      >
                        <option value="">Padrão</option>
                        <option value="on">Ligado</option>
                        <option value="off">Desligado</option>
                      </select>
                    </label>
                    <label style={{ 'font-size': '12px' }}>
                      Uso do computador
                      <select
                        value={capComputer()}
                        onChange={(e) => setCapComputer(e.currentTarget.value)}
                        style={{ width: '100%' }}
                      >
                        <option value="">Padrão</option>
                        <option value="on">Ligado</option>
                        <option value="off">Desligado</option>
                      </select>
                    </label>
                    <label style={{ 'font-size': '12px' }}>
                      Orientar enquanto trabalha
                      <select
                        value={capSteer()}
                        onChange={(e) => setCapSteer(e.currentTarget.value)}
                        style={{ width: '100%' }}
                      >
                        <option value="">Padrão</option>
                        <option value="fila">Fila</option>
                        <option value="imediato">Imediato</option>
                      </select>
                    </label>
                  </div>
                </div>
              </details>

              <div class="modal-actions">
                <button type="button" class="btn-secondary" onClick={() => setShowModal(false)}>
                  Cancelar
                </button>
                <button
                  type="submit"
                  class="btn-primary"
                  disabled={loading() || instructions().length > MAX_AGENT_INSTRUCTIONS}
                >
                  {loading() ? 'Criando...' : 'Criar Agente'}
                </button>
              </div>
            </form>
          </div>
        </dialog>
      </Show>

      {/* Modal de Webhooks e Cadeia */}
      <Show when={showAutomationModal() && currentAgent()}>
        {(agent) => (
          <dialog
            ref={focusDialog}
            aria-modal="true"
            class="modal-overlay"
            open
            onClick={() => setShowAutomationModal(false)}
            onKeyDown={(e) => e.key === 'Escape' && setShowAutomationModal(false)}
          >
            <div
              class="modal-content"
              role="document"
              style={{ width: '640px', 'max-height': '85vh', 'overflow-y': 'auto' }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <div class="modal-header">
                <span class="modal-title">Webhooks e cadeia · {agent().name}</span>
                <button
                  type="button"
                  class="modal-close"
                  onClick={() => setShowAutomationModal(false)}
                >
                  ✕
                </button>
              </div>
              <div class="automation-body">
                <div class="form-group">
                  <label for="handoff-select">
                    Cadeia: ao terminar um pedido, passar o resultado para
                  </label>
                  <select
                    id="handoff-select"
                    value={agent().handoffAgentId ?? ''}
                    onChange={(e) => void handleSetHandoff(agent().id, e.currentTarget.value)}
                  >
                    <option value="">Ninguém (sem cadeia)</option>
                    <For each={coworkers().filter((a) => a.id !== agent().id)}>
                      {(a) => (
                        <option value={a.id}>
                          {a.avatar ?? '🤖'} {a.name}
                        </option>
                      )}
                    </For>
                  </select>
                  <span class="settings-section-desc">
                    Ex.: um agente acha os clientes, o próximo escreve para eles. A cadeia para
                    sozinha depois de algumas etapas.
                  </span>
                </div>

                <div class="form-group">
                  <span class="form-label-title">Webhooks</span>
                  <Show
                    when={webhookBase()}
                    fallback={
                      <span class="settings-section-desc">
                        ⚠️ O servidor de webhooks não abriu (a porta 47821 pode estar em uso).
                      </span>
                    }
                  >
                    <span class="settings-section-desc">
                      Um POST nesta URL faz o agente trabalhar, com o conteúdo recebido. A URL é a
                      senha: não compartilhe. Ela só responde neste computador; para receber da
                      internet, use um túnel (ex.: cloudflared).
                    </span>
                  </Show>
                  <For each={webhooks()}>
                    {(w) => (
                      <div class="webhook-row">
                        <div>
                          <strong>{w.title}</strong>
                          <code>{`${webhookBase() ?? ''}/${w.id}/${w.token}`}</code>
                        </div>
                        <button
                          type="button"
                          class="btn-secondary"
                          onClick={() =>
                            void navigator.clipboard.writeText(
                              `${webhookBase() ?? ''}/${w.id}/${w.token}`,
                            )
                          }
                        >
                          Copiar
                        </button>
                        <button
                          type="button"
                          class="btn-secondary"
                          onClick={() => void handleDeleteWebhook(w)}
                        >
                          Apagar
                        </button>
                      </div>
                    )}
                  </For>
                  <form class="webhook-form" onSubmit={handleCreateWebhook}>
                    <input
                      placeholder="Nome (ex.: Novo pedido na loja)"
                      value={webhookTitle()}
                      onInput={(e) => setWebhookTitle(e.currentTarget.value)}
                    />
                    <textarea
                      rows={3}
                      placeholder="O que o agente faz quando for chamado (ex.: confira o pedido e avise se faltar estoque)"
                      value={webhookInstruction()}
                      onInput={(e) => setWebhookInstruction(e.currentTarget.value)}
                    />
                    <button
                      type="submit"
                      class="btn-primary"
                      disabled={!webhookInstruction().trim()}
                    >
                      Criar webhook
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </dialog>
        )}
      </Show>

      {/* Modal de Agendamentos & Tarefas em Background (Cron) */}
      <Show when={showCronModal()}>
        <dialog
          ref={focusDialog}
          aria-modal="true"
          class="modal-overlay"
          open
          onClick={() => setShowCronModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowCronModal(false)}
        >
          <div
            class="modal-content cron-modal-container"
            role="document"
            style={{
              width: '840px',
              'max-height': '85vh',
              display: 'flex',
              'flex-direction': 'column',
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div class="modal-header">
              <div>
                <span class="modal-title">Agendamentos e rotinas em background</span>
                <div
                  style={{
                    'font-size': '11px',
                    color: 'var(--text-muted)',
                    'margin-top': '2px',
                  }}
                >
                  Agente ativo: <strong>{currentAgent()?.name}</strong> • Automação periódica de
                  tarefas e monitoramento de páginas
                </div>
              </div>
              <button type="button" class="modal-close" onClick={() => setShowCronModal(false)}>
                ✕
              </button>
            </div>

            <Show when={cronSuccessMsg()}>
              <div
                style={{
                  margin: '10px 20px 0',
                  padding: '8px 12px',
                  background: 'rgba(34, 197, 94, 0.15)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  'border-radius': 'var(--radius-sm)',
                  color: '#22c55e',
                  'font-size': '12px',
                }}
              >
                ✅ {cronSuccessMsg()}
              </div>
            </Show>

            <div
              style={{
                padding: '16px 20px',
                'overflow-y': 'auto',
                flex: 1,
                display: 'flex',
                'flex-direction': 'column',
                gap: '20px',
              }}
            >
              {/* Seção 1: Atalhos / Presets Rápidos */}
              <div>
                <div
                  style={{
                    'font-size': '12px',
                    'font-weight': '600',
                    color: 'var(--text-main)',
                    'margin-bottom': '8px',
                  }}
                >
                  💡 Sugestões Rápidas de Rotinas
                </div>
                <div class="cron-presets-strip">
                  <button
                    type="button"
                    class="cron-preset-btn"
                    onClick={() =>
                      applyCronPreset(
                        'Resumo Diário de Issues e Testes',
                        '0 9 * * *',
                        'routine',
                        'Todo dia às 09:00 verifique as issues abertas ou rode a suíte de testes e me dê um resumo detalhado.',
                      )
                    }
                  >
                    🌅 Todo dia às 09:00 (Issues & Testes)
                  </button>
                  <button
                    type="button"
                    class="cron-preset-btn"
                    onClick={() =>
                      applyCronPreset(
                        'Monitoramento de Status Web',
                        '*/30 * * * *',
                        'browser_monitor',
                        'Acesse a página informada no navegador, verifique o status dos serviços e reporte alertas ou incidentes.',
                        'https://status.github.com',
                      )
                    }
                  >
                    🌐 A cada 30 min (Monitoramento Web)
                  </button>
                  <button
                    type="button"
                    class="cron-preset-btn"
                    onClick={() =>
                      applyCronPreset(
                        'Verificação Horária de Sanidade',
                        '0 * * * *',
                        'routine',
                        'Execute uma verificação rápida de compilação e integridade no workspace e reporte o status.',
                      )
                    }
                  >
                    ⚡ A cada hora (Health check)
                  </button>
                </div>
              </div>

              {/* Seção 2: Lista de Agendamentos Ativos */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'space-between',
                    'margin-bottom': '10px',
                  }}
                >
                  <span
                    style={{
                      'font-size': '12px',
                      'font-weight': '600',
                      color: 'var(--text-main)',
                    }}
                  >
                    Rotinas Cadastradas ({scheduledTasks().length})
                  </span>
                  <button
                    type="button"
                    class="btn-outline"
                    style={{ padding: '3px 8px', 'font-size': '11px' }}
                    onClick={() => loadScheduledTasks()}
                  >
                    🔄 Atualizar Lista
                  </button>
                </div>

                <Show
                  when={scheduledTasks().length > 0}
                  fallback={
                    <div
                      style={{
                        padding: '24px',
                        'text-align': 'center',
                        background: 'var(--bg-card)',
                        border: '1px dashed var(--border)',
                        'border-radius': 'var(--radius-sm)',
                        color: 'var(--text-muted)',
                        'font-size': '12px',
                      }}
                    >
                      Nenhuma rotina agendada para este agente. Cadastre uma nova rotina abaixo para
                      automação em background.
                    </div>
                  }
                >
                  <div
                    style={{
                      display: 'flex',
                      'flex-direction': 'column',
                      gap: '10px',
                    }}
                  >
                    <For each={scheduledTasks()}>
                      {(task) => (
                        <div class={`cron-task-card ${task.enabled ? 'active' : 'disabled'}`}>
                          <div class="cron-task-header">
                            <div
                              style={{
                                display: 'flex',
                                'align-items': 'center',
                                gap: '8px',
                              }}
                            >
                              <span class={`cron-type-badge ${task.taskType}`}>
                                {task.taskType === 'browser_monitor'
                                  ? '🌐 Monitoramento Web'
                                  : '📋 Rotina'}
                              </span>
                              <strong
                                style={{
                                  'font-size': '13px',
                                  color: 'var(--text-main)',
                                }}
                              >
                                {task.title}
                              </strong>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                'align-items': 'center',
                                gap: '8px',
                              }}
                            >
                              <button
                                type="button"
                                class={`cron-toggle-btn ${task.enabled ? 'enabled' : 'disabled'}`}
                                onClick={() => handleToggleScheduledTask(task)}
                                title={
                                  task.enabled ? 'Clique para desativar' : 'Clique para ativar'
                                }
                              >
                                {task.enabled ? '✅ Ativo' : '⏸️ Pausado'}
                              </button>
                              <button
                                type="button"
                                class="btn-outline"
                                style={{
                                  padding: '3px 8px',
                                  'font-size': '11px',
                                }}
                                disabled={cronRunningId() === task.id}
                                onClick={() => handleRunScheduledTaskNow(task)}
                                title="Executar imediatamente sem esperar o cronômetro"
                              >
                                {cronRunningId() === task.id ? 'Executando...' : '▶️ Rodar Agora'}
                              </button>
                              <button
                                type="button"
                                class="btn-danger"
                                style={{
                                  padding: '3px 6px',
                                  'font-size': '11px',
                                }}
                                onClick={() => handleDeleteScheduledTask(task)}
                                title="Excluir agendamento"
                              >
                                ✕
                              </button>
                            </div>
                          </div>

                          <div class="cron-task-body">
                            <div
                              style={{
                                'font-size': '12px',
                                color: 'var(--text-main)',
                                'margin-bottom': '6px',
                                'white-space': 'pre-wrap',
                              }}
                            >
                              {task.prompt}
                            </div>
                            <Show when={task.targetUrl}>
                              <div
                                style={{
                                  'font-size': '11px',
                                  color: 'var(--accent)',
                                  'margin-bottom': '6px',
                                }}
                              >
                                🔗 <strong>URL Alvo:</strong> <code>{task.targetUrl}</code>
                              </div>
                            </Show>
                            <div class="cron-task-meta">
                              <span>
                                ⏰ Expressão: <code>{task.cronExpression}</code> (
                                {describeCron(task.cronExpression)})
                              </span>
                              <span>
                                ⏳ Próximo disparo:{' '}
                                <strong>
                                  {task.nextRunAt
                                    ? new Date(task.nextRunAt).toLocaleString()
                                    : 'Não agendado'}
                                </strong>
                              </span>
                              <span>
                                🏁 Última execução:{' '}
                                {task.lastRunAt
                                  ? new Date(task.lastRunAt).toLocaleString()
                                  : 'Ainda não executado'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              {/* Seção 3: Cadastrar Novo Agendamento */}
              <div class="cron-create-section">
                <div
                  style={{
                    'font-size': '12px',
                    'font-weight': '600',
                    color: 'var(--text-main)',
                    'margin-bottom': '12px',
                  }}
                >
                  ➕ Novo Agendamento para {currentAgent()?.name}
                </div>

                <form class="modal-form" onSubmit={handleCreateScheduledTask}>
                  <div class="form-group">
                    <label for="cron-title">Título da Rotina</label>
                    <input
                      id="cron-title"
                      type="text"
                      placeholder="Ex: Resumo Diário de Issues e Testes"
                      value={cronFormTitle()}
                      onInput={(e) => setCronFormTitle(e.currentTarget.value)}
                      required
                    />
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      'grid-template-columns': '1fr 1fr',
                      gap: '12px',
                    }}
                  >
                    <div class="form-group">
                      <label for="cron-type">Tipo de Tarefa</label>
                      <select
                        id="cron-type"
                        value={cronFormType()}
                        onChange={(e) =>
                          setCronFormType(e.currentTarget.value as ScheduledTaskType)
                        }
                        style={{
                          'background-color': 'var(--bg-card)',
                          border: '1px solid var(--border)',
                          'border-radius': 'var(--radius-sm)',
                          padding: '8px 12px',
                          color: 'var(--text-main)',
                          'font-size': '13px',
                          outline: 'none',
                          width: '100%',
                        }}
                      >
                        <option value="routine">📋 Rotina de IA (Código, Testes, Issues)</option>
                        <option value="browser_monitor">
                          🌐 Monitoramento Periódico de Página Web
                        </option>
                      </select>
                    </div>

                    <div class="form-group">
                      <label for="cron-preset-select">Frequência (Cron)</label>
                      <select
                        id="cron-preset-select"
                        value={cronFormExpr()}
                        onChange={(e) => setCronFormExpr(e.currentTarget.value)}
                        style={{
                          'background-color': 'var(--bg-card)',
                          border: '1px solid var(--border)',
                          'border-radius': 'var(--radius-sm)',
                          padding: '8px 12px',
                          color: 'var(--text-main)',
                          'font-size': '13px',
                          outline: 'none',
                          width: '100%',
                        }}
                      >
                        <option value="0 9 * * *">🌅 Todo dia às 09:00 (0 9 * * *)</option>
                        <option value="0 0 * * *">🌙 Todo dia à meia-noite (0 0 * * *)</option>
                        <option value="0 * * * *">🕐 A cada hora no minuto 0 (0 * * * *)</option>
                        <option value="*/30 * * * *">⏱️ A cada 30 minutos (*/30 * * * *)</option>
                        <option value="*/15 * * * *">⚡ A cada 15 minutos (*/15 * * * *)</option>
                        <option value="*/5 * * * *">🚀 A cada 5 minutos (*/5 * * * *)</option>
                        <option value="0 0 * * 0">📅 Todo domingo (0 0 * * 0)</option>
                      </select>
                    </div>
                  </div>

                  <div class="form-group">
                    <label for="cron-expr-input">Expressão Cron Customizada</label>
                    <div
                      style={{
                        display: 'flex',
                        'align-items': 'center',
                        gap: '8px',
                      }}
                    >
                      <input
                        id="cron-expr-input"
                        type="text"
                        placeholder="minuto hora dia mês dia-da-semana (ex: 0 9 * * *)"
                        value={cronFormExpr()}
                        onInput={(e) => setCronFormExpr(e.currentTarget.value)}
                        required
                        style={{ flex: 1 }}
                      />
                      <span style={{ 'font-size': '11px', color: 'var(--accent)' }}>
                        {describeCron(cronFormExpr())}
                      </span>
                    </div>
                  </div>

                  <Show when={cronFormType() === 'browser_monitor'}>
                    <div class="form-group">
                      <label for="cron-target-url">URL da Página Web a Monitorar</label>
                      <input
                        id="cron-target-url"
                        type="url"
                        placeholder="https://github.com/org/repo/issues ou https://status.github.com"
                        value={cronFormTargetUrl()}
                        onInput={(e) => setCronFormTargetUrl(e.currentTarget.value)}
                        required
                      />
                    </div>
                  </Show>

                  <div class="form-group">
                    <label for="cron-prompt">Instrução / Prompt da Rotina</label>
                    <textarea
                      id="cron-prompt"
                      placeholder="Ex: Verifique as issues abertas ou rode a suíte de testes e me dê um resumo."
                      value={cronFormPrompt()}
                      onInput={(e) => setCronFormPrompt(e.currentTarget.value)}
                      required
                      style={{ height: '70px' }}
                    />
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      'justify-content': 'flex-end',
                      'margin-top': '8px',
                    }}
                  >
                    <button
                      type="submit"
                      class="btn-primary"
                      style={{ padding: '8px 16px', 'font-size': '12.5px' }}
                    >
                      ➕ Salvar Agendamento
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <div class="modal-actions" style={{ padding: '12px 20px' }}>
              <button type="button" class="btn-secondary" onClick={() => setShowCronModal(false)}>
                Fechar
              </button>
            </div>
          </div>
        </dialog>
      </Show>

      {/* Modal de Diretrizes do Projeto (ORCHBOT.md / AGENTS.md) */}
      <Show when={showAiEdit() && currentAgent()}>
        <dialog
          ref={focusDialog}
          aria-modal="true"
          class="modal-overlay"
          open
          onClick={() => setShowAiEdit(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowAiEdit(false)}
        >
          <div
            class="modal-content"
            role="document"
            style={{ width: '640px', 'max-height': '85vh' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div class="modal-header">
              <span class="modal-title">Editar {currentAgent()?.name} com IA</span>
              <button type="button" class="modal-close" onClick={() => setShowAiEdit(false)}>
                ✕
              </button>
            </div>
            <div class="modal-form" style={{ 'overflow-y': 'auto' }}>
              <Show when={aiEditError()}>
                <div style={{ color: 'var(--danger)', 'font-size': '12px' }}>{aiEditError()}</div>
              </Show>
              <div class="form-group">
                <label for="ai-edit-prompt">O que mudar?</label>
                <textarea
                  id="ai-edit-prompt"
                  rows={3}
                  placeholder="Ex: deixe mais direto, responda sempre em tópicos e foque em performance"
                  value={aiEditPrompt()}
                  onInput={(e) => setAiEditPrompt(e.currentTarget.value)}
                />
                <button
                  type="button"
                  class="btn-outline"
                  disabled={drafting() || !aiEditPrompt().trim()}
                  onClick={() => currentAgent() && draftForEdit(currentAgent()?.id as string)}
                >
                  {drafting() ? 'Gerando…' : 'Gerar rascunho'}
                </button>
              </div>
              <Show when={editDraft()}>
                {(draft) => (
                  <>
                    <div
                      style={{
                        'font-size': '11px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {draft().source === 'model'
                        ? 'Revise e edite o rascunho. Nada foi salvo ainda.'
                        : 'Nenhum provedor respondeu: rascunho offline simples. Nada foi salvo ainda.'}
                    </div>
                    <div class="form-group">
                      <label for="ai-edit-avatar">Avatar</label>
                      <input
                        id="ai-edit-avatar"
                        type="text"
                        maxLength={8}
                        style={{ width: '90px' }}
                        value={draft().avatar}
                        onInput={(e) =>
                          setEditDraft({
                            ...draft(),
                            avatar: e.currentTarget.value,
                          })
                        }
                      />
                    </div>
                    <div class="form-group">
                      <label for="ai-edit-name">Nome</label>
                      <input
                        id="ai-edit-name"
                        type="text"
                        value={draft().name}
                        onInput={(e) =>
                          setEditDraft({
                            ...draft(),
                            name: e.currentTarget.value,
                          })
                        }
                      />
                    </div>
                    <div class="form-group">
                      <label for="ai-edit-desc">Descrição</label>
                      <input
                        id="ai-edit-desc"
                        type="text"
                        value={draft().description}
                        onInput={(e) =>
                          setEditDraft({
                            ...draft(),
                            description: e.currentTarget.value,
                          })
                        }
                      />
                    </div>
                    <div class="form-group">
                      <label for="ai-edit-role">Tipo</label>
                      <select
                        id="ai-edit-role"
                        value={draft().role}
                        onChange={(e) =>
                          setEditDraft({
                            ...draft(),
                            role: e.currentTarget.value as AgentRole,
                          })
                        }
                      >
                        <option value="worker">🛠️ Especialista</option>
                        <option value="orchestrator">👑 Orquestrador</option>
                      </select>
                    </div>
                    <div class="form-group">
                      <label for="ai-edit-instr">Instruções</label>
                      <textarea
                        id="ai-edit-instr"
                        rows={9}
                        aria-describedby="ai-edit-instr-count"
                        value={draft().instructions}
                        onInput={(e) =>
                          setEditDraft({
                            ...draft(),
                            instructions: e.currentTarget.value,
                          })
                        }
                      />
                      <OverLimitCounter id="ai-edit-instr-count" text={draft().instructions} />
                    </div>
                    <button
                      type="button"
                      class="btn-primary"
                      disabled={
                        !draft().name.trim() ||
                        !draft().instructions.trim() ||
                        draft().instructions.length > MAX_AGENT_INSTRUCTIONS
                      }
                      onClick={() => currentAgent() && saveEditDraft(currentAgent()?.id as string)}
                    >
                      Salvar alterações
                    </button>
                  </>
                )}
              </Show>
            </div>
          </div>
        </dialog>
      </Show>

      <Show when={showMemoryModal() && currentAgent()}>
        <dialog
          ref={focusDialog}
          aria-modal="true"
          class="modal-overlay"
          open
          onClick={() => setShowMemoryModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowMemoryModal(false)}
        >
          <div
            class="modal-content"
            role="document"
            style={{ width: '620px', 'max-height': '80vh' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div class="modal-header">
              <span class="modal-title">Memórias de {currentAgent()?.name}</span>
              <button type="button" class="modal-close" onClick={() => setShowMemoryModal(false)}>
                ✕
              </button>
            </div>
            <div style={{ padding: '16px 20px', 'overflow-y': 'auto', flex: 1 }}>
              <div
                style={{
                  'font-size': '12px',
                  color: 'var(--text-muted)',
                  'margin-bottom': '12px',
                }}
              >
                Guardadas só neste computador. O robô também cria e apaga memórias sozinho durante
                as conversas.
              </div>
              <div style={{ display: 'flex', gap: '8px', 'margin-bottom': '12px' }}>
                <input
                  type="text"
                  style={{ flex: 1 }}
                  placeholder="Adicionar memória…"
                  value={newMemory()}
                  onInput={(e) => setNewMemory(e.currentTarget.value)}
                />
                <button
                  type="button"
                  class="btn-primary"
                  disabled={!newMemory().trim()}
                  onClick={async () => {
                    const id = currentAgent()?.id
                    if (!id) return
                    await window.orchbot.addMemory(id, newMemory())
                    setNewMemory('')
                    await refreshMemories(id)
                  }}
                >
                  Salvar
                </button>
              </div>
              <Show
                when={memories().length > 0}
                fallback={<p style={{ color: 'var(--text-muted)' }}>Nenhuma memória ainda.</p>}
              >
                <For each={memories()}>
                  {(m) => (
                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        'align-items': 'flex-start',
                        padding: '8px 0',
                        'border-bottom': '1px solid rgba(128,128,128,.2)',
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          'font-size': '13px',
                          'white-space': 'pre-wrap',
                        }}
                      >
                        {m.kind === 'task' ? 'tarefa' : 'preferência'} · {m.text}
                      </span>
                      <button
                        type="button"
                        class="btn-outline"
                        title="Esquecer memória"
                        aria-label="Esquecer memória"
                        onClick={async () => {
                          await window.orchbot.deleteMemory(m.agentId, m.id)
                          await refreshMemories(m.agentId)
                        }}
                      >
                        <RailIcon name="trash" />
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </dialog>
      </Show>

      <Show when={showRulesModal()}>
        <dialog
          ref={focusDialog}
          aria-modal="true"
          class="modal-overlay"
          open
          onClick={() => setShowRulesModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowRulesModal(false)}
        >
          <div
            class="modal-content"
            role="document"
            style={{ width: '680px', 'max-height': '80vh' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div class="modal-header">
              <div>
                <span class="modal-title">
                  Diretrizes do Projeto ({workspaceRules()?.filename})
                </span>
                <div
                  style={{
                    'font-size': '11px',
                    color: 'var(--text-muted)',
                    'margin-top': '2px',
                  }}
                >
                  Arquivo detectado: <code>{workspaceRules()?.filePath}</code>
                </div>
              </div>
              <button type="button" class="modal-close" onClick={() => setShowRulesModal(false)}>
                ✕
              </button>
            </div>

            <div
              style={{
                padding: '16px 20px',
                'overflow-y': 'auto',
                flex: 1,
              }}
            >
              <div
                style={{
                  'font-size': '12px',
                  color: 'var(--text-muted)',
                  'margin-bottom': '12px',
                  'line-height': '1.5',
                }}
              >
                Estas diretrizes de arquitetura e padrões são injetadas automaticamente em cada
                turno de execução do agente, garantindo que o bot respeite suas preferências sem
                necessidade de repetir prompts.
              </div>
              <pre class="rules-pre-content">{workspaceRules()?.content}</pre>
            </div>

            <div class="modal-actions" style={{ padding: '12px 20px' }}>
              <button type="button" class="btn-primary" onClick={() => setShowRulesModal(false)}>
                Entendido
              </button>
            </div>
          </div>
        </dialog>
      </Show>

      {/* Modal de Busca Rápida Full-Text & RAG (SQLite FTS5) */}
      <Show when={showSearchModal()}>
        <dialog
          ref={focusDialog}
          aria-modal="true"
          class="modal-overlay"
          open
          onClick={() => setShowSearchModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowSearchModal(false)}
        >
          <div
            class="modal-content"
            role="document"
            style={{ width: '740px', 'max-height': '85vh' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div class="modal-header">
              <div>
                <span class="modal-title">Busca de Memória & RAG</span>
                <div
                  style={{
                    'font-size': '11px',
                    color: 'var(--text-muted)',
                    'margin-top': '2px',
                  }}
                >
                  Pesquise no histórico de conversas e nos arquivos do projeto.
                </div>
              </div>
              <button type="button" class="modal-close" onClick={() => setShowSearchModal(false)}>
                ✕
              </button>
            </div>

            <div style={{ padding: '16px 20px 8px 20px' }}>
              <form class="search-form-row" onSubmit={handleSearchMemory}>
                <input
                  type="text"
                  class="search-input"
                  placeholder="Ex: sqlite, arquitetura, refatoração, css, fts5, electron..."
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                />
                <button
                  type="submit"
                  class="btn-primary"
                  disabled={isSearching() || !searchQuery().trim()}
                >
                  {isSearching() ? 'Buscando...' : 'Buscar'}
                </button>
                <button
                  type="button"
                  class="btn-outline"
                  onClick={() => handleIndexWorkspace()}
                  disabled={isIndexing()}
                  title="Reindexar arquivos de código do workspace no SQLite FTS5"
                >
                  {isIndexing() ? 'Indexando...' : '🔄 Reindexar'}
                </button>
              </form>

              <Show when={indexingMsg()}>
                <div class="search-status-feedback">ℹ️ {indexingMsg()}</div>
              </Show>

              {/* Abas de Resultados */}
              <div class="search-tabs-row">
                <button
                  type="button"
                  class={`search-tab-btn ${searchTab() === 'messages' ? 'active' : ''}`}
                  onClick={() => setSearchTab('messages')}
                >
                  Conversas anteriores ({searchResults()?.messages.length ?? 0})
                </button>
                <button
                  type="button"
                  class={`search-tab-btn ${searchTab() === 'files' ? 'active' : ''}`}
                  onClick={() => setSearchTab('files')}
                >
                  Arquivos do repositório ({searchResults()?.files.length ?? 0})
                </button>
              </div>
            </div>

            {/* Lista de Resultados */}
            <div class="search-results-container">
              <Show when={searchTab() === 'messages'}>
                <For
                  each={searchResults()?.messages}
                  fallback={
                    <div class="search-empty-state">
                      {searchQuery().trim()
                        ? 'Nenhuma mensagem ou conversa encontrada para este termo.'
                        : 'Digite um termo acima para pesquisar em todo o histórico de conversas.'}
                    </div>
                  }
                >
                  {(res) => (
                    <div class="search-result-item">
                      <div class="search-result-header">
                        <div class="search-result-meta">
                          <span class="search-result-thread">{res.threadTitle}</span>
                          <span class="search-result-role">
                            {res.role === 'user' ? 'Usuário' : 'Agente'}
                          </span>
                        </div>
                        <button
                          type="button"
                          class="queue-btn-action"
                          onClick={() => handleSelectSearchResultThread(res.threadId)}
                        >
                          Ir para Conversa ↗
                        </button>
                      </div>
                      <div class="search-result-snippet" innerHTML={safeSnippetHtml(res.snippet)} />
                    </div>
                  )}
                </For>
              </Show>

              <Show when={searchTab() === 'files'}>
                <For
                  each={searchResults()?.files}
                  fallback={
                    <div class="search-empty-state">
                      {searchQuery().trim()
                        ? 'Nenhum arquivo do repositório encontrado com este termo.'
                        : 'Digite um termo acima para pesquisar no conteúdo dos arquivos indexados.'}
                    </div>
                  }
                >
                  {(file) => (
                    <div class="search-result-item">
                      <div class="search-result-header">
                        <div class="search-result-meta">
                          <span class="search-result-thread">{file.fileName}</span>
                          <span class="search-result-role" style={{ 'font-size': '10px' }}>
                            {file.filePath}
                          </span>
                        </div>
                      </div>
                      <div
                        class="search-result-snippet code"
                        innerHTML={safeSnippetHtml(file.snippet)}
                      />
                    </div>
                  )}
                </For>
              </Show>
            </div>

            <div class="modal-actions" style={{ padding: '12px 20px' }}>
              <button type="button" class="btn-secondary" onClick={() => setShowSearchModal(false)}>
                Fechar
              </button>
            </div>
          </div>
        </dialog>
      </Show>

      {/* Paleta de Comandos Rápida (Ctrl+K / Ctrl+P) */}
      <Show when={showCommandPalette()}>
        <dialog
          ref={focusDialog}
          aria-modal="true"
          class="modal-overlay command-palette-overlay"
          open
          onClick={() => setShowCommandPalette(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setShowCommandPalette(false)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              const max = Math.max(0, paletteItems().length - 1)
              setPaletteIndex((i) => Math.min(max, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setPaletteIndex((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const item = paletteItems()[paletteIndex()]
              if (item) executePaletteItem(item)
            }
          }}
        >
          <div
            class="command-palette-box"
            role="document"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div class="command-palette-search">
              <span class="command-palette-search-icon">⌘</span>
              <input
                type="text"
                class="command-palette-input"
                placeholder="Ir para agente, alternar modo (Quadro/Chat), contratar template ou delegar..."
                value={paletteQuery()}
                autofocus
                onInput={(e) => {
                  setPaletteQuery(e.currentTarget.value)
                  setPaletteIndex(0)
                }}
              />
              <kbd class="command-palette-esc">ESC</kbd>
            </div>

            <div class="command-palette-list">
              <For
                each={paletteItems()}
                fallback={
                  <div class="command-palette-empty">
                    Nenhum comando ou agente encontrado para &ldquo;
                    {paletteQuery()}&rdquo;.
                  </div>
                }
              >
                {(item, idx) => (
                  <button
                    type="button"
                    class={`command-palette-item ${idx() === paletteIndex() ? 'selected' : ''}`}
                    onMouseEnter={() => setPaletteIndex(idx())}
                    onClick={() => executePaletteItem(item)}
                  >
                    <span class="command-palette-item-icon">{item.icon}</span>
                    <div class="command-palette-item-main">
                      <span class="command-palette-item-label">{item.label}</span>
                      <span class="command-palette-item-sub">{item.sublabel}</span>
                    </div>
                    <Show when={item.shortcut}>
                      <kbd class="command-palette-item-kbd">{item.shortcut}</kbd>
                    </Show>
                  </button>
                )}
              </For>
            </div>

            <div class="command-palette-footer">
              <span>
                <kbd>↑↓</kbd> navegar
              </span>
              <span>
                <kbd>↵</kbd> executar
              </span>
              <span>
                <kbd>Ctrl+1</kbd> Quadro
              </span>
              <span>
                <kbd>Ctrl+2</kbd> Chat
              </span>
              <span>
                <kbd>Ctrl+N</kbd> Novo Agente
              </span>
            </div>
          </div>
        </dialog>
      </Show>
    </div>
  )
}
