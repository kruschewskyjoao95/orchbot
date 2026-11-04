import { For, Show, createSignal, onMount } from 'solid-js'
import { providerStatusLabel } from '../../shared/provider-status'
import type { ProviderAccount, ProviderConnection } from '../../shared/types'
import { focusDialog } from './dialog-focus'

export function ProviderAccounts(props: {
  connection: ProviderConnection
  onClose: () => void
  onChange: () => Promise<void>
}) {
  const [accounts, setAccounts] = createSignal<ProviderAccount[]>([])
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [editing, setEditing] = createSignal<ProviderAccount | null>(null)
  const [label, setLabel] = createSignal('')
  const [mode, setMode] = createSignal<'api_key' | 'cli_profile'>('api_key')
  const [key, setKey] = createSignal('')
  const [profile, setProfile] = createSignal('')
  const [clearKey, setClearKey] = createSignal(false)
  const [testMessages, setTestMessages] = createSignal<Record<string, string>>({})
  const supportsProfile = () =>
    props.connection.providerId === 'codex' || props.connection.providerId === 'claude'
  const load = async () =>
    setAccounts(await window.orchbot.getProviderAccounts(props.connection.providerId))
  const resetForm = () => {
    setEditing(null)
    setLabel('')
    setKey('')
    setProfile('')
    setClearKey(false)
    setMode('api_key')
  }
  const change = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      await props.onChange()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    } finally {
      setBusy(false)
    }
  }
  const save = async (event: SubmitEvent) => {
    event.preventDefault()
    await change(async () => {
      const current = editing()
      if (current)
        await window.orchbot.updateProviderAccount({
          providerId: props.connection.providerId,
          id: current.id,
          label: label(),
          apiKey: mode() === 'api_key' ? (clearKey() ? '' : key() || undefined) : undefined,
          profilePath: mode() === 'cli_profile' ? profile() : undefined,
        })
      else
        await window.orchbot.createProviderAccount({
          providerId: props.connection.providerId,
          label: label(),
          authMode: mode(),
          apiKey: mode() === 'api_key' ? key() : undefined,
          profilePath: mode() === 'cli_profile' ? profile() : undefined,
        })
      resetForm()
    })
  }
  const test = async (account: ProviderAccount) => {
    setBusy(true)
    setError('')
    try {
      const result = await window.orchbot.testProviderAccount(
        props.connection.providerId,
        account.id,
      )
      setTestMessages((previous) => ({ ...previous, [account.id]: result.message }))
      if (result.status)
        setAccounts((previous) =>
          previous.map((item) => (item.id === account.id ? { ...item, ...result.status } : item)),
        )
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : String(problem))
    } finally {
      setBusy(false)
    }
  }
  onMount(() => {
    void load().catch((problem) => setError(String(problem)))
  })
  return (
    <dialog
      ref={focusDialog}
      aria-modal="true"
      class="modal-overlay"
      open
      aria-labelledby="accounts-title"
      onClick={() => !busy() && props.onClose()}
      onKeyDown={(event) => event.key === 'Escape' && !busy() && props.onClose()}
    >
      <div
        class="modal-content"
        role="document"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape' && !busy()) props.onClose()
        }}
      >
        <div class="modal-header">
          <h2 id="accounts-title">Contas — {props.connection.name}</h2>
          <button
            type="button"
            class="modal-close"
            aria-label="Fechar contas"
            disabled={busy()}
            onClick={props.onClose}
          >
            ✕
          </button>
        </div>
        <div class="modal-form">
          <p>
            A conta escolhida no robô tem prioridade. Em erro de cota, outras contas habilitadas
            deste provedor são tentadas antes de mudar de provedor.
          </p>
          <For each={accounts()}>
            {(account) => (
              <section
                style={{
                  border: '1px solid var(--border)',
                  padding: '12px',
                  'border-radius': '8px',
                  'margin-bottom': '12px',
                }}
              >
                <strong>{account.label}</strong> •{' '}
                {account.authMode === 'inherit'
                  ? 'Login/chave da conexão atual'
                  : account.authMode === 'api_key'
                    ? 'API key própria'
                    : 'Perfil CLI separado'}
                <Show when={account.readiness}>
                  <div>{providerStatusLabel(account)}</div>
                </Show>
                <Show when={account.profilePath}>
                  <div style={{ 'overflow-wrap': 'anywhere' }}>
                    <code>{account.profilePath}</code>
                  </div>
                </Show>
                <Show when={account.loginHint}>
                  <div style={{ 'overflow-wrap': 'anywhere' }}>
                    Para entrar neste perfil: <code>{account.loginHint}</code>
                  </div>
                </Show>
                <Show when={account.hasApiKey && account.keyStorageError}>
                  <div class="connection-result-msg error">{account.keyStorageError}</div>
                </Show>
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    'align-items': 'center',
                    'margin-top': '8px',
                    'flex-wrap': 'wrap',
                  }}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={account.enabled}
                      disabled={busy()}
                      onChange={(event) => {
                        const enabled = event.currentTarget.checked
                        void change(() =>
                          window.orchbot.updateProviderAccount({
                            providerId: props.connection.providerId,
                            id: account.id,
                            enabled,
                          }),
                        )
                      }}
                    />{' '}
                    Habilitada
                  </label>
                  <button
                    type="button"
                    class="btn-outline"
                    disabled={busy()}
                    onClick={() => test(account)}
                  >
                    Testar conta
                  </button>
                  <Show when={!account.isDefault}>
                    <button
                      type="button"
                      class="btn-outline"
                      disabled={busy()}
                      onClick={() => {
                        setEditing(account)
                        setLabel(account.label)
                        setMode(account.authMode === 'cli_profile' ? 'cli_profile' : 'api_key')
                        setKey('')
                        setClearKey(false)
                        setProfile(account.profilePath ?? '')
                      }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      class="btn-outline"
                      disabled={busy()}
                      onClick={() => {
                        if (
                          confirm(
                            `Remover a conta "${account.label}" e sua chave salva? Arquivos e logins do CLI permanecem no disco.`,
                          )
                        )
                          void change(async () => {
                            await window.orchbot.deleteProviderAccount(
                              props.connection.providerId,
                              account.id,
                            )
                            if (editing()?.id === account.id) resetForm()
                          })
                      }}
                    >
                      Remover
                    </button>
                  </Show>
                </div>
                <Show when={account.isDefault}>
                  <small>As credenciais de Padrão são editadas na configuração do provedor.</small>
                </Show>
                <Show when={testMessages()[account.id]}>
                  <output>{testMessages()[account.id]}</output>
                </Show>
              </section>
            )}
          </For>
          <form onSubmit={save}>
            <h3>{editing() ? 'Editar conta' : 'Adicionar conta'}</h3>
            <div class="form-group">
              <label for="account-label">Nome da conta</label>
              <input
                id="account-label"
                required
                maxLength={100}
                value={label()}
                disabled={busy()}
                onInput={(event) => setLabel(event.currentTarget.value)}
                placeholder="Ex.: Trabalho, Pessoal"
              />
            </div>
            <div class="form-group">
              <label for="account-mode">Autenticação</label>
              <select
                id="account-mode"
                value={mode()}
                disabled={busy() || Boolean(editing())}
                onChange={(event) => {
                  setMode(event.currentTarget.value as 'api_key' | 'cli_profile')
                  setKey('')
                  setClearKey(false)
                  setProfile('')
                }}
              >
                <option value="api_key">API key própria</option>
                <Show when={supportsProfile()}>
                  <option value="cli_profile">Login em perfil CLI separado</option>
                </Show>
              </select>
            </div>
            <Show
              when={mode() === 'api_key'}
              fallback={
                <div class="form-group">
                  <label for="account-profile">Diretório absoluto do perfil CLI</label>
                  <input
                    id="account-profile"
                    required
                    value={profile()}
                    disabled={busy()}
                    placeholder="/caminho/para/perfil-separado"
                    onInput={(event) => setProfile(event.currentTarget.value)}
                  />
                  <small>
                    Use um diretório diferente para cada conta. Após salvar, faça login com o
                    comando mostrado no perfil.
                  </small>
                </div>
              }
            >
              <div class="form-group">
                <label for="account-key">API key</label>
                <input
                  id="account-key"
                  type="password"
                  autocomplete="new-password"
                  required={!editing()}
                  value={key()}
                  disabled={busy()}
                  placeholder={
                    editing()?.hasApiKey
                      ? 'Chave salva; deixe vazio para preservar'
                      : 'Chave desta conta'
                  }
                  onInput={(event) => {
                    setKey(event.currentTarget.value)
                    setClearKey(false)
                  }}
                />
                <Show when={editing()?.hasApiKey}>
                  <button
                    type="button"
                    disabled={busy()}
                    onClick={() => {
                      setClearKey(true)
                      setKey('')
                    }}
                  >
                    Remover chave ao salvar
                  </button>
                </Show>
                <Show when={clearKey()}>
                  <output>A chave será removida e esta conta será desativada.</output>
                </Show>
              </div>
            </Show>
            <Show when={error()}>
              <div class="connection-result-msg error" role="alert">
                {error()}
              </div>
            </Show>
            <div class="modal-actions">
              <Show when={editing()}>
                <button type="button" class="btn-secondary" disabled={busy()} onClick={resetForm}>
                  Cancelar edição
                </button>
              </Show>
              <button type="submit" class="btn-primary" disabled={busy()}>
                {busy() ? 'Aguarde...' : editing() ? 'Salvar conta' : 'Adicionar conta'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </dialog>
  )
}
