import { type Component, For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type {
  Agent,
  BrowserPageContent,
  BrowserTab,
  Message,
  ProviderConnection,
  ProviderInfo,
  SearchResultGroup,
  SelectedFile,
  SupportedProvider,
  SystemStatus,
  TaskQueueItem,
  Thread,
  WorkspaceRulesInfo,
} from '../../shared/types'

export const App: Component = () => {
  // Seção ativa principal da aplicação: inicia por padrão na tela de conexões/provedores
  const [activeSection, setActiveSection] = createSignal<'agents' | 'connections'>('connections')

  // Conexões e Provedores signals
  const [connections, setConnections] = createSignal<ProviderConnection[]>([])
  const [connectionDrafts, setConnectionDrafts] = createSignal<
    Record<
      string,
      {
        apiKey?: string
        endpoint?: string
        defaultModel?: string
      }
    >
  >({})
  const [showApiKeys, setShowApiKeys] = createSignal<Record<string, boolean>>({})
  const [testingConnection, setTestingConnection] = createSignal<string | null>(null)
  const [testResults, setTestResults] = createSignal<
    Record<string, { success: boolean; message: string }>
  >({})
  const [savingConnection, setSavingConnection] = createSignal<string | null>(null)
  const [saveMessage, setSaveMessage] = createSignal<Record<string, string>>({})

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

  // Chat signals
  const [inputText, setInputText] = createSignal('')
  const [isStreaming, setIsStreaming] = createSignal(false)
  const [streamingText, setStreamingText] = createSignal('')
  const [chatError, setChatError] = createSignal<string | null>(null)

  // Modal signals
  const [showModal, setShowModal] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)

  // Regras do Projeto (ORCHBOT.md / AGENTS.md) e RAG FTS5 signals
  const [workspaceRules, setWorkspaceRules] = createSignal<WorkspaceRulesInfo | null>(null)
  const [showRulesModal, setShowRulesModal] = createSignal(false)
  const [showSearchModal, setShowSearchModal] = createSignal(false)
  const [searchQuery, setSearchQuery] = createSignal('')
  const [searchResults, setSearchResults] = createSignal<SearchResultGroup | null>(null)
  const [isSearching, setIsSearching] = createSignal(false)
  const [isIndexing, setIsIndexing] = createSignal(false)
  const [indexingMsg, setIndexingMsg] = createSignal<string | null>(null)
  const [searchTab, setSearchTab] = createSignal<'messages' | 'files'>('messages')

  // Form signals
  const [name, setName] = createSignal('')
  const [provider, setProvider] = createSignal<SupportedProvider>('codex')
  const [model, setModel] = createSignal('gpt-4o')
  const [workspacePath, setWorkspacePath] = createSignal('/home/joao/Documents/Orchbot')
  const [instructions, setInstructions] = createSignal('')

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
        if (list.length > 0 && !selectedAgentId()) {
          setSelectedAgentId(list[0].id)
        }
      }
    } catch (err) {
      console.error('Erro ao carregar agentes:', err)
    }
  }

  const loadProviderStatuses = async () => {
    try {
      if (window.orchbot) {
        const statuses = await window.orchbot.getProviderStatus()
        setProviderStatuses(statuses)
      }
    } catch (err) {
      console.error('Erro ao verificar provedores:', err)
    }
  }

  const loadConnections = async () => {
    try {
      if (window.orchbot) {
        const list = await window.orchbot.getConnections()
        setConnections(list)
        const drafts: Record<
          string,
          { apiKey?: string; endpoint?: string; defaultModel?: string }
        > = {}
        for (const c of list) {
          drafts[c.providerId] = {
            apiKey: c.apiKey || '',
            endpoint: c.endpoint || '',
            defaultModel: c.defaultModel,
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
    try {
      await window.orchbot.browserFill(agent.id, tabId, selector.trim(), value)
      setBrowserStatusMsg(`Campo "${selector}" preenchido com sucesso!`)
      setTimeout(() => setBrowserStatusMsg(null), 3000)
    } catch (err: unknown) {
      alert(`Erro ao preencher: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  onMount(() => {
    loadAgents()
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

    const unsubFinished = window.orchbot.onTurnFinished((data) => {
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
      if (agentId && updatedTab.agentId === agentId) {
        setBrowserTabs((prev) => {
          const index = prev.findIndex((t) => t.id === updatedTab.id)
          if (index >= 0) {
            const next = [...prev]
            next[index] = updatedTab
            return next
          }
          return [...prev, updatedTab]
        })
        if (activeTabId() === updatedTab.id) {
          setBrowserUrlInput(updatedTab.url)
        }
      }
    })

    onCleanup(() => {
      unsubChunk()
      unsubFinished()
      unsubError()
      unsubTask()
      unsubBrowserTab()
    })
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
      setSearchResults(null)
      setSearchQuery('')
      loadThreadAndMessages(id)
      loadQueue(id)
      loadBrowserTabs(id)
      loadWorkspaceRulesData(id)
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
    return agents().filter((a) => a.id !== id)
  }

  const pendingTasksCount = () => {
    return tasks().filter((t) => t.status === 'pending' || t.status === 'running').length
  }

  const handleProviderChange = (p: SupportedProvider) => {
    setProvider(p)
    const conn = connections().find((c) => c.providerId === p)
    if (conn) {
      setModel(conn.defaultModel)
    } else {
      if (p === 'codex') setModel('gpt-4o')
      else if (p === 'claude') setModel('claude-3-7-sonnet')
      else if (p === 'grok') setModel('grok-2')
      else if (p === 'muse') setModel('gemini-2.0-flash')
    }
  }

  const handleToggleConnection = async (conn: ProviderConnection, enabled: boolean) => {
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
    }
  }

  const handleSaveConnection = async (conn: ProviderConnection) => {
    const draft = connectionDrafts()[conn.providerId] || {}
    setSavingConnection(conn.providerId)
    try {
      if (window.orchbot) {
        await window.orchbot.updateConnection({
          providerId: conn.providerId,
          enabled: conn.enabled,
          apiKey: draft.apiKey !== undefined ? draft.apiKey : conn.apiKey,
          endpoint: draft.endpoint !== undefined ? draft.endpoint : conn.endpoint,
          defaultModel: draft.defaultModel !== undefined ? draft.defaultModel : conn.defaultModel,
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
      }
    } catch (err: unknown) {
      alert(`Erro ao salvar configurações: ${err instanceof Error ? err.message : String(err)}`)
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
        await loadProviderStatuses()
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

  const updateDraftField = (
    providerId: string,
    field: 'apiKey' | 'endpoint' | 'defaultModel',
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
      const newModel =
        conn?.defaultModel ||
        (newProvider === 'codex'
          ? 'gpt-4o'
          : newProvider === 'claude'
            ? 'claude-3-7-sonnet'
            : newProvider === 'grok'
              ? 'grok-2'
              : 'gemini-2.0-flash')

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

  const handleSwitchModelMidChat = async (agentId: string, newModel: string) => {
    try {
      if (window.orchbot) {
        const updated = await window.orchbot.updateAgent({
          id: agentId,
          model: newModel,
        })
        setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)))
      }
    } catch (err: unknown) {
      alert(`Erro ao trocar modelo: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

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
        provider: provider(),
        model: model(),
        workspacePath: workspacePath(),
        instructions: instructions(),
      })

      await loadAgents()
      setSelectedAgentId(newAgent.id)
      setShowModal(false)

      // Limpar formulário
      setName('')
      setInstructions('')
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
    if (!text || !thread) return

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

  const handleOpenDelegationModal = () => {
    const others = otherAgents()
    if (others.length === 0) {
      alert('Você precisa ter pelo menos mais um agente cadastrado para delegar tarefas.')
      return
    }
    setDelegationTargetId(others[0].id)
    setDelegationPrompt('')
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

      setShowDelegationModal(false)
      alert('Tarefa delegada com sucesso para o agente selecionado!')
    } catch (err: unknown) {
      setDelegationError(err instanceof Error ? err.message : String(err))
    } finally {
      setDelegationLoading(false)
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
        ? 'Refatorar Banco de Dados'
        : `Tópico ${agentThreads().length + 1}`)

    const titlePrompt = window.prompt(
      'Título do novo tópico/sessão de conversa (ex: Refatorar Banco de Dados, Debug de Performance):',
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
    const newTitle = window.prompt('Novo título para a conversa:', thread.title)
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
    setIndexingMsg('Indexando repositório com SQLite FTS5...')
    try {
      const res = await window.orchbot.indexWorkspace(id)
      setIndexingMsg(`${res.indexedCount} arquivos indexados com sucesso!`)
      setTimeout(() => setIndexingMsg(null), 3000)
    } catch {
      setIndexingMsg('Erro ao indexar workspace')
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
      console.error('Erro na busca FTS5:', err)
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage(e)
    }
  }

  return (
    <div class="app-container">
      {/* Sidebar */}
      <aside class="sidebar">
        <div class="sidebar-header">
          <div class="logo-group">
            <span class="logo-badge">LOCAL-FIRST</span>
            <span class="logo-title">Orchbot</span>
          </div>
          <button
            type="button"
            class="btn-primary"
            onClick={() => {
              const enabled = connections().filter((c) => c.enabled)
              if (enabled.length > 0) {
                setProvider(enabled[0].providerId)
                setModel(enabled[0].defaultModel)
              } else {
                setProvider('codex')
                setModel('gpt-4o')
              }
              setShowModal(true)
            }}
          >
            + Novo
          </button>
        </div>

        {/* Abas de Navegação na Sidebar */}
        <div class="sidebar-nav">
          <button
            type="button"
            class={`sidebar-nav-btn ${activeSection() === 'agents' ? 'active' : ''}`}
            onClick={() => setActiveSection('agents')}
          >
            <span>🤖 Agentes</span>
            <span class="nav-badge">{agents().length}</span>
          </button>
          <button
            type="button"
            class={`sidebar-nav-btn ${activeSection() === 'connections' ? 'active' : ''}`}
            onClick={() => {
              setActiveSection('connections')
              loadConnections()
            }}
          >
            <span>🔌 Conexões</span>
            <span class="nav-badge">
              {connections().filter((c) => c.enabled).length}/{connections().length}
            </span>
          </button>
        </div>

        <div class="agent-list">
          <For
            each={agents()}
            fallback={
              <div
                style={{
                  padding: '24px 12px',
                  'text-align': 'center',
                  color: 'var(--text-muted)',
                  'font-size': '13px',
                }}
              >
                Nenhum agente cadastrado ainda.
              </div>
            }
          >
            {(agent) => (
              <button
                type="button"
                class={`agent-item ${selectedAgentId() === agent.id && activeSection() === 'agents' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedAgentId(agent.id)
                  setActiveSection('agents')
                }}
              >
                <div class="agent-item-top">
                  <span class="agent-item-name">{agent.name}</span>
                  <span class={`provider-tag ${agent.provider}`}>{agent.provider}</span>
                </div>
                <div class="agent-item-workspace">{agent.workspacePath}</div>
              </button>
            )}
          </For>
        </div>

        <div class="sidebar-footer">
          <div
            style={{
              display: 'flex',
              'justify-content': 'space-between',
              'align-items': 'center',
              'margin-bottom': '2px',
            }}
          >
            <span style={{ 'font-weight': '600' }}>Provedores de IA:</span>
            <button
              type="button"
              class="btn-outline"
              style={{ padding: '2px 6px', 'font-size': '10px' }}
              onClick={() => {
                setActiveSection('connections')
                loadConnections()
              }}
              title="Abrir tela de conexões"
            >
              ⚙️ Conexões
            </button>
          </div>
          <div class="provider-status-list">
            <div class="provider-status-item">
              <span class={`status-dot ${providerStatuses()?.codex.available ? 'online' : ''}`} />
              <span>Codex: {providerStatuses()?.codex.available ? 'Pronto' : 'Ausente'}</span>
            </div>
            <div class="provider-status-item">
              <span class={`status-dot ${providerStatuses()?.claude.available ? 'online' : ''}`} />
              <span>Claude: {providerStatuses()?.claude.available ? 'Pronto' : 'Ausente'}</span>
            </div>
            <div class="provider-status-item">
              <span class={`status-dot ${providerStatuses()?.grok.available ? 'online' : ''}`} />
              <span>Grok: {providerStatuses()?.grok.available ? 'Pronto' : 'Ausente'}</span>
            </div>
            <div class="provider-status-item">
              <span class={`status-dot ${providerStatuses()?.muse.available ? 'online' : ''}`} />
              <span>Muse: {providerStatuses()?.muse.available ? 'Pronto' : 'Ausente'}</span>
            </div>
          </div>
          <Show when={systemStatus()}>
            {(status) => (
              <div
                style={{
                  'font-size': '9.5px',
                  opacity: 0.6,
                  'margin-top': '4px',
                  'word-break': 'break-all',
                }}
              >
                SQLite: {status().dbPath}
              </div>
            )}
          </Show>
        </div>
      </aside>

      {/* Main Workspace */}
      <main class="main-content">
        <Show
          when={activeSection() === 'connections'}
          fallback={
            <Show
              when={currentAgent()}
              fallback={
                <div class="welcome-view">
                  <div class="welcome-icon">🤖</div>
                  <h1 class="welcome-title">Bem-vindo ao Orchbot</h1>
                  <p class="welcome-desc">
                    Crie múltiplos agentes com seus próprios workspaces locais. Envie arquivos
                    anexados, organize tarefas em fila durável e faça seus agentes colaborarem e
                    delegarem tarefas entre si.
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      gap: '10px',
                      'justify-content': 'center',
                      'margin-top': '16px',
                    }}
                  >
                    <button
                      type="button"
                      class="btn-primary"
                      onClick={() => setActiveSection('connections')}
                    >
                      🔌 Selecionar e Configurar Conexões
                    </button>
                    <button
                      type="button"
                      class="btn-outline"
                      onClick={() => {
                        const enabled = connections().filter((c) => c.enabled)
                        if (enabled.length > 0) {
                          setProvider(enabled[0].providerId)
                          setModel(enabled[0].defaultModel)
                        } else {
                          setProvider('codex')
                          setModel('gpt-4o')
                        }
                        setShowModal(true)
                      }}
                    >
                      + Criar Primeiro Agente
                    </button>
                  </div>
                </div>
              }
            >
              {(agent) => (
                <div class="chat-workspace">
                  {/* Header do Agente */}
                  <header class="agent-detail-header">
                    <div class="agent-info">
                      <div class="agent-title-row">
                        <h2>{agent().name}</h2>

                        {/* Seletor dinâmico de Provedor durante a conversa */}
                        <div
                          class="midchat-switcher-group"
                          title="Trocar provedor de IA a qualquer momento na conversa"
                        >
                          <div class="midchat-field">
                            <span class="midchat-label">Provedor:</span>
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
                                {(c) => (
                                  <option value={c.providerId}>
                                    {c.providerId === 'codex'
                                      ? '🟢 Codex'
                                      : c.providerId === 'claude'
                                        ? '🟣 Claude'
                                        : c.providerId === 'grok'
                                          ? '⚡ Grok'
                                          : c.providerId === 'muse'
                                            ? '✨ Muse'
                                            : c.name}
                                  </option>
                                )}
                              </For>
                            </select>
                          </div>

                          <div class="midchat-field">
                            <span class="midchat-label">Modelo:</span>
                            <select
                              class="chat-model-select"
                              value={agent().model}
                              onChange={(e) =>
                                handleSwitchModelMidChat(agent().id, e.currentTarget.value)
                              }
                              title="Trocar modelo a qualquer momento"
                            >
                              <For
                                each={
                                  connections().find((c) => c.providerId === agent().provider)
                                    ?.models || [agent().model]
                                }
                              >
                                {(m) => <option value={m}>{m}</option>}
                              </For>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div class="agent-meta">
                        <span>
                          Workspace: <strong>{agent().workspacePath}</strong>
                        </span>
                        <Show when={workspaceRules()?.exists}>
                          <button
                            type="button"
                            class="rules-badge"
                            onClick={() => setShowRulesModal(true)}
                            title={`Diretrizes do projeto carregadas de ${workspaceRules()?.filename}`}
                          >
                            📜 {workspaceRules()?.filename} (Regras Ativas)
                          </button>
                        </Show>
                      </div>
                    </div>

                    {/* Alternador de Modo: Conversa vs Navegador */}
                    <div class="mode-switcher">
                      <button
                        type="button"
                        class={`btn-mode ${mainViewMode() === 'chat' ? 'active' : ''}`}
                        onClick={() => setMainViewMode('chat')}
                      >
                        💬 Conversa
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
                        🌐 Navegador {browserTabs().length > 0 ? `(${browserTabs().length})` : ''}
                      </button>
                    </div>

                    <div class="header-actions">
                      {/* Botão Buscar Memória & RAG Full-Text */}
                      <button
                        type="button"
                        class="btn-outline"
                        onClick={() => setShowSearchModal(true)}
                        title="Busca ultrarrápida em conversas e arquivos do projeto via SQLite FTS5"
                      >
                        🔍 Buscar / RAG
                      </button>

                      {/* Botão Delegar para outro agente */}
                      <button
                        type="button"
                        class="btn-outline"
                        onClick={handleOpenDelegationModal}
                        title="Delegar uma subtarefa para outro agente disponível"
                      >
                        🤝 Delegar
                      </button>

                      {/* Botão Pausar / Retomar Fila */}
                      <button
                        type="button"
                        class={`btn-outline ${isQueuePaused() ? 'active' : ''}`}
                        onClick={togglePauseQueue}
                        title="Pausa ou retoma a fila de execução de tarefas deste agente"
                      >
                        {isQueuePaused() ? '▶ Retomar Fila' : '⏸ Pausar Fila'}
                      </button>

                      {/* Botão Painel da Fila */}
                      <button
                        type="button"
                        class={`btn-outline ${showQueuePanel() ? 'active' : ''}`}
                        onClick={() => setShowQueuePanel(!showQueuePanel())}
                      >
                        📋 Fila ({pendingTasksCount()})
                      </button>

                      <button
                        type="button"
                        class="btn-danger"
                        onClick={() => handleDeleteAgent(agent().id)}
                      >
                        Remover Agente
                      </button>
                    </div>
                  </header>

                  {/* Drawer da Fila de Tarefas (Fase 3) */}
                  <Show when={showQueuePanel()}>
                    <div class="queue-panel">
                      <div class="queue-panel-header">
                        <span>Fila Durável do Agente (FIFO)</span>
                        <span>{isQueuePaused() ? 'Status: PAUSADA' : 'Status: ATIVA'}</span>
                      </div>

                      <For
                        each={tasks()}
                        fallback={
                          <div style={{ color: 'var(--text-muted)', 'font-size': '12px' }}>
                            Nenhuma tarefa recente na fila deste agente.
                          </div>
                        }
                      >
                        {(task) => (
                          <div class="queue-item">
                            <div class="queue-item-left">
                              <span class={`task-tag ${task.status}`}>{task.status}</span>
                              <span style={{ 'font-weight': '500' }}>{task.prompt}</span>
                              <Show when={task.error}>
                                <span style={{ color: '#f87171', 'font-size': '11px' }}>
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
                                  Repetir
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
                    {/* Barra de Múltiplas Conversas (Threads) */}
                    <div class="threads-bar">
                      <div class="threads-bar-header">
                        <span class="threads-bar-label">Conversas:</span>
                        <div class="threads-list">
                          <For each={agentThreads()}>
                            {(thread) => (
                              <div
                                class={`thread-chip ${activeThread()?.id === thread.id ? 'active' : ''}`}
                              >
                                <button
                                  type="button"
                                  class="thread-chip-select"
                                  onClick={() => handleSelectThread(thread)}
                                  title={`Tópico: ${thread.title}`}
                                >
                                  <span class="thread-chip-icon">💬</span>
                                  <span class="thread-chip-title">{thread.title}</span>
                                </button>
                                <button
                                  type="button"
                                  class="thread-chip-action"
                                  title="Renomear tópico da conversa"
                                  onClick={(e) => handleRenameThread(thread, e)}
                                >
                                  ✏️
                                </button>
                                <Show when={agentThreads().length > 1}>
                                  <button
                                    type="button"
                                    class="thread-chip-action delete"
                                    title="Excluir tópico da conversa"
                                    onClick={(e) => handleDeleteThread(thread, e)}
                                  >
                                    ✕
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
                        title="Criar novo tópico/sessão de conversa (ex: Refatorar Banco, Debug, Pesquisa)"
                      >
                        <span>+</span> Novo Tópico
                      </button>
                    </div>

                    {/* Lista de Mensagens / Conversa */}
                    <div class="chat-messages">
                      <Show when={agent().instructions}>
                        <div
                          class="card"
                          style={{
                            'margin-bottom': '12px',
                            padding: '10px 14px',
                            'font-size': '12px',
                          }}
                        >
                          <div
                            class="card-title"
                            style={{ 'font-size': '11px', 'margin-bottom': '4px' }}
                          >
                            Instruções do Agente
                          </div>
                          <div style={{ color: 'var(--text-muted)' }}>{agent().instructions}</div>
                        </div>
                      </Show>

                      <Show
                        when={messages().length > 0 || isStreaming()}
                        fallback={
                          <div class="chat-empty">
                            <div>
                              👋 Olá! Você está no tópico{' '}
                              <strong>"{activeThread()?.title || 'Conversa'}"</strong> do agente{' '}
                              <strong>{agent().name}</strong> operando via{' '}
                              <strong>{agent().provider.toUpperCase()}</strong>.
                            </div>
                            <div style={{ 'margin-top': '8px' }}>
                              Esta sessão é 100% isolada no workspace{' '}
                              <code>{agent().workspacePath}</code>. Envie tarefas ou anexe arquivos
                              abaixo sem misturar com outros tópicos.
                            </div>
                            <Show when={agentThreads().length <= 1}>
                              <div class="quick-topics-row">
                                <span class="quick-topics-label">
                                  Sugestões de tópicos para criar:
                                </span>
                                <div class="quick-topics-buttons">
                                  <button
                                    type="button"
                                    class="quick-topic-btn"
                                    onClick={() => handleCreateThread('Refatorar Banco de Dados')}
                                  >
                                    + Refatorar Banco de Dados
                                  </button>
                                  <button
                                    type="button"
                                    class="quick-topic-btn"
                                    onClick={() => handleCreateThread('Debug de Performance')}
                                  >
                                    + Debug de Performance
                                  </button>
                                  <button
                                    type="button"
                                    class="quick-topic-btn"
                                    onClick={() => handleCreateThread('Pesquisa no Navegador')}
                                  >
                                    + Pesquisa no Navegador
                                  </button>
                                </div>
                              </div>
                            </Show>
                          </div>
                        }
                      >
                        <For each={messages()}>
                          {(msg) => (
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
                                <span class="delegation-badge">🤝 Mensagem Delegada</span>
                              </Show>

                              <div class={`message-bubble ${msg.role}`}>
                                {msg.text}

                                {/* Lista de Anexos anexados na mensagem */}
                                <Show when={msg.attachments && msg.attachments.length > 0}>
                                  <div class="message-attachments-list">
                                    <For each={msg.attachments}>
                                      {(att) => (
                                        <button
                                          type="button"
                                          class="attachment-card"
                                          onClick={() => handleOpenFile(att.filePath)}
                                          title="Clique para abrir o arquivo no aplicativo padrão"
                                        >
                                          <span class="attachment-icon">📎</span>
                                          <div class="attachment-info">
                                            <span class="attachment-name">{att.fileName}</span>
                                            <span class="attachment-size">
                                              {formatFileSize(att.fileSize)} • {att.mimeType}
                                            </span>
                                          </div>
                                        </button>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </div>
                            </div>
                          )}
                        </For>

                        {/* Resposta em streaming em tempo real */}
                        <Show when={isStreaming()}>
                          <div class="message-row assistant">
                            <div class="message-author">
                              <span>{agent().name}</span>
                              <span class={`provider-tag ${agent().provider}`}>
                                {agent().provider} streaming
                              </span>
                            </div>
                            <div class="message-bubble assistant streaming">
                              {streamingText() || 'Processando resposta...'}
                              <div class="streaming-indicator">
                                <span class="pulse-dot" />
                                <span>{agent().provider.toUpperCase()} executando...</span>
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
                        <span>⚠️ Erro na execução: {chatError()}</span>
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

                    {/* Barra de input do chat */}
                    <div class="chat-input-container">
                      <form class="chat-input-form" onSubmit={handleSendMessage}>
                        {/* Arquivos staged antes do envio */}
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
                                    ✕
                                  </button>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>

                        <textarea
                          class="chat-textarea"
                          placeholder={`Enviar tarefa para ${agent().name} (${agent().provider})... (Enter envia, Shift+Enter pula linha)`}
                          value={inputText()}
                          onInput={(e) => setInputText(e.currentTarget.value)}
                          onKeyDown={handleKeyDown}
                        />
                        <div class="chat-actions-bar">
                          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                            <button
                              type="button"
                              class="btn-outline"
                              style={{ padding: '4px 8px', 'font-size': '11px' }}
                              onClick={handleSelectFiles}
                              title="Anexar arquivos gerenciados"
                            >
                              📎 Anexar
                            </button>
                            <span
                              class={`provider-tag ${agent().provider}`}
                              title="Provedor e modelo ativos para esta mensagem"
                            >
                              {agent().provider} • {agent().model}
                            </span>
                            <span>
                              {isQueuePaused()
                                ? '⏸ Fila Pausada'
                                : `${pendingTasksCount()} na fila`}
                            </span>
                          </div>

                          <div style={{ display: 'flex', gap: '8px' }}>
                            <Show when={isStreaming()}>
                              <button type="button" class="btn-interrupt" onClick={handleInterrupt}>
                                ⏹ Interromper
                              </button>
                            </Show>
                            <button
                              type="submit"
                              class="btn-primary"
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
                            <span style={{ 'font-size': '11px', color: 'var(--text-muted)' }}>
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
                              <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis' }}>
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
                                <p style={{ 'font-size': '12.5px', 'line-height': '1.5' }}>
                                  Abra páginas web com segurança em uma partição isolada com cookies
                                  e cache próprios deste agente. O agente pode extrair dados,
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
                                      style={{ padding: '2px 6px', 'font-size': '10.5px' }}
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
                                      <span style={{ 'font-size': '11px', 'font-weight': '600' }}>
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
                                        style={{ 'font-size': '11px', padding: '4px' }}
                                        onClick={() => handleBrowserClick(browserClickSelector())}
                                        disabled={!browserClickSelector().trim()}
                                      >
                                        👆 Executar Clique
                                      </button>
                                    </div>

                                    <div class="quick-interact-form">
                                      <span style={{ 'font-size': '11px', 'font-weight': '600' }}>
                                        Preencher Formulário
                                      </span>
                                      <input
                                        type="text"
                                        class="quick-interact-input"
                                        placeholder="Seletor CSS (ex: #search-box)"
                                        value={browserFillSelector()}
                                        onInput={(e) =>
                                          setBrowserFillSelector(e.currentTarget.value)
                                        }
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
                                        style={{ 'font-size': '11px', padding: '4px' }}
                                        onClick={() =>
                                          handleBrowserFill(
                                            browserFillSelector(),
                                            browserFillValue(),
                                          )
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
                              <span style={{ 'font-size': '10.5px', color: 'var(--text-muted)' }}>
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
                </div>
              )}
            </Show>
          }
        >
          {/* Tela de Seleção e Gerenciamento de Conexões */}
          <div class="connections-view">
            <div class="connections-header">
              <div class="connections-header-left">
                <h1 class="connections-title">
                  <span>🔌 Conexões & Provedores de IA</span>
                </h1>
                <p class="connections-desc">
                  Selecione e habilite quais conexões você deseja disponibilizar no Orchbot (Codex,
                  Claude, Grok, Muse). Configure credenciais, endpoints e modelos padrão com testes
                  de conectividade em tempo real.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  class="btn-primary"
                  onClick={() => {
                    const enabled = connections().filter((c) => c.enabled)
                    if (enabled.length > 0) {
                      setProvider(enabled[0].providerId)
                      setModel(enabled[0].defaultModel)
                    } else {
                      setProvider('codex')
                      setModel('gpt-4o')
                    }
                    setShowModal(true)
                  }}
                  title="Criar novo agente com os provedores configurados"
                >
                  + Novo Agente
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
                  🔄 Atualizar Status
                </button>
              </div>
            </div>

            <div class="connections-grid">
              <For each={connections()}>
                {(conn) => {
                  const draft = () => connectionDrafts()[conn.providerId] || {}
                  const isTesting = () => testingConnection() === conn.providerId
                  const isSaving = () => savingConnection() === conn.providerId
                  const testResult = () => testResults()[conn.providerId]
                  const savedMsg = () => saveMessage()[conn.providerId]
                  const isKeyVisible = () => Boolean(showApiKeys()[conn.providerId])

                  const getIcon = () => {
                    switch (conn.providerId) {
                      case 'codex':
                        return '🟢'
                      case 'claude':
                        return '🟣'
                      case 'grok':
                        return '⚡'
                      case 'muse':
                        return '✨'
                      default:
                        return '🤖'
                    }
                  }

                  return (
                    <div
                      class={`connection-box ${conn.enabled ? `active-${conn.providerId}` : 'disabled'}`}
                    >
                      <div class="connection-box-top">
                        <div class="connection-brand">
                          <span class="connection-icon-badge">{getIcon()}</span>
                          <div>
                            <div class="connection-name">{conn.name}</div>
                            <div style={{ 'font-size': '11px', color: 'var(--text-muted)' }}>
                              ID: <code>{conn.providerId}</code>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                          <Show
                            when={conn.enabled}
                            fallback={
                              <span class="connection-status-pill disabled">○ Desativado</span>
                            }
                          >
                            <Show
                              when={conn.available}
                              fallback={
                                <span
                                  class="connection-status-pill warning"
                                  title={conn.error || 'CLI ou API não detectada'}
                                >
                                  ⚠ Requer Configuração
                                </span>
                              }
                            >
                              <span class="connection-status-pill online">● Conectado</span>
                            </Show>
                          </Show>

                          <label
                            class="toggle-switch-wrapper"
                            title={conn.enabled ? 'Desativar conexão' : 'Ativar conexão'}
                          >
                            <div class="toggle-switch">
                              <input
                                type="checkbox"
                                checked={conn.enabled}
                                onChange={(e) =>
                                  handleToggleConnection(conn, e.currentTarget.checked)
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
                          <select
                            id={`conn-model-${conn.providerId}`}
                            class="connection-input"
                            value={draft().defaultModel ?? conn.defaultModel}
                            onChange={(e) =>
                              updateDraftField(
                                conn.providerId,
                                'defaultModel',
                                e.currentTarget.value,
                              )
                            }
                            disabled={!conn.enabled}
                          >
                            <For each={conn.models}>{(m) => <option value={m}>{m}</option>}</For>
                          </select>
                        </div>

                        <div class="connection-field">
                          <label class="connection-field-label" for={`conn-key-${conn.providerId}`}>
                            Chave de Acesso / API Key
                          </label>
                          <div class="api-key-group">
                            <input
                              id={`conn-key-${conn.providerId}`}
                              type={isKeyVisible() ? 'text' : 'password'}
                              class="connection-input"
                              placeholder="CLI local / variável de ambiente / chave personalizada..."
                              value={draft().apiKey ?? (conn.apiKey || '')}
                              onInput={(e) =>
                                updateDraftField(conn.providerId, 'apiKey', e.currentTarget.value)
                              }
                              disabled={!conn.enabled}
                            />
                            <button
                              type="button"
                              class="btn-icon-eye"
                              onClick={() => toggleShowApiKey(conn.providerId)}
                              title={isKeyVisible() ? 'Ocultar chave' : 'Mostrar chave'}
                              disabled={!conn.enabled}
                            >
                              {isKeyVisible() ? '🙈' : '👁️'}
                            </button>
                          </div>
                        </div>

                        <div class="connection-field">
                          <label
                            class="connection-field-label"
                            for={`conn-endpoint-${conn.providerId}`}
                          >
                            Endpoint Customizado (Opcional)
                          </label>
                          <input
                            id={`conn-endpoint-${conn.providerId}`}
                            type="text"
                            class="connection-input"
                            placeholder="Ex: https://api.x.ai/v1 ou proxy local..."
                            value={draft().endpoint ?? (conn.endpoint || '')}
                            onInput={(e) =>
                              updateDraftField(conn.providerId, 'endpoint', e.currentTarget.value)
                            }
                            disabled={!conn.enabled}
                          />
                        </div>
                      </div>

                      <Show when={testResult()}>
                        {(res) => (
                          <div
                            class={`connection-result-msg ${res().success ? 'success' : 'error'}`}
                          >
                            <strong>{res().success ? '✓ Sucesso: ' : '✗ Erro: '}</strong>
                            {res().message}
                          </div>
                        )}
                      </Show>

                      <Show when={savedMsg()}>
                        {(msg) => <div class="connection-save-feedback">✓ {msg()}</div>}
                      </Show>

                      <div class="connection-card-actions">
                        <button
                          type="button"
                          class="btn-outline"
                          onClick={() => handleTestConnection(conn.providerId)}
                          disabled={!conn.enabled || isTesting()}
                          title="Testar comunicação com a CLI ou API do provedor"
                        >
                          {isTesting() ? '⏳ Testando...' : '🧪 Testar Conexão'}
                        </button>

                        <button
                          type="button"
                          class="btn-primary"
                          onClick={() => handleSaveConnection(conn)}
                          disabled={!conn.enabled || isSaving()}
                        >
                          {isSaving() ? 'Salvando...' : '💾 Salvar Configuração'}
                        </button>
                      </div>
                    </div>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>
      </main>

      {/* Modal Delegar Tarefa para Outro Agente (Fase 4) */}
      <Show when={showDelegationModal()}>
        <dialog
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
      <Show when={showModal()}>
        <dialog
          class="modal-overlay"
          open
          onClick={() => setShowModal(false)}
          onKeyDown={(e) => e.key === 'Escape' && setShowModal(false)}
        >
          <div
            class="modal-content"
            role="document"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div class="modal-header">
              <span class="modal-title">Novo Agente</span>
              <button type="button" class="modal-close" onClick={() => setShowModal(false)}>
                ✕
              </button>
            </div>

            <form class="modal-form" onSubmit={handleCreateAgent}>
              <Show when={errorMessage()}>
                <div style={{ color: 'var(--danger)', 'font-size': '12px' }}>{errorMessage()}</div>
              </Show>

              <div class="form-group">
                <label for="agent-name">Nome do Agente</label>
                <input
                  id="agent-name"
                  type="text"
                  placeholder="Ex: Codex Engineer ou Claude Reviewer"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  required
                />
              </div>

              {/* Seleção Interativa do Provedor (Codex, Claude, Grok, Muse) */}
              <div class="form-group">
                <span class="form-label-title">Escolha o Provedor de IA</span>
                <Show
                  when={connections().filter((c) => c.enabled).length > 0}
                  fallback={
                    <div
                      style={{
                        padding: '12px',
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        'border-radius': 'var(--radius-sm)',
                        'font-size': '12px',
                        display: 'flex',
                        'align-items': 'center',
                        'justify-content': 'space-between',
                      }}
                    >
                      <span>⚠️ Nenhuma conexão de IA está ativada.</span>
                      <button
                        type="button"
                        class="btn-outline"
                        style={{ padding: '2px 8px', 'font-size': '11px' }}
                        onClick={() => {
                          setShowModal(false)
                          setActiveSection('connections')
                        }}
                      >
                        Ativar Conexões
                      </button>
                    </div>
                  }
                >
                  <div class="provider-cards-grid">
                    <For each={connections()}>
                      {(conn) => {
                        const isSelected = () => provider() === conn.providerId
                        const isEnabled = () => conn.enabled
                        return (
                          <button
                            type="button"
                            class={`provider-card ${isSelected() ? `selected ${conn.providerId}` : ''}`}
                            onClick={() => {
                              if (isEnabled()) {
                                handleProviderChange(conn.providerId)
                              }
                            }}
                            disabled={!isEnabled()}
                            style={!isEnabled() ? { opacity: '0.4', cursor: 'not-allowed' } : {}}
                          >
                            <div class="provider-card-title">
                              <span>{conn.name}</span>
                              <span class={`status-dot ${conn.available ? 'online' : ''}`} />
                            </div>
                            <div class="provider-card-sub">
                              {isEnabled()
                                ? conn.available
                                  ? 'Conexão Pronta'
                                  : 'Requer Configuração'
                                : 'Desativado'}
                            </div>
                          </button>
                        )
                      }}
                    </For>
                  </div>
                </Show>
              </div>

              <div class="form-group">
                <label for="agent-model">Modelo</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    id="agent-model-select"
                    style={{
                      'background-color': 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      'border-radius': 'var(--radius-sm)',
                      padding: '8px 12px',
                      color: 'var(--text-main)',
                      'font-size': '13px',
                      outline: 'none',
                    }}
                    value={model()}
                    onChange={(e) => setModel(e.currentTarget.value)}
                  >
                    <For
                      each={
                        connections().find((c) => c.providerId === provider())?.models || [model()]
                      }
                    >
                      {(m) => <option value={m}>{m}</option>}
                    </For>
                  </select>
                  <input
                    id="agent-model"
                    type="text"
                    value={model()}
                    onInput={(e) => setModel(e.currentTarget.value)}
                    placeholder="Ou digite o nome do modelo..."
                    style={{ flex: 1 }}
                    required
                  />
                </div>
              </div>

              <div class="form-group">
                <label for="agent-workspace">Caminho da Pasta / Workspace</label>
                <input
                  id="agent-workspace"
                  type="text"
                  value={workspacePath()}
                  onInput={(e) => setWorkspacePath(e.currentTarget.value)}
                  required
                />
              </div>

              <div class="form-group">
                <label for="agent-instructions">Instruções Personalizadas</label>
                <textarea
                  id="agent-instructions"
                  placeholder="Ex: Você é um desenvolvedor focado em testes limpos..."
                  value={instructions()}
                  onInput={(e) => setInstructions(e.currentTarget.value)}
                />
              </div>

              <div class="modal-actions">
                <button type="button" class="btn-secondary" onClick={() => setShowModal(false)}>
                  Cancelar
                </button>
                <button type="submit" class="btn-primary" disabled={loading()}>
                  {loading() ? 'Criando...' : 'Criar Agente'}
                </button>
              </div>
            </form>
          </div>
        </dialog>
      </Show>

      {/* Modal de Diretrizes do Projeto (ORCHBOT.md / AGENTS.md) */}
      <Show when={showRulesModal()}>
        <dialog
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
                  📜 Diretrizes do Projeto ({workspaceRules()?.filename})
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
                <span class="modal-title">🔍 Busca Rápida de Memória & RAG (SQLite FTS5)</span>
                <div
                  style={{
                    'font-size': '11px',
                    color: 'var(--text-muted)',
                    'margin-top': '2px',
                  }}
                >
                  Pesquise instantaneamente no histórico de conversas e nos arquivos do projeto.
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
                  💬 Conversas Anteriores ({searchResults()?.messages.length ?? 0})
                </button>
                <button
                  type="button"
                  class={`search-tab-btn ${searchTab() === 'files' ? 'active' : ''}`}
                  onClick={() => setSearchTab('files')}
                >
                  📁 Arquivos do Repositório ({searchResults()?.files.length ?? 0})
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
                          <span class="search-result-thread">💬 {res.threadTitle}</span>
                          <span class="search-result-role">
                            {res.role === 'user' ? 'Usuário' : 'Assistente'}
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
                      <div class="search-result-snippet" innerHTML={res.snippet} />
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
                          <span class="search-result-thread">📁 {file.fileName}</span>
                          <span class="search-result-role" style={{ 'font-size': '10px' }}>
                            {file.filePath}
                          </span>
                        </div>
                      </div>
                      <div class="search-result-snippet code" innerHTML={file.snippet} />
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
    </div>
  )
}
