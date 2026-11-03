import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type { Agent, Channel, ChannelMessage } from '../../shared/types'

export function Channels(props: { agents: Agent[] }) {
  const [channels, setChannels] = createSignal<Channel[]>([])
  const [showArchived, setShowArchived] = createSignal(false)
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [messages, setMessages] = createSignal<ChannelMessage[]>([])
  const [text, setText] = createSignal('')
  const [error, setError] = createSignal('')
  const [creating, setCreating] = createSignal(false)
  const [title, setTitle] = createSignal('')
  const [goal, setGoal] = createSignal('')
  const [owner, setOwner] = createSignal('')
  const [members, setMembers] = createSignal<string[]>([])
  let logEl: HTMLDivElement | undefined

  const selected = () => channels().find((c) => c.id === selectedId()) ?? null
  const agentOf = (id: string | null) => props.agents.find((a) => a.id === id)
  const label = (a?: Agent) => (a ? `${a.avatar ?? '🤖'} ${a.name}` : 'Agente removido')

  const refresh = async () => {
    const list = await window.orchbot.listChannels(showArchived())
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
    showArchived()
    selectedId()
    void refresh()
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
      })
      setCreating(false)
      setTitle('')
      setGoal('')
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
      <aside class="channels-list">
        <div class="channels-list-head">
          <h2>Canais</h2>
          <button
            type="button"
            class="btn-primary"
            disabled={props.agents.length === 0}
            onClick={() => {
              setOwner(props.agents[0]?.id ?? '')
              setCreating(true)
            }}
          >
            + Novo
          </button>
        </div>
        <label class="channels-toggle">
          <input
            type="checkbox"
            checked={showArchived()}
            onChange={(e) => setShowArchived(e.currentTarget.checked)}
          />{' '}
          Mostrar arquivados
        </label>
        <Show
          when={channels().length > 0}
          fallback={
            <p class="channels-empty">
              Nenhum canal ainda. Crie um para vários agentes trabalharem numa tarefa com um dono.
            </p>
          }
        >
          <For each={channels()}>
            {(c) => (
              <button
                type="button"
                class="channel-item"
                classList={{ active: c.id === selectedId(), muted: c.archived }}
                onClick={() => setSelectedId(c.id)}
              >
                <span class="channel-item-title"># {c.title}</span>
                <span class="channel-item-meta">
                  {c.archived ? '🗄️ arquivado' : c.status === 'stopped' ? '⏹️ parado' : '🟢 ativo'} ·{' '}
                  {agentOf(c.ownerAgentId)?.name ?? 'sem dono'}
                </span>
              </button>
            )}
          </For>
        </Show>
      </aside>

      <section class="channel-main">
        <Show when={error()}>
          <div class="channel-error">{error()}</div>
        </Show>
        <Show
          when={selected()}
          fallback={<div class="channels-empty">Selecione ou crie um canal.</div>}
        >
          {(channel) => (
            <>
              <header class="channel-head">
                <div>
                  <h2># {channel().title}</h2>
                  <Show when={channel().goal}>
                    <p class="channel-goal">{channel().goal}</p>
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
                      <span class="channel-msg-text">{m.text}</span>
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
                      ? 'Canal arquivado'
                      : channel().status === 'stopped'
                        ? 'Canal parado: retome para continuar'
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
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div class="modal-header">
              <span class="modal-title">Novo canal</span>
              <button type="button" class="modal-close" onClick={() => setCreating(false)}>
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
                Criar canal
              </button>
            </form>
          </div>
        </dialog>
      </Show>
    </div>
  )
}
