import { type Component, For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type {
  Agent,
  Message,
  ProviderInfo,
  SupportedProvider,
  SystemStatus,
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

    onCleanup(() => {
      unsubChunk()
      unsubFinished()
      unsubError()
    })
  })

  // Efeito quando troca de agente selecionado
  createEffect(() => {
    const id = selectedAgentId()
    if (id) {
      setStreamingText('')
      setIsStreaming(false)
      setChatError(null)
      loadThreadAndMessages(id)
    }
  })

  const currentAgent = () => {
    const id = selectedAgentId()
    return agents().find((a) => a.id === id) || null
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
        }
        await loadAgents()
      }
    } catch (err) {
      alert(`Erro ao deletar agente: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSendMessage = async (e: Event) => {
    e.preventDefault()
    const text = inputText().trim()
    const thread = activeThread()
    if (!text || !thread || isStreaming()) return

    setInputText('')
    setChatError(null)
    setIsStreaming(true)
    setStreamingText('')

    try {
      if (window.orchbot) {
        const userMsg = await window.orchbot.sendMessage(thread.id, text)
        setMessages((prev) => [...prev, userMsg])
        scrollToBottom()
      }
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : String(err))
      setIsStreaming(false)
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
          // Mantém o que já tinha chegado como resposta parcial
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
                Crie agentes persistentes com seus próprios workspaces locais. Escolha se prefere
                conectar com <strong>Codex</strong> ou <strong>Claude</strong> para cada agente e
                execute tarefas reais com streaming direto na interface.
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
                  <button
                    type="button"
                    class="btn-danger"
                    onClick={() => handleDeleteAgent(agent().id)}
                  >
                    Remover Agente
                  </button>
                </div>
              </header>

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
                        Envie uma tarefa ou pergunta abaixo para iniciarmos os trabalhos na pasta{' '}
                        <code>{agent().workspacePath}</code>.
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
                        <div class={`message-bubble ${msg.role}`}>{msg.text}</div>
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
                  <textarea
                    class="chat-textarea"
                    placeholder={`Enviar tarefa para ${agent().name} (${agent().provider})... (Enter envia, Shift+Enter pula linha)`}
                    value={inputText()}
                    onInput={(e) => setInputText(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isStreaming()}
                  />
                  <div class="chat-actions-bar">
                    <span>
                      Workspace ativo: <code>{agent().workspacePath}</code>
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <Show when={isStreaming()}>
                        <button type="button" class="btn-interrupt" onClick={handleInterrupt}>
                          ⏹ Interromper
                        </button>
                      </Show>
                      <button
                        type="submit"
                        class="btn-primary"
                        disabled={!inputText().trim() || isStreaming()}
                      >
                        {isStreaming() ? 'Executando...' : 'Enviar'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}
        </Show>
      </main>

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
