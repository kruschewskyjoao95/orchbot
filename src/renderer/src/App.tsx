import { type Component, For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type {
  Agent,
  Message,
  ProviderInfo,
  SelectedFile,
  SupportedProvider,
  SystemStatus,
  TaskQueueItem,
  Thread,
} from '../../shared/types'

export const App: Component = () => {
  const [agents, setAgents] = createSignal<Agent[]>([])
  const [selectedAgentId, setSelectedAgentId] = createSignal<string | null>(null)
  const [activeThread, setActiveThread] = createSignal<Thread | null>(null)
  const [messages, setMessages] = createSignal<Message[]>([])
  const [systemStatus, setSystemStatus] = createSignal<SystemStatus | null>(null)
  const [providerStatuses, setProviderStatuses] = createSignal<Record<
    SupportedProvider,
    ProviderInfo
  > | null>(null)

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

  // Chat signals
  const [inputText, setInputText] = createSignal('')
  const [isStreaming, setIsStreaming] = createSignal(false)
  const [streamingText, setStreamingText] = createSignal('')
  const [chatError, setChatError] = createSignal<string | null>(null)

  // Modal signals
  const [showModal, setShowModal] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)

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

  const loadThreadAndMessages = async (agentId: string) => {
    try {
      if (window.orchbot) {
        const threads = await window.orchbot.getThreads(agentId)
        if (threads.length > 0) {
          const currentThread = threads[0]
          setActiveThread(currentThread)
          const msgs = await window.orchbot.getMessages(currentThread.id)
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

  onMount(() => {
    loadAgents()
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

    onCleanup(() => {
      unsubChunk()
      unsubFinished()
      unsubError()
      unsubTask()
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
      loadThreadAndMessages(id)
      loadQueue(id)
    }
  })

  const currentAgent = () => {
    const id = selectedAgentId()
    return agents().find((a) => a.id === id) || null
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
    if (p === 'codex') {
      setModel('gpt-4o')
    } else {
      setModel('claude-3-7-sonnet')
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
              setProvider('codex')
              setModel('gpt-4o')
              setShowModal(true)
            }}
          >
            + Novo
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
                class={`agent-item ${selectedAgentId() === agent.id ? 'active' : ''}`}
                onClick={() => setSelectedAgentId(agent.id)}
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
          <div style={{ 'font-weight': '600', 'margin-bottom': '2px' }}>Provedores Locais:</div>
          <div class="provider-status-list">
            <div class="provider-status-item">
              <span class={`status-dot ${providerStatuses()?.codex.available ? 'online' : ''}`} />
              <span>Codex: {providerStatuses()?.codex.available ? 'Pronto' : 'Ausente'}</span>
            </div>
            <div class="provider-status-item">
              <span class={`status-dot ${providerStatuses()?.claude.available ? 'online' : ''}`} />
              <span>Claude: {providerStatuses()?.claude.available ? 'Pronto' : 'Ausente'}</span>
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
          when={currentAgent()}
          fallback={
            <div class="welcome-view">
              <div class="welcome-icon">🤖</div>
              <h1 class="welcome-title">Bem-vindo ao Orchbot</h1>
              <p class="welcome-desc">
                Crie múltiplos agentes com seus próprios workspaces locais. Envie arquivos anexados,
                organize tarefas em fila durável e faça seus agentes colaborarem e delegarem tarefas
                entre si.
              </p>
              <button
                type="button"
                class="btn-primary"
                onClick={() => {
                  setProvider('codex')
                  setModel('gpt-4o')
                  setShowModal(true)
                }}
              >
                Criar Primeiro Agente
              </button>
            </div>
          }
        >
          {(agent) => (
            <div class="chat-workspace">
              {/* Header do Agente */}
              <header class="agent-detail-header">
                <div class="agent-info">
                  <h2>
                    {agent().name}
                    <span class={`provider-tag ${agent().provider}`}>{agent().provider}</span>
                  </h2>
                  <div class="agent-meta">
                    <span>
                      Modelo: <strong>{agent().model}</strong>
                    </span>
                    <span>
                      Workspace: <strong>{agent().workspacePath}</strong>
                    </span>
                  </div>
                </div>

                <div class="header-actions">
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
                    <div class="card-title" style={{ 'font-size': '11px', 'margin-bottom': '4px' }}>
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
                        👋 Olá! Eu sou <strong>{agent().name}</strong> operando via{' '}
                        <strong>{agent().provider.toUpperCase()}</strong>.
                      </div>
                      <div style={{ 'margin-top': '8px' }}>
                        Envie tarefas ou anexe arquivos abaixo. Elas serão salvas e executadas de
                        forma organizada no workspace <code>{agent().workspacePath}</code>.
                      </div>
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
                      <span>
                        Workspace: <code>{agent().workspacePath}</code> |{' '}
                        {isQueuePaused() ? '⏸ Fila Pausada' : `${pendingTasksCount()} na fila`}
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
            </div>
          )}
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

              {/* Seleção Interativa do Provedor (Codex ou Claude) */}
              <div class="form-group">
                <span class="form-label-title">Escolha o Provedor de IA</span>
                <div class="provider-cards-grid">
                  <button
                    type="button"
                    class={`provider-card ${provider() === 'codex' ? 'selected codex' : ''}`}
                    onClick={() => handleProviderChange('codex')}
                  >
                    <div class="provider-card-title">
                      <span>Codex</span>
                      <span
                        class={`status-dot ${providerStatuses()?.codex.available ? 'online' : ''}`}
                      />
                    </div>
                    <div class="provider-card-sub">
                      {providerStatuses()?.codex.available
                        ? 'CLI Oficial OpenAI (Pronto)'
                        : 'CLI não encontrada'}
                    </div>
                  </button>

                  <button
                    type="button"
                    class={`provider-card ${provider() === 'claude' ? 'selected claude' : ''}`}
                    onClick={() => handleProviderChange('claude')}
                  >
                    <div class="provider-card-title">
                      <span>Claude Code</span>
                      <span
                        class={`status-dot ${providerStatuses()?.claude.available ? 'online' : ''}`}
                      />
                    </div>
                    <div class="provider-card-sub">
                      {providerStatuses()?.claude.available
                        ? 'Claude CLI Anthropic (Pronto)'
                        : 'CLI não encontrada'}
                    </div>
                  </button>
                </div>
              </div>

              <div class="form-group">
                <label for="agent-model">Modelo</label>
                <input
                  id="agent-model"
                  type="text"
                  value={model()}
                  onInput={(e) => setModel(e.currentTarget.value)}
                  placeholder={
                    provider() === 'codex' ? 'Ex: gpt-4o, o3-mini' : 'Ex: claude-3-7-sonnet'
                  }
                  required
                />
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
    </div>
  )
}
