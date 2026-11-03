import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountStatus, resolveAccountRuntime } from '../src/backend/providers/account-config'
import { buildProviderEnv } from '../src/backend/providers/cli-utils'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

const nativeId = '11111111-1111-4111-8111-111111111111'
describe('Multiple provider accounts', () => {
  let dir: string
  let file: string
  let db: OrchbotDatabase
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-accounts-'))
    file = path.join(dir, 'test.db')
    db = new OrchbotDatabase(file, testSecretStorage)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    if (db.isOpen()) db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const keyAccount = (providerId: 'codex' | 'claude' = 'codex', key = 'account-private-key') =>
    db.createProviderAccount({ providerId, label: 'Work', authMode: 'api_key', apiKey: key })

  it('preserves legacy connections, keys and session mappings during schema upgrade', () => {
    db.updateConnection({ providerId: 'codex', apiKey: 'legacy-private-key' })
    const agent = db.createAgent({
      name: 'Existing',
      provider: 'codex',
      model: 'test',
      workspacePath: dir,
    })
    const thread = db.listThreads(agent.id)[0]
    db.saveProviderSession(thread.id, 'codex', 'scope', nativeId)
    db.close()
    const old = new DatabaseSync(file)
    old.exec(
      'DROP TABLE provider_accounts; ALTER TABLE provider_connections DROP COLUMN default_account_enabled; ALTER TABLE agents DROP COLUMN account_id;',
    )
    old.close()
    db = new OrchbotDatabase(file, testSecretStorage)
    expect(db.listProviderAccounts('codex')).toMatchObject([
      {
        id: 'codex',
        label: 'Padrão',
        authMode: 'inherit',
        isDefault: true,
        enabled: true,
        hasApiKey: true,
      },
    ])
    expect(db.getConnectionApiKey('codex')).toBe('legacy-private-key')
    expect(db.getProviderSession(thread.id, 'codex', 'scope')).toBe(nativeId)
    expect(db.getAgent(agent.id)?.accountId).toBeUndefined()
  })

  it('persists independent encrypted keys and never returns them to the renderer', () => {
    const first = keyAccount()
    const second = keyAccount('codex', 'second-private-key')
    expect(first.id).not.toBe(second.id)
    expect(JSON.stringify(db.listProviderAccounts('codex'))).not.toContain('account-private-key')
    expect(first).not.toHaveProperty('apiKey')
    expect(db.getProviderAccountApiKey('codex', first.id)).toBe('account-private-key')
    db.close()
    expect(fs.readFileSync(file).includes(Buffer.from('account-private-key'))).toBe(false)
    db = new OrchbotDatabase(file, testSecretStorage)
    expect(db.getProviderAccountApiKey('codex', second.id)).toBe('second-private-key')
    expect(() => db.getProviderAccountApiKey('claude', first.id)).toThrow('não pertence')
  })

  it('keeps the key when editing metadata, replaces it, and disables the account when it is removed', () => {
    const account = keyAccount()
    db.updateProviderAccount({ providerId: 'codex', id: account.id, label: 'Renamed' })
    expect(db.getProviderAccountApiKey('codex', account.id)).toBe('account-private-key')
    db.updateProviderAccount({ providerId: 'codex', id: account.id, apiKey: 'new-private-key' })
    expect(db.getProviderAccountApiKey('codex', account.id)).toBe('new-private-key')
    const cleared = db.updateProviderAccount({ providerId: 'codex', id: account.id, apiKey: '' })
    expect(cleared).toMatchObject({ enabled: false, hasApiKey: false })
    expect(() => resolveAccountRuntime(db, 'codex', account.id)).toThrow('desativada')
    const stillDisabled = db.updateProviderAccount({
      providerId: 'codex',
      id: account.id,
      enabled: true,
    })
    expect(stillDisabled.enabled).toBe(false)
    expect(() => resolveAccountRuntime(db, 'codex', account.id)).toThrow('desativada')
  })

  it('keeps the default account switch independent of the whole provider', () => {
    const second = keyAccount()
    expect(resolveAccountRuntime(db, 'codex').account.id).toBe('codex')
    db.updateProviderAccount({ providerId: 'codex', id: 'codex', enabled: false })
    expect(db.getConnection('codex')?.enabled).toBe(true)
    expect(resolveAccountRuntime(db, 'codex').account.id).toBe(second.id)
    expect(() => resolveAccountRuntime(db, 'codex', 'codex')).toThrow('desativada')
    db.updateConnection({ providerId: 'codex', enabled: false })
    expect(() => resolveAccountRuntime(db, 'codex', second.id)).toThrow('provedor está desativado')
  })

  it('validates account ownership and prevents deleting selected or automatic accounts', () => {
    const account = keyAccount()
    const agent = db.createAgent({
      name: 'AccountBot',
      provider: 'codex',
      accountId: account.id,
      model: 'test',
      workspacePath: dir,
    })
    expect(db.getAgent(agent.id)?.accountId).toBe(account.id)
    expect(db.listAgents()[0].accountId).toBe(account.id)
    expect(db.getAgentByThreadId(db.listThreads(agent.id)[0].id)?.accountId).toBe(account.id)
    expect(() =>
      db.createAgent({
        name: 'Wrong',
        provider: 'claude',
        accountId: account.id,
        model: 'test',
        workspacePath: dir,
      }),
    ).toThrow('não pertence')
    expect(() =>
      db.updateAgent({ id: agent.id, provider: 'claude', accountId: account.id }),
    ).toThrow('não pertence')
    expect(() => db.deleteProviderAccount('codex', account.id)).toThrow('em uso')
    db.updateAgent({ id: agent.id, accountId: null })
    db.updateProviderAccount({ providerId: 'codex', id: 'codex', enabled: false })
    expect(() => db.deleteProviderAccount('codex', account.id)).toThrow('em uso')
    db.updateProviderAccount({ providerId: 'codex', id: 'codex', enabled: true })
    expect(db.deleteProviderAccount('codex', account.id)).toBe(true)
    expect(() => db.deleteProviderAccount('codex', 'codex')).toThrow('Padrão')
  })

  it('invalidates native sessions when the selected account changes or the provider changes', () => {
    const account = keyAccount()
    const agent = db.createAgent({
      name: 'SessionBot',
      provider: 'codex',
      model: 'test',
      workspacePath: dir,
    })
    const thread = db.listThreads(agent.id)[0]
    db.saveProviderSession(thread.id, 'codex', 'scope', nativeId)
    db.updateAgent({ id: agent.id, accountId: account.id })
    expect(db.getProviderSession(thread.id, 'codex', 'scope')).toBeUndefined()
    db.updateAgent({ id: agent.id, provider: 'claude' })
    expect(db.getAgent(agent.id)?.accountId).toBeUndefined()
  })

  it.each(['codex', 'claude'] as const)(
    'isolates %s API accounts from ambient credentials, endpoints and profiles',
    (providerId) => {
      vi.stubEnv('CODEX_API_KEY', 'ambient-key')
      vi.stubEnv('OPENAI_API_KEY', 'ambient-key')
      vi.stubEnv('ANTHROPIC_API_KEY', 'ambient-key')
      vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'ambient-oauth')
      vi.stubEnv('CODEX_SQLITE_HOME', '/ambient-state')
      vi.stubEnv('ANTHROPIC_BASE_URL', 'https://ambient.example')
      const account = keyAccount(providerId)
      const runtime = resolveAccountRuntime(db, providerId, account.id)
      const env = buildProviderEnv(runtime.config)
      const variable = providerId === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'
      expect(env[variable]).toBe(runtime.config.cliProfile?.directory)
      expect(fs.statSync(env[variable] as string).isDirectory()).toBe(true)
      if (providerId === 'codex') {
        expect(env.CODEX_API_KEY).toBe('account-private-key')
        expect(env.OPENAI_API_KEY).toBe('account-private-key')
        expect(env.CODEX_SQLITE_HOME).toBe(env.CODEX_HOME)
      } else {
        expect(env.ANTHROPIC_API_KEY).toBe('account-private-key')
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
      }
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
      expect(env.HOME).toBe(process.env.HOME)
    },
  )

  it.each(['codex', 'claude'] as const)(
    'uses a separate %s login directory without inheriting ambient tokens',
    (providerId) => {
      vi.stubEnv('CODEX_API_KEY', 'ambient-key')
      vi.stubEnv('OPENAI_API_KEY', 'ambient-key')
      vi.stubEnv('ANTHROPIC_API_KEY', 'ambient-key')
      vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'ambient-oauth')
      const profile = path.join(dir, "profile with 'quote")
      const account = db.createProviderAccount({
        providerId,
        label: 'OAuth work',
        authMode: 'cli_profile',
        profilePath: profile,
      })
      const { config } = resolveAccountRuntime(db, providerId, account.id)
      const env = buildProviderEnv(config)
      for (const key of providerId === 'codex'
        ? ['CODEX_API_KEY', 'OPENAI_API_KEY']
        : ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'])
        expect(env[key]).toBeUndefined()
      expect(
        accountStatus({ available: true, readiness: 'login_required' }, providerId, config)
          .loginHint,
      ).toContain("'\\''")
      expect(() =>
        db.createProviderAccount({
          providerId,
          label: 'Duplicate',
          authMode: 'cli_profile',
          profilePath: profile,
        }),
      ).toThrow('já está cadastrado')
    },
  )

  it('rejects empty keys, relative/unsupported profiles and foreign IDs', () => {
    expect(() =>
      db.createProviderAccount({
        providerId: 'codex',
        label: ' ',
        authMode: 'api_key',
        apiKey: 'secret',
      }),
    ).toThrow('nome')
    expect(() =>
      db.createProviderAccount({ providerId: 'codex', label: 'No key', authMode: 'api_key' }),
    ).toThrow('chave')
    expect(() =>
      db.createProviderAccount({
        providerId: 'codex',
        label: 'Bad key',
        authMode: 'api_key',
        apiKey: 'bad\nkey',
      }),
    ).toThrow('chave')
    expect(() =>
      db.createProviderAccount({
        providerId: 'codex',
        label: 'Relative',
        authMode: 'cli_profile',
        profilePath: 'relative',
      }),
    ).toThrow('absoluto')
    expect(() =>
      db.createProviderAccount({
        providerId: 'grok',
        label: 'Unsupported',
        authMode: 'cli_profile',
        profilePath: dir,
      }),
    ).toThrow('Codex e Claude')
    expect(() =>
      db.updateAgent({
        id: db.createAgent({ name: 'Empty', provider: 'codex', model: 'test', workspacePath: dir })
          .id,
        accountId: '',
      }),
    ).toThrow('não pertence')
    expect(() =>
      db.updateProviderAccount({ providerId: 'claude', id: keyAccount().id, label: 'wrong' }),
    ).toThrow('não encontrada')
  })

  it('refuses key storage when the keychain is unavailable without changing existing accounts', () => {
    const account = keyAccount()
    db.close()
    db = new OrchbotDatabase(file)
    expect(db.getProviderAccount('codex', account.id)?.keyStorageError).toContain('Cofre seguro')
    expect(() =>
      db.createProviderAccount({
        providerId: 'codex',
        label: 'New',
        authMode: 'api_key',
        apiKey: 'secret',
      }),
    ).toThrow('Cofre seguro')
    expect(() => resolveAccountRuntime(db, 'codex', account.id)).toThrow('Cofre seguro')
    db.updateProviderAccount({ providerId: 'codex', id: account.id, label: 'Still exists' })
    db.close()
    db = new OrchbotDatabase(file, testSecretStorage)
    expect(db.getProviderAccountApiKey('codex', account.id)).toBe('account-private-key')
  })
})
