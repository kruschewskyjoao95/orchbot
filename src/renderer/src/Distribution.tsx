import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type {
  AppSettings,
  AppUpdateStatus,
  LocalRuntime,
  ManagedCliInfo,
  SupportedProvider,
  ThemeFileInfo,
} from '../../shared/types'
import { focusDialog } from './dialog-focus'

const clean = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  )

/** Aplica o tema de arquivo escolhido e reaplica quando o arquivo muda (ao vivo). */
export function ThemeApplier(props: { customTheme: string; effectiveTheme: 'dark' | 'light' }) {
  const [themes, setThemes] = createSignal<ThemeFileInfo[]>([])
  let applied: string[] = []
  onMount(async () => {
    setThemes(await window.orchbot.listThemes())
    const off = window.orchbot.onThemesChanged(setThemes)
    onCleanup(off)
  })
  createEffect(() => {
    const root = document.documentElement
    for (const k of applied) root.style.removeProperty(k)
    applied = []
    const theme = themes().find((t) => t.id === props.customTheme)
    root.dataset.theme = theme ? theme.mode : props.effectiveTheme
    if (!theme) return
    for (const [k, v] of Object.entries(theme.vars)) {
      root.style.setProperty(k, v)
      applied.push(k)
    }
  })
  return null
}

const CONSENT_ITEMS = [
  'Os agentes rodam com as suas permissões: podem ler e gravar arquivos nos workspaces, executar comandos e, se você ativar, usar o navegador com seus logins e o computador.',
  'Servidores MCP e skills são programas e instruções que você adiciona; instale só o que você confia.',
  'Suas conversas, memórias e arquivos ficam neste computador (banco local). O texto dos turnos é enviado aos provedores de IA que você escolher, sob os termos deles.',
  'O Orchbot guarda chaves no cofre do sistema e nunca as inclui em diagnósticos. Verificações de versão consultam o npm e, se você ligar, o feed de atualização.',
]

export function ConsentGate() {
  const [needed, setNeeded] = createSignal(false)
  const [checked, setChecked] = createSignal(false)
  onMount(async () => setNeeded(!(await window.orchbot.getConsent()).accepted))
  return (
    <Show when={needed()}>
      <dialog
        ref={focusDialog}
        aria-modal="true"
        aria-labelledby="consent-title"
        class="modal-overlay consent-overlay"
        open
      >
        <div class="modal-content" role="document" style={{ width: '600px' }}>
          <div class="modal-header">
            <span class="modal-title" id="consent-title">
              Antes de começar
            </span>
          </div>
          <div class="modal-form" style={{ 'overflow-y': 'auto' }}>
            <p class="consent-lead">
              O Orchbot coloca agentes de IA para trabalhar no seu computador. Leia com atenção:
            </p>
            <ul class="consent-list">
              <For each={CONSENT_ITEMS}>{(t) => <li>{t}</li>}</For>
            </ul>
            <label class="channels-toggle">
              <input
                type="checkbox"
                checked={checked()}
                onChange={(e) => setChecked(e.currentTarget.checked)}
              />{' '}
              Entendi e aceito esses riscos.
            </label>
            <div style={{ display: 'flex', gap: '8px', 'justify-content': 'flex-end' }}>
              <button
                type="button"
                class="btn-outline"
                onClick={() => window.orchbot.declineConsent()}
              >
                Sair
              </button>
              <button
                type="button"
                class="btn-primary"
                disabled={!checked()}
                onClick={async () => {
                  await window.orchbot.acceptConsent()
                  setNeeded(false)
                }}
              >
                Aceitar e continuar
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </Show>
  )
}

