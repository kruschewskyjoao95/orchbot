import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type { Agent, Channel, ChannelMessage } from '../../shared/types'
import { MessageText } from './MessageText'
import { focusDialog } from './dialog-focus'

/** Mostra o canal escolhido na barra lateral; a lista de canais fica no App. */
export function Channels(props: {
  agents: Agent[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  creating: boolean
  onCreatingChange: (open: boolean) => void
  onChanged: () => void
}) {
  const [channels, setChannels] = createSignal<Channel[]>([])
  const selectedId = () => props.selectedId
  const setSelectedId = (id: string | null) => props.onSelect(id)
  const creating = () => props.creating
  const setCreating = (open: boolean) => props.onCreatingChange(open)
  const [messages, setMessages] = createSignal<ChannelMessage[]>([])
  const [text, setText] = createSignal('')
  const [error, setError] = createSignal('')
  const [title, setTitle] = createSignal('')
  const [goal, setGoal] = createSignal('')
  const [instructions, setInstructions] = createSignal('')
  const [workspacePath, setWorkspacePath] = createSignal('')
  const [owner, setOwner] = createSignal('')
  const [members, setMembers] = createSignal<string[]>([])
  const [editingContext, setEditingContext] = createSignal(false)
  const [editInstructions, setEditInstructions] = createSignal('')
  const [editWorkspace, setEditWorkspace] = createSignal('')
  let logEl: HTMLDivElement | undefined

  const selected = () => channels().find((c) => c.id === selectedId()) ?? null
  const agentOf = (id: string | null) => props.agents.find((a) => a.id === id)
  const label = (a?: Agent) => (a ? `${a.avatar ?? '🤖'} ${a.name}` : 'Agente removido')

  const refresh = async () => {
    // Inclui arquivados: o canal aberto pode ser um arquivado escolhido na barra lateral.
    const list = await window.orchbot.listChannels(true)
    setChannels(list)
    const id = selectedId()
    if (id && list.some((c) => c.id === id))
      setMessages(await window.orchbot.getChannelMessages(id))
    else if (id) setSelectedId(null)
  }
  const guard = async (action: () => Promise<unknown>) => {
    setError('')
    try {
      await action()
      await refresh()
      props.onChanged()
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : String(problem),
      )
    }
  }

  onMount(() => {
    void refresh()
    // Respostas dos agentes chegam como fim de turno / mudança na fila.
    const off = [
      window.orchbot.onTurnFinished(refresh),
      window.orchbot.onTaskStatusChanged(refresh),
    ]
    onCleanup(() => {
      for (const fn of off) fn()
    })
  })
  createEffect(() => {
    selectedId()
    setEditingContext(false)
    void refresh()
  })
  // Abrir "Novo grupo" já sugere o primeiro agente como dono.
  createEffect(() => {
    if (props.creating && !owner()) setOwner(props.agents[0]?.id ?? '')
  })
  createEffect(() => {
    messages()
    queueMicrotask(() => logEl?.scrollTo({ top: logEl.scrollHeight }))
  })

  const create = (e: Event) => {
    e.preventDefault()
    void guard(async () => {
      const channel = await window.orchbot.createChannel({
        title: title(),
        goal: goal(),
        ownerAgentId: owner(),
        memberIds: members(),
        instructions: instructions(),
        workspacePath: workspacePath(),
      })
      setCreating(false)
      setTitle('')
      setGoal('')
      setInstructions('')
      setWorkspacePath('')
      setMembers([])
      setSelectedId(channel.id)
    })
  }
  const send = (e: Event) => {
    e.preventDefault()
    const channel = selected()
    const body = text().trim()
    if (!channel || !body) return
    setText('')
    void guard(() => window.orchbot.postChannelMessage(channel.id, body))
  }
  const author = (m: ChannelMessage) =>
    m.kind === 'system' ? 'Sistema' : m.authorAgentId ? label(agentOf(m.authorAgentId)) : '🧑 Você'

  return (
    <div class="channels-view">
      <section class="channel-main">
        <Show when={error()}>
          <div class="channel-error">{error()}</div>
        </Show>
        <Show
          when={selected()}
          fallback={
            <div class="channels-empty">Escolha um grupo na barra lateral ou crie um novo.</div>
          }
        >
          {(channel) => (
            <>
              <header class="channel-head">
                <div>
                  <h2># {channel().title}</h2>
                  <Show when={channel().goal}>
                    <p class="channel-goal">{channel().goal}</p>
                  </Show>
                  <Show
                    when={channel().instructions || channel().workspacePath}
                    fallback={<p class="channel-owner">Sem pacote de contexto.</p>}
                  >
                    <Show when={channel().instructions}>
                      <p class="channel-goal">{channel().instructions}</p>
                    </Show>
                    <Show when={channel().workspacePath}>
                      <p class="channel-owner">Pasta: {channel().workspacePath}</p>
                    </Show>
                  </Show>
                  <p class="channel-owner">
                    Dono da tarefa: <strong>{label(agentOf(channel().ownerAgentId))}</strong> ·
                    Participantes:{' '}
                    {channel()
                      .members.map((m) => agentOf(m.agentId)?.name ?? '?')
                      .join(', ')}
                  </p>
                </div>
                <div class="channel-controls">
                  <Show when={!channel().archived}>
                    <Show
                      when={channel().status === 'active'}
                      fallback={
                        <button
                          type="button"
                          class="btn-primary"
                          onClick={() =>
                            guard(() => window.orchbot.controlChannel(channel().id, 'resume'))
                          }
                        >
                          ▶️ Retomar
                        </button>
                      }
                    >
                      <button
                        type="button"
                        class="btn-outline"
                        onClick={() =>
                          guard(() => window.orchbot.controlChannel(channel().id, 'stop'))
                        }
                      >
                        ⏹️ Parar
                      </button>
                    </Show>
                    <select
                      class="chat-provider-select"
                      title="Reatribuir a tarefa a outro agente"
                      value=""
                      onChange={(e) => {
                        const id = e.currentTarget.value
                        e.currentTarget.value = ''
                        if (id)
                          void guard(() =>
                            window.orchbot.controlChannel(channel().id, 'reassign', id),
                          )
                      }}
                    >
                      <option value="">🔁 Reatribuir…</option>
                      <For each={props.agents.filter((a) => a.id !== channel().ownerAgentId)}>
                        {(a) => <option value={a.id}>{label(a)}</option>}
                      </For>
                    </select>
                    <button
                      type="button"
                      class="btn-outline"
                      onClick={() => {
                        setEditInstructions(channel().instructions)
                        setEditWorkspace(channel().workspacePath)
                        setEditingContext(true)
                      }}
                    >
                      Contexto
                    </button>
                    <button
                      type="button"
                      class="btn-outline"
                      onClick={() =>
                        guard(() => window.orchbot.controlChannel(channel().id, 'archive'))
                      }
                    >
                      🗄️ Arquivar
                    </button>
                  </Show>
                  <Show when={channel().archived}>
                    <button
                      type="button"
                      class="btn-primary"
                      onClick={() =>
                        guard(() => window.orchbot.controlChannel(channel().id, 'restore'))
                      }
                    >
                      ♻️ Restaurar
                    </button>
                  </Show>
                </div>
              </header>
              <Show when={editingContext()}>
                <form
                  class="channel-context-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const id = channel().id
                    void guard(async () => {
                      await window.orchbot.updateChannelContext(id, {
                        instructions: editInstructions(),
                        workspacePath: editWorkspace(),
                      })
                      setEditingContext(false)
                    })
                  }}
                >
                  <div class="form-group">
                    <label for="ch-edit-instructions">Instruções do grupo</label>
                    <textarea
                      id="ch-edit-instructions"
                      value={editInstructions()}
                      onInput={(e) => setEditInstructions(e.currentTarget.value)}
                      rows={3}
                    />
                  </div>
                  <div class="form-group">
                    <label for="ch-edit-workspace">Pasta compartilhada</label>
                    <input
                      id="ch-edit-workspace"
                      type="text"
                      value={editWorkspace()}
                      onInput={(e) => setEditWorkspace(e.currentTarget.value)}
                    />
                  </div>
                  <div class="channel-controls">
                    <button type="submit" class="btn-primary">
                      Salvar contexto
                    </button>
                    <button
                      type="button"
                      class="btn-outline"
                      onClick={() => setEditingContext(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </Show>

              <div class="channel-log" ref={logEl}>
                <For each={messages()}>
                  {(m) => (
                    <div
                      class="channel-msg"
                      classList={{
                        system: m.kind === 'system',
                        mine: !m.authorAgentId && m.kind !== 'system',
                      }}
                    >
                      <span class="channel-msg-author">{author(m)}</span>
                      <div class="channel-msg-text">
                        <Show when={m.authorAgentId} fallback={m.text}>
                          <MessageText text={m.text} />
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>

              <form class="channel-compose" onSubmit={send}>
                <input
                  type="text"
                  value={text()}
                  placeholder={
                    channel().archived
                      ? 'Grupo arquivado'
                      : channel().status === 'stopped'
                        ? 'Grupo pausado: retome para continuar'
                        : 'Fale com o dono da tarefa…'
                  }
                  disabled={channel().archived || channel().status === 'stopped'}
                  onInput={(e) => setText(e.currentTarget.value)}
                />
                <button
                  type="submit"
                  class="btn-primary"
                  disabled={!text().trim() || channel().archived || channel().status === 'stopped'}
                >
                  Enviar
                </button>
              </form>
            </>
          )}
        </Show>
      </section>

      <Show when={creating()}>
        <dialog
          ref={focusDialog}
          aria-modal="true"
          aria-label="Novo grupo"
          class="modal-overlay"
          open
          onClick={() => setCreating(false)}
          onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
        >
          <div
            class="modal-content"
            role="document"
            style={{ width: '520px' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setCreating(false)
            }}
          >
            <div class="modal-header">
              <span class="modal-title">Novo grupo</span>
              <button
                type="button"
                class="modal-close"
                aria-label="Fechar criação de grupo"
                onClick={() => setCreating(false)}
              >
                ✕
              </button>
            </div>
            <form class="modal-form" onSubmit={create}>
              <div class="form-group">
                <label for="ch-title">Título</label>
                <input
                  id="ch-title"
                  type="text"
                  required
                  value={title()}
                  onInput={(e) => setTitle(e.currentTarget.value)}
                  placeholder="Ex: Lançamento da v2"
                />
              </div>
              <div class="form-group">
                <label for="ch-goal">Objetivo da tarefa</label>
                <input
                  id="ch-goal"
                  type="text"
                  value={goal()}
                  onInput={(e) => setGoal(e.currentTarget.value)}
                  placeholder="O que precisa ser entregue"
                />
              </div>
              <div class="form-group">
                <label for="ch-instructions">Instruções do grupo</label>
                <textarea
                  id="ch-instructions"
                  value={instructions()}
                  onInput={(e) => setInstructions(e.currentTarget.value)}
                  placeholder="Regras e contexto que todos os participantes seguem"
                  rows={3}
                />
              </div>
              <div class="form-group">
                <label for="ch-workspace">Pasta compartilhada</label>
                <input
                  id="ch-workspace"
                  type="text"
                  value={workspacePath()}
                  onInput={(e) => setWorkspacePath(e.currentTarget.value)}
                  placeholder="Opcional — senão cada agente usa a pasta dele"
                />
              </div>
              <div class="form-group">
                <label for="ch-owner">Dono da tarefa</label>
                <select
                  id="ch-owner"
                  value={owner()}
                  onChange={(e) => setOwner(e.currentTarget.value)}
                >
                  <For each={props.agents}>{(a) => <option value={a.id}>{label(a)}</option>}</For>
                </select>
              </div>
              <div class="form-group">
                <span>Participantes</span>
                <For each={props.agents.filter((a) => a.id !== owner())}>
                  {(a) => (
                    <label class="channels-toggle">
                      <input
                        type="checkbox"
                        checked={members().includes(a.id)}
                        onChange={(e) =>
                          setMembers((prev) =>
                            e.currentTarget.checked
                              ? [...prev, a.id]
                              : prev.filter((id) => id !== a.id),
                          )
                        }
                      />{' '}
                      {label(a)}
                    </label>
                  )}
                </For>
              </div>
              <button type="submit" class="btn-primary" disabled={!title().trim() || !owner()}>
                Criar grupo
              </button>
            </form>
          </div>
        </dialog>
      </Show>
    </div>
  )
}
