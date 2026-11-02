import { type Component, For, Show, createSignal, onMount } from 'solid-js'
import type { Agent, SupportedProvider, SystemStatus } from '../../shared/types'

export const App: Component = () => {
  const [agents, setAgents] = createSignal<Agent[]>([])
  const [selectedAgentId, setSelectedAgentId] = createSignal<string | null>(null)
  const [systemStatus, setSystemStatus] = createSignal<SystemStatus | null>(null)
  const [showModal, setShowModal] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null)

  // Form signals
  const [name, setName] = createSignal('')
  const [provider, setProvider] = createSignal<SupportedProvider>('codex')
  const [model, setModel] = createSignal('gpt-4o')
  const [workspacePath, setWorkspacePath] = createSignal('/home/joao/Documents/Orchbot')
  const [instructions, setInstructions] = createSignal('')

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

  onMount(() => {
    loadAgents()
    loadSystemStatus()
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
        }
        await loadAgents()
      }
    } catch (err) {
      alert(`Erro ao deletar agente: ${err instanceof Error ? err.message : String(err)}`)
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
          <button type="button" class="btn-primary" onClick={() => setShowModal(true)}>
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
          <div>SQLite Local Ativo</div>
          <Show when={systemStatus()}>
            {(status) => (
              <div style={{ 'font-size': '10px', opacity: 0.7, 'word-break': 'break-all' }}>
                {status().dbPath}
              </div>
            )}
          </Show>
        </div>
      </aside>

      {/* Main Content */}
      <main class="main-content">
        <Show
          when={currentAgent()}
          fallback={
            <div class="welcome-view">
              <div class="welcome-icon">🤖</div>
              <h1 class="welcome-title">Bem-vindo ao Orchbot</h1>
              <p class="welcome-desc">
                Seu workspace local-first para agentes de IA persistentes. Seus dados, conversas e
                instruções residem com segurança no seu disco local.
              </p>
              <button type="button" class="btn-primary" onClick={() => setShowModal(true)}>
                Criar Primeiro Agente
              </button>
            </div>
          }
        >
          {(agent) => (
            <>
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
                <button
                  type="button"
                  class="btn-danger"
                  onClick={() => handleDeleteAgent(agent().id)}
                >
                  Remover Agente
                </button>
              </header>

              <div class="agent-body">
                <div class="card">
                  <div class="card-title">Instruções do Agente</div>
                  <div class="instructions-text">
                    {agent().instructions || 'Nenhuma instrução personalizada definida.'}
                  </div>
                </div>

                <div class="card">
                  <div class="card-title">Conversa & Execução</div>
                  <p style={{ 'font-size': '13px', color: 'var(--text-muted)' }}>
                    A infraestrutura local e o banco de dados estão prontos. A próxima etapa (Fase
                    2) habilitará a conexão direta via streaming com a CLI/App Server do provedor (
                    {agent().provider}).
                  </p>
                </div>
              </div>
            </>
          )}
        </Show>
      </main>

      {/* Modal Criar Agente */}
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
                  placeholder="Ex: Refactor Bot"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  required
                />
              </div>

              <div class="form-group">
                <label for="agent-provider">Provedor</label>
                <select
                  id="agent-provider"
                  value={provider()}
                  onChange={(e) => handleProviderChange(e.currentTarget.value as SupportedProvider)}
                >
                  <option value="codex">Codex (CLI Oficial)</option>
                  <option value="claude">Claude Code</option>
                </select>
              </div>

              <div class="form-group">
                <label for="agent-model">Modelo</label>
                <input
                  id="agent-model"
                  type="text"
                  value={model()}
                  onInput={(e) => setModel(e.currentTarget.value)}
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
                <label for="agent-instructions">Instruções Específicas</label>
                <textarea
                  id="agent-instructions"
                  placeholder="Ex: Atue como especialista em TypeScript..."
                  value={instructions()}
                  onInput={(e) => setInstructions(e.currentTarget.value)}
                />
              </div>

              <div class="modal-actions">
                <button type="button" class="btn-secondary" onClick={() => setShowModal(false)}>
                  Cancelar
                </button>
                <button type="submit" class="btn-primary" disabled={loading()}>
                  {loading() ? 'Salvando...' : 'Criar Agente'}
                </button>
              </div>
            </form>
          </div>
        </dialog>
      </Show>
    </div>
  )
}
