import { For, Show, createEffect, createSignal, onMount } from 'solid-js'
import type {
  Agent,
  McpPreset,
  McpServerInfo,
  SkillCatalogEntry,
  SkillInfo,
} from '../../shared/types'

const clean = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  )
const SOURCE: Record<string, string> = {
  user: 'sua',
  agent: '🤖 criada por agente',
  bundled: 'catálogo',
  installed: 'pasta',
}

export function SkillsPlugins(props: { agents: Agent[] }) {
  const [tab, setTab] = createSignal<'skills' | 'catalog' | 'mcp'>('skills')
  const [agentId, setAgentId] = createSignal('')
  const [error, setError] = createSignal('')
  const [info, setInfo] = createSignal('')

  const [skills, setSkills] = createSignal<SkillInfo[]>([])
  const [catalog, setCatalog] = createSignal<SkillCatalogEntry[]>([])
  const [active, setActive] = createSignal<string[]>([])
  const [editing, setEditing] = createSignal<{
    slug?: string
    name: string
    description: string
    body: string
  } | null>(null)

  const [servers, setServers] = createSignal<McpServerInfo[]>([])
  const [presets, setPresets] = createSignal<McpPreset[]>([])
  const [mcpActive, setMcpActive] = createSignal<string[]>([])
  const [form, setForm] = createSignal<{
    id?: string
    name: string
    transport: 'stdio' | 'http'
    command: string
    args: string
    url: string
    env: string
    bearer: string
    clearBearer: boolean
    hadBearer: boolean
    note: string
  } | null>(null)

  const agent = () => props.agents.find((a) => a.id === agentId())
  const mcpSupported = () => ['claude', 'codex', 'acp'].includes(agent()?.provider ?? '')

  const guard = async (action: () => Promise<unknown>, ok = '') => {
    setError('')
    setInfo('')
    try {
      await action()
      if (ok) setInfo(ok)
    } catch (e) {
      setError(clean(e))
    }
  }
  const loadAll = async () => {
    setSkills(await window.orchbot.listSkills())
    setCatalog(await window.orchbot.getSkillCatalog())
    setServers(await window.orchbot.listMcpServers())
  }
  const loadAgentState = async () => {
    const id = agentId()
    setActive(id ? await window.orchbot.getAgentSkills(id) : [])
    setMcpActive(id ? await window.orchbot.getAgentMcp(id) : [])
  }
  onMount(async () => {
    setAgentId(props.agents[0]?.id ?? '')
    setPresets(await window.orchbot.getMcpPresets())
    await loadAll()
  })
  createEffect(() => {
    agentId()
    void loadAgentState()
  })

  const toggle = (list: string[], key: string, on: boolean) =>
    on ? [...new Set([...list, key])] : list.filter((k) => k !== key)
  const toggleSkill = (slug: string, on: boolean) =>
    guard(async () =>
      setActive(await window.orchbot.setAgentSkills(agentId(), toggle(active(), slug, on))),
    )
  const toggleMcp = (id: string, on: boolean) =>
    guard(async () =>
      setMcpActive(await window.orchbot.setAgentMcp(agentId(), toggle(mcpActive(), id, on))),
    )

  const editSkill = (slug: string) =>
    guard(async () => {
      const s = await window.orchbot.getSkill(slug)
      setEditing({ slug, name: s.name, description: s.description, body: s.body })
    })
  const saveSkill = () =>
    guard(async () => {
      const e = editing()
      if (!e) return
      await window.orchbot.saveSkill(e)
      setEditing(null)
      await loadAll()
    }, 'Skill salva.')

  const parseEnv = (text: string) =>
    Object.fromEntries(
      text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const i = l.indexOf('=')
          return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1)]
        }),
    )
  const newForm = (p?: McpPreset) =>
    setForm({
      name: p?.name ?? '',
      transport: p?.transport ?? 'stdio',
      command: p?.command ?? '',
      args: (p?.args ?? []).join('\n'),
      url: p?.url ?? '',
      env: (p?.envKeys ?? []).map((k) => `${k}=`).join('\n'),
      bearer: '',
      clearBearer: false,
      hadBearer: false,
      note: p?.note ?? '',
    })
  const editServer = (s: McpServerInfo) =>
    setForm({
      id: s.id,
      name: s.name,
      transport: s.transport,
      command: s.command ?? '',
      args: s.args.join('\n'),
      url: s.url ?? '',
      env: s.envKeys.map((k) => `${k}=`).join('\n'),
      bearer: '',
      clearBearer: false,
      hadBearer: s.hasBearer,
      note: '',
    })
  const saveServer = () =>
    guard(async () => {
      const f = form()
      if (!f) return
      await window.orchbot.saveMcpServer({
        id: f.id,
        name: f.name,
        transport: f.transport,
        command: f.command,
        args: f.args
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean),
        url: f.url,
        env: parseEnv(f.env),
        bearerToken: f.clearBearer ? null : f.bearer ? f.bearer : undefined,
      })
      setForm(null)
      await loadAll()
    }, 'Servidor salvo.')

  const field = <K extends 'name' | 'description' | 'body'>(k: K, v: string) =>
    setEditing((e) => (e ? { ...e, [k]: v } : e))
  const mf = (patch: Partial<NonNullable<ReturnType<typeof form>>>) =>
    setForm((f) => (f ? { ...f, ...patch } : f))

  return (
    <div class="skills-view">
      <header class="skills-head">
        <div>
          <h2>Skills e plugins</h2>
          <p>
            Procedimentos reutilizáveis e servidores MCP, guardados e executados no seu computador.
          </p>
        </div>
        <label class="skills-agent">
          Ativar para o agente
          <select value={agentId()} onChange={(e) => setAgentId(e.currentTarget.value)}>
            <For each={props.agents}>
              {(a) => (
                <option value={a.id}>
                  {a.avatar ?? '🤖'} {a.name}
                </option>
              )}
            </For>
          </select>
        </label>
      </header>
      <nav class="skills-tabs">
        <button
          type="button"
          classList={{ active: tab() === 'skills' }}
          onClick={() => setTab('skills')}
        >
          🧩 Biblioteca ({skills().length})
        </button>
        <button
          type="button"
          classList={{ active: tab() === 'catalog' }}
          onClick={() => setTab('catalog')}
        >
          📚 Catálogo
        </button>
        <button type="button" classList={{ active: tab() === 'mcp' }} onClick={() => setTab('mcp')}>
          🔌 Servidores MCP ({servers().length})
        </button>
      </nav>
      <Show when={error()}>
        <div class="channel-error">{error()}</div>
      </Show>
      <Show when={info()}>
        <div class="skills-info">{info()}</div>
      </Show>

      <div class="skills-body">
        <Show when={tab() === 'skills'}>
          <div class="skills-actions">
            <button
              type="button"
              class="btn-primary"
              onClick={() => setEditing({ name: '', description: '', body: '' })}
            >
              + Nova skill
            </button>
            <button
              type="button"
              class="btn-outline"
              onClick={() =>
                guard(async () => {
                  const s = await window.orchbot.installSkillFolder()
                  if (s) await loadAll()
                }, 'Skill instalada da pasta.')
              }
            >
              📁 Instalar de uma pasta
            </button>
          </div>
          <Show
            when={skills().length > 0}
            fallback={
              <p class="channels-empty">
                Nenhuma skill ainda. Crie uma, instale do catálogo ou deixe um agente criar com
                [[SKILL:create]].
              </p>
            }
          >
            <For each={skills()}>
              {(s) => (
                <div class="skill-row">
                  <label
                    class="skill-toggle"
                    title={agentId() ? 'Ativa neste agente' : 'Crie um agente primeiro'}
                  >
                    <input
                      type="checkbox"
                      disabled={!agentId()}
                      checked={active().includes(s.slug)}
                      onChange={(e) => toggleSkill(s.slug, e.currentTarget.checked)}
                    />
                  </label>
                  <div class="skill-main">
                    <strong>{s.name}</strong> <code>{s.slug}</code>
                    <span class="skill-badge">
                      v{s.version} · {SOURCE[s.source]}
                      {s.createdBy ? ` (${s.createdBy})` : ''}
                    </span>
                    <p>{s.description}</p>
                  </div>
                  <button type="button" class="btn-outline" onClick={() => editSkill(s.slug)}>
                    Editar
                  </button>
                  <button
                    type="button"
                    class="btn-outline"
                    onClick={() =>
                      confirm(`Remover a skill "${s.name}"?`) &&
                      guard(async () => {
                        await window.orchbot.removeSkill(s.slug)
                        await loadAll()
                        await loadAgentState()
                      })
                    }
                  >
                    🗑️
                  </button>
                </div>
              )}
            </For>
          </Show>
        </Show>

        <Show when={tab() === 'catalog'}>
          <p class="skills-note">Skills que acompanham o app: instalam offline, sem baixar nada.</p>
          <For each={catalog()} fallback={<p class="channels-empty">Catálogo vazio.</p>}>
            {(c) => (
              <div class="skill-row">
                <div class="skill-main">
                  <strong>{c.name}</strong>
                  <p>{c.description}</p>
                </div>
                <button
                  type="button"
                  class="btn-primary"
                  disabled={c.installed}
                  onClick={() =>
                    guard(async () => {
                      await window.orchbot.installBundledSkill(c.slug)
                      await loadAll()
                    }, 'Skill instalada.')
                  }
                >
                  {c.installed ? 'Instalada' : 'Instalar'}
                </button>
              </div>
            )}
          </For>
        </Show>

        <Show when={tab() === 'mcp'}>
          <Show when={agent() && !mcpSupported()}>
            <div class="skills-warn">
              ⚠️ MCP por agente funciona com Claude, Codex e agentes ACP. {agent()?.name} usa{' '}
              {agent()?.provider}: as escolhas ficam salvas, mas não serão aplicadas.
            </div>
          </Show>
          <p class="skills-note">
            Servidores MCP rodam como programas no seu computador, com as suas permissões. Adicione
            só os que você confia. Tokens ficam no cofre do sistema e vão ao CLI por variável de
            ambiente.
          </p>
          <div class="skills-actions">
            <button type="button" class="btn-primary" onClick={() => newForm()}>
              + Novo servidor
            </button>
            <For each={presets()}>
              {(p) => (
                <button
                  type="button"
                  class="btn-outline"
                  title={p.description}
                  onClick={() => newForm(p)}
                >
                  {p.name}
                </button>
              )}
            </For>
          </div>
          <For
            each={servers()}
            fallback={<p class="channels-empty">Nenhum servidor MCP configurado.</p>}
          >
            {(s) => (
              <div class="skill-row">
                <label class="skill-toggle">
                  <input
                    type="checkbox"
                    disabled={!agentId()}
                    checked={mcpActive().includes(s.id)}
                    onChange={(e) => toggleMcp(s.id, e.currentTarget.checked)}
                  />
                </label>
                <div class="skill-main">
                  <strong>{s.name}</strong> <span class="skill-badge">{s.transport}</span>
                  <p>
                    <code>
                      {s.transport === 'http' ? s.url : `${s.command} ${s.args.join(' ')}`}
                    </code>
                  </p>
                  <Show when={s.envKeys.length || s.hasBearer}>
                    <p class="skills-note">
                      🔒 {[...s.envKeys, ...(s.hasBearer ? ['bearer token'] : [])].join(', ')}
                    </p>
                  </Show>
                </div>
                <button type="button" class="btn-outline" onClick={() => editServer(s)}>
                  Editar
                </button>
                <button
                  type="button"
                  class="btn-outline"
                  onClick={() =>
                    confirm(`Remover o servidor "${s.name}"?`) &&
                    guard(async () => {
                      await window.orchbot.removeMcpServer(s.id)
                      await loadAll()
                      await loadAgentState()
                    })
                  }
                >
                  🗑️
                </button>
              </div>
            )}
          </For>
        </Show>
      </div>

      <Show when={editing()}>
        {(e) => (
          <dialog
            class="modal-overlay"
            open
            onClick={() => setEditing(null)}
            onKeyDown={(ev) => ev.key === 'Escape' && setEditing(null)}
          >
            <div
              class="modal-content"
              role="document"
              style={{ width: '680px', 'max-height': '88vh' }}
              onClick={(ev) => ev.stopPropagation()}
              onKeyDown={(ev) => ev.stopPropagation()}
            >
              <div class="modal-header">
                <span class="modal-title">{e().slug ? `Editar ${e().slug}` : 'Nova skill'}</span>
                <button type="button" class="modal-close" onClick={() => setEditing(null)}>
                  ✕
                </button>
              </div>
              <div class="modal-form" style={{ 'overflow-y': 'auto' }}>
                <div class="form-group">
                  <label for="sk-name">Nome</label>
                  <input
                    id="sk-name"
                    type="text"
                    value={e().name}
                    onInput={(ev) => field('name', ev.currentTarget.value)}
                  />
                </div>
                <div class="form-group">
                  <label for="sk-desc">Quando usar (uma linha)</label>
                  <input
                    id="sk-desc"
                    type="text"
                    value={e().description}
                    onInput={(ev) => field('description', ev.currentTarget.value)}
                  />
                </div>
                <div class="form-group">
                  <label for="sk-body">Instruções (markdown)</label>
                  <textarea
                    id="sk-body"
                    rows={14}
                    value={e().body}
                    onInput={(ev) => field('body', ev.currentTarget.value)}
                  />
                </div>
                <Show when={e().slug}>
                  <div class="skills-note">
                    Salvar cria uma nova versão; a anterior fica em .history da pasta da skill.
                  </div>
                </Show>
                <button
                  type="button"
                  class="btn-primary"
                  disabled={!e().name.trim() || !e().description.trim() || !e().body.trim()}
                  onClick={saveSkill}
                >
                  Salvar
                </button>
              </div>
            </div>
          </dialog>
        )}
      </Show>

      <Show when={form()}>
        {(f) => (
          <dialog
            class="modal-overlay"
            open
            onClick={() => setForm(null)}
            onKeyDown={(ev) => ev.key === 'Escape' && setForm(null)}
          >
            <div
              class="modal-content"
              role="document"
              style={{ width: '600px', 'max-height': '88vh' }}
              onClick={(ev) => ev.stopPropagation()}
              onKeyDown={(ev) => ev.stopPropagation()}
            >
              <div class="modal-header">
                <span class="modal-title">
                  {f().id ? 'Editar servidor MCP' : 'Novo servidor MCP'}
                </span>
                <button type="button" class="modal-close" onClick={() => setForm(null)}>
                  ✕
                </button>
              </div>
              <div class="modal-form" style={{ 'overflow-y': 'auto' }}>
                <Show when={f().note}>
                  <div class="skills-note">ℹ️ {f().note}</div>
                </Show>
                <div class="form-group">
                  <label for="mcp-name">Nome</label>
                  <input
                    id="mcp-name"
                    type="text"
                    value={f().name}
                    onInput={(ev) => mf({ name: ev.currentTarget.value })}
                  />
                </div>
                <div class="form-group">
                  <label for="mcp-tr">Transporte</label>
                  <select
                    id="mcp-tr"
                    value={f().transport}
                    onChange={(ev) => mf({ transport: ev.currentTarget.value as 'stdio' | 'http' })}
                  >
                    <option value="stdio">Programa local (stdio)</option>
                    <option value="http">Servidor HTTP</option>
                  </select>
                </div>
                <Show
                  when={f().transport === 'stdio'}
                  fallback={
                    <>
                      <div class="form-group">
                        <label for="mcp-url">URL</label>
                        <input
                          id="mcp-url"
                          type="text"
                          placeholder="https://…/mcp"
                          value={f().url}
                          onInput={(ev) => mf({ url: ev.currentTarget.value })}
                        />
                      </div>
                      <div class="form-group">
                        <label for="mcp-bearer">
                          Bearer token{' '}
                          {f().hadBearer ? '(salvo; deixe vazio para manter)' : '(opcional)'}
                        </label>
                        <input
                          id="mcp-bearer"
                          type="password"
                          autocomplete="off"
                          value={f().bearer}
                          onInput={(ev) => mf({ bearer: ev.currentTarget.value })}
                        />
                        <Show when={f().hadBearer}>
                          <label class="channels-toggle">
                            <input
                              type="checkbox"
                              checked={f().clearBearer}
                              onChange={(ev) => mf({ clearBearer: ev.currentTarget.checked })}
                            />{' '}
                            Remover token salvo
                          </label>
                        </Show>
                      </div>
                    </>
                  }
                >
                  <div class="form-group">
                    <label for="mcp-cmd">Comando</label>
                    <input
                      id="mcp-cmd"
                      type="text"
                      placeholder="npx"
                      value={f().command}
                      onInput={(ev) => mf({ command: ev.currentTarget.value })}
                    />
                  </div>
                  <div class="form-group">
                    <label for="mcp-args">Argumentos (um por linha)</label>
                    <textarea
                      id="mcp-args"
                      rows={4}
                      value={f().args}
                      onInput={(ev) => mf({ args: ev.currentTarget.value })}
                    />
                  </div>
                  <div class="form-group">
                    <label for="mcp-env">Variáveis de ambiente (CHAVE=valor, uma por linha)</label>
                    <textarea
                      id="mcp-env"
                      rows={3}
                      placeholder="GITHUB_TOKEN=…"
                      value={f().env}
                      onInput={(ev) => mf({ env: ev.currentTarget.value })}
                    />
                    <Show when={f().id}>
                      <div class="skills-note">
                        Linha "CHAVE=" sem valor mantém o segredo salvo; remover a linha apaga a
                        variável.
                      </div>
                    </Show>
                  </div>
                </Show>
                <button
                  type="button"
                  class="btn-primary"
                  disabled={!f().name.trim()}
                  onClick={saveServer}
                >
                  Salvar
                </button>
              </div>
            </div>
          </dialog>
        )}
      </Show>
    </div>
  )
}