/** Banner no topo de Conexões quando há Ollama/LM Studio rodando na máquina. */
export function LocalRuntimes(props: { onAdded: () => void }) {
  const [runtimes, setRuntimes] = createSignal<LocalRuntime[]>([])
  const [busy, setBusy] = createSignal('')
  const [error, setError] = createSignal('')
  onMount(async () => setRuntimes(await window.orchbot.detectLocalRuntimes()))
  const add = async (r: LocalRuntime) => {
    setBusy(r.id)
    setError('')
    try {
      await window.orchbot.addLocalRuntime(r.id, r.models[0] ?? '')
      setRuntimes(await window.orchbot.detectLocalRuntimes())
      props.onAdded()
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy('')
    }
  }
  return (
    <Show when={runtimes().some((r) => !r.configured) || error()}>
      <div class="updates-banner">
        <span>
          🖥️ Rodando neste computador:{' '}
          {runtimes()
            .filter((r) => !r.configured)
            .map((r) => `${r.name} (${r.models.length} modelo${r.models.length === 1 ? '' : 's'})`)
            .join(' · ')}
          {error() && ` — ${error()}`}
        </span>
        <For each={runtimes().filter((r) => !r.configured)}>
          {(r) => (
            <button
              type="button"
              class="btn-primary"
              disabled={busy() === r.id || r.models.length === 0}
              onClick={() => add(r)}
            >
              {busy() === r.id ? 'Adicionando…' : `Adicionar ${r.name}`}
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}

/** Instalar o CLI pelo app, fixar a versão e remover. */
export function ManagedCliControls(props: { providerId: SupportedProvider; onChange: () => void }) {
  const [info, setInfo] = createSignal<ManagedCliInfo | null>(null)
  const [version, setVersion] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const load = async () =>
    setInfo(
      (await window.orchbot.getManagedClis()).find((c) => c.providerId === props.providerId) ??
        null,
    )
  onMount(load)
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
      props.onChange()
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Show when={info()?.npmPackage}>
      <div class="provider-config-meta managed-cli">
        <strong>CLI gerenciado pelo Orchbot</strong>
        <Show
          when={info()?.installed}
          fallback={
            <div class="managed-row">
              <input
                type="text"
                placeholder="versão (vazio = mais recente)"
                value={version()}
                onInput={(e) => setVersion(e.currentTarget.value.trim())}
              />
              <button
                type="button"
                class="btn-outline"
                disabled={busy()}
                onClick={() =>
                  act(() =>
                    window.orchbot.installManagedCli(
                      props.providerId,
                      version() || undefined,
                      !!version(),
                    ),
                  )
                }
              >
                {busy() ? 'Instalando…' : 'Instalar pelo app'}
              </button>
            </div>
          }
        >
          <div class="managed-row">
            <span>
              v{info()?.version} {info()?.pinned ? '📌 versão fixada' : '(acompanha atualizações)'}
            </span>
            <button
              type="button"
              class="btn-outline"
              disabled={busy()}
              onClick={() =>
                act(() => window.orchbot.setManagedCliPin(props.providerId, !info()?.pinned))
              }
            >
              {info()?.pinned ? 'Soltar versão' : 'Fixar versão'}
            </button>
            <button
              type="button"
              class="btn-outline"
              disabled={busy()}
              onClick={() =>
                confirm('Remover o CLI instalado pelo app?') &&
                act(() => window.orchbot.removeManagedCli(props.providerId))
              }
            >
              Remover
            </button>
          </div>
        </Show>
        <div class="skills-note">
          Instala em uma pasta do app, sem sudo e sem mexer no npm global. Requer Node.js/npm.
        </div>
        <Show when={error()}>
          <div class="channel-error">{error()}</div>
        </Show>
      </div>
    </Show>
  )
}

export function DistributionSettings(props: {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => void
  Switch: (p: { pressed: boolean; label: string; onChange: () => void }) => unknown
}) {
  const [themes, setThemes] = createSignal<ThemeFileInfo[]>([])
  const [status, setStatus] = createSignal<AppUpdateStatus | null>(null)
  const [feed, setFeed] = createSignal(props.settings.updateFeedUrl)
  const [diag, setDiag] = createSignal('')
  const [error, setError] = createSignal('')
  onMount(async () => {
    setThemes(await window.orchbot.listThemes())
    setStatus((await window.orchbot.getAppUpdate()) ?? null)
    const offThemes = window.orchbot.onThemesChanged(setThemes)
    const offUpdate = window.orchbot.onAppUpdate(setStatus)
    onCleanup(() => {
      offThemes()
      offUpdate()
    })
  })
  const Sw = props.Switch as (p: { pressed: boolean; label: string; onChange: () => void }) => never
  return (
    <>
      <section class="settings-section">
        <h2>Temas</h2>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">Tema personalizado</div>
            <div class="settings-row-desc">
              Arquivos JSON na pasta de temas (e os temas do Omarchy) são aplicados e recarregados
              ao vivo ao salvar.
            </div>
          </div>
          <select
            class="settings-select"
            value={props.settings.customTheme}
            onChange={(e) => props.update({ customTheme: e.currentTarget.value })}
          >
            <option value="">Padrão do Orchbot</option>
            <For each={themes()}>{(t) => <option value={t.id}>{t.name}</option>}</For>
          </select>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">Pasta de temas</div>
            <div class="settings-row-desc">
              Formato:{' '}
              {
                '{ "name", "mode", "colors": {background, foreground, accent…}, "vars": {"--bg-main": "#…"} }'
              }
              . Há um exemplo na pasta.
            </div>
          </div>
          <button
            type="button"
            class="btn-outline"
            onClick={() => window.orchbot.openThemesFolder()}
          >
            Abrir pasta
          </button>
        </div>
      </section>

      <section class="settings-section">
        <h2>Atualizações e diagnóstico</h2>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">Atualizar o Orchbot automaticamente</div>
            <div class="settings-row-desc">
              Funciona no app instalado (AppImage, exe, dmg), com um feed HTTPS que você controla.
            </div>
          </div>
          <Sw
            pressed={props.settings.autoUpdate}
            label="Atualizar o Orchbot automaticamente"
            onChange={() => props.update({ autoUpdate: !props.settings.autoUpdate })}
          />
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">Endereço do feed</div>
            <div class="settings-row-desc">{status()?.message ?? '—'}</div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              class="settings-select"
              style={{ width: '260px' }}
              placeholder="https://exemplo.com/orchbot"
              value={feed()}
              onInput={(e) => setFeed(e.currentTarget.value)}
              onChange={() => props.update({ updateFeedUrl: feed().trim() })}
            />
            <button
              type="button"
              class="btn-outline"
              onClick={async () => {
                await props.update({ updateFeedUrl: feed().trim() })
                setStatus((await window.orchbot.checkAppUpdate()) ?? null)
              }}
            >
              Verificar
            </button>
            <Show when={status()?.state === 'available' || status()?.state === 'ready'}>
              <button
                type="button"
                class="btn-primary"
                onClick={() => window.orchbot.installAppUpdate()}
              >
                {status()?.state === 'ready' ? 'Reiniciar e instalar' : 'Baixar'}
              </button>
            </Show>
          </div>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">Exportar diagnóstico</div>
            <div class="settings-row-desc">
              Versões, estados e erros recentes para suporte. Sem mensagens, instruções, chaves,
              variáveis de MCP ou endereços.
              <Show when={diag()}>
                {' '}
                Salvo em <code>{diag()}</code>.
              </Show>
              <Show when={error()}> {error()}</Show>
            </div>
          </div>
          <button
            type="button"
            class="btn-outline"
            onClick={async () => {
              setError('')
              try {
                setDiag((await window.orchbot.exportDiagnostics()) ?? '')
              } catch (e) {
                setError(clean(e))
              }
            }}
          >
            Exportar…
          </button>
        </div>
      </section>
    </>
  )
}
