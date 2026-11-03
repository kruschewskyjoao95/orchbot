import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProviderRegistry } from '../src/backend/providers/registry'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

describe('Conexões & Provedores (Codex, Claude, Grok, Gemini, Muse, Antigravity, OpenCode, Copilot, Pi, Kimi)', () => {
  let tmpDir: string
  let dbPath: string
  let db: OrchbotDatabase

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-connections-test-'))
    dbPath = path.join(tmpDir, 'test.db')
    db = new OrchbotDatabase(dbPath, testSecretStorage)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('deve inicializar com as 11 conexões padrão', () => {
    const connections = db.listConnections()
    expect(connections.length).toBe(11)

    const ids = connections.map((c) => c.providerId)
    expect(ids).toContain('codex')
    expect(ids).toContain('claude')
    expect(ids).toContain('grok')
    expect(ids).toContain('gemini')
    expect(ids).toContain('muse')
    expect(ids).toContain('antigravity')
    expect(ids).toContain('opencode')
    expect(ids).toContain('copilot')
    expect(ids).toContain('pi')
    expect(ids).toContain('kimi')
    expect(ids).toContain('acp')
    expect(connections.find((c) => c.providerId === 'acp')?.enabled).toBe(false)

    const antigravity = connections.find((c) => c.providerId === 'antigravity')
    expect(antigravity?.name).toBe('Antigravity (Google)')
    expect(antigravity?.defaultModel).toBe('gemini-3.8-flash')
    expect(antigravity?.models).toContain('gemini-4-argon')
    // Antigravity fala ACP com o agy_acp_server; `antigravity` (IDE) e `agy` (CLI) não são o servidor.
    expect(antigravity?.cliCommand).toBe('agy_acp_server')
    expect(antigravity?.supportsEffort).toBe(true)

    const opencode = connections.find((c) => c.providerId === 'opencode')
    expect(opencode?.cliCommand).toBe('opencode')

    const copilot = connections.find((c) => c.providerId === 'copilot')
    expect(copilot?.defaultModel).toBe('auto')

    const codex = connections.find((c) => c.providerId === 'codex')
    expect(codex?.enabled).toBe(true)
    expect(codex?.defaultModel).toBe('gpt-6.1-sol')
    expect(codex?.models).toContain('gpt-6-astra')
    expect(codex?.models).toContain('gpt-6.1-sol')
    expect(codex?.models).toContain('gpt-6.1-terra')

    const claude = connections.find((c) => c.providerId === 'claude')
    expect(claude?.enabled).toBe(true)
    expect(claude?.defaultModel).toBe('claude-sonnet-5-5')
    expect(claude?.models).toContain('claude-sonnet-5-5')
    expect(claude?.models).toContain('claude-opus-5-5')

    const grok = connections.find((c) => c.providerId === 'grok')
    expect(grok?.enabled).toBe(true)
    expect(grok?.defaultModel).toBe('grok-4.7')
    expect(grok?.models).toContain('grok-4.7')

    const gemini = connections.find((c) => c.providerId === 'gemini')
    expect(gemini?.enabled).toBe(true)
    expect(gemini?.name).toBe('Google Gemini')
    expect(gemini?.defaultModel).toBe('gemini-3.8-flash')
    expect(gemini?.models).toContain('gemini-3.8-flash')

    const muse = connections.find((c) => c.providerId === 'muse')
    expect(muse?.enabled).toBe(true)
    expect(muse?.name).toBe('Muse Code')
    expect(muse?.defaultModel).toBe('muse-spark-1.3')
    expect(muse?.models).toContain('muse-spark-1.3')
  })

  it('deve atualizar o estado de ativação e parâmetros de uma conexão', () => {
    const updated = db.updateConnection({
      providerId: 'grok',
      enabled: false,
      apiKey: 'xai-test-key-12345',
      endpoint: 'https://custom.xai.endpoint/v1',
      defaultModel: 'grok-beta',
    })

    expect(updated.providerId).toBe('grok')
    expect(updated.enabled).toBe(false)
    expect(updated.hasApiKey).toBe(true)
    expect(updated).not.toHaveProperty('apiKey')
    expect(updated.endpoint).toBe('https://custom.xai.endpoint/v1')
    expect(updated.defaultModel).toBe('grok-beta')

    const retrieved = db.getConnection('grok')
    expect(retrieved?.enabled).toBe(false)
    expect(retrieved?.hasApiKey).toBe(true)
    expect(db.getConnectionApiKey('grok')).toBe('xai-test-key-12345')
    expect(retrieved?.endpoint).toBe('https://custom.xai.endpoint/v1')
    expect(retrieved?.defaultModel).toBe('grok-beta')
  })

  it('persiste configuração ACP, preserva campos e valida argumentos e variável da chave', () => {
    db.updateConnection({
      providerId: 'acp',
      cliPath: '/opt/agent',
      cliArgs: ['--acp', 'with spaces'],
      apiKeyEnv: 'AGENT_KEY',
    })
    db.updateConnection({ providerId: 'acp', enabled: true })
    db.close()
    db = new OrchbotDatabase(dbPath, testSecretStorage)
    expect(db.getConnection('acp')).toMatchObject({
      enabled: true,
      cliPath: '/opt/agent',
      cliArgs: ['--acp', 'with spaces'],
      apiKeyEnv: 'AGENT_KEY',
    })
    expect(() =>
      db.updateConnection({ providerId: 'acp', cliArgs: 'shell string' as unknown as string[] }),
    ).toThrow('lista JSON')
    expect(() => db.updateConnection({ providerId: 'acp', cliArgs: ['bad\0arg'] })).toThrow(
      'lista JSON',
    )
    expect(() => db.updateConnection({ providerId: 'acp', apiKeyEnv: 'INVALID-NAME' })).toThrow(
      'variável de ambiente inválido',
    )
    const cleared = db.updateConnection({ providerId: 'acp', cliArgs: [], apiKeyEnv: '' })
    expect(cleared.cliArgs).toEqual([])
    expect(cleared.apiKeyEnv).toBeUndefined()
  })

  it('deve verificar disponibilidade no ProviderRegistry para todos os provedores', async () => {
    const registry = new ProviderRegistry()
    const statuses = await registry.checkAllAvailability()

    for (const id of [
      'codex',
      'claude',
      'grok',
      'gemini',
      'muse',
      'antigravity',
      'opencode',
      'copilot',
      'pi',
      'kimi',
      'acp',
    ] as const) {
      expect(statuses[id]).toBeDefined()
      expect(typeof statuses[id].available).toBe('boolean')
      expect(statuses[id].installHint).toBeDefined()
    }
  }, 20000)

  it('deve persistir cliPath e effort da configuração do provedor', () => {
    const updated = db.updateConnection({
      providerId: 'antigravity',
      cliPath: '/opt/antigravity/bin/antigravity',
      effort: 'high',
    })
    expect(updated.cliPath).toBe('/opt/antigravity/bin/antigravity')
    expect(updated.effort).toBe('high')

    const retrieved = db.getConnection('antigravity')
    expect(retrieved?.cliPath).toBe('/opt/antigravity/bin/antigravity')
    expect(retrieved?.effort).toBe('high')

    const cleared = db.updateConnection({ providerId: 'antigravity', cliPath: '' })
    expect(cleared.cliPath).toBeUndefined()
    expect(cleared.effort).toBe('high')
  })

  it('deve permitir reativar conexão previamente desativada', () => {
    db.updateConnection({ providerId: 'codex', enabled: false })
    expect(db.getConnection('codex')?.enabled).toBe(false)

    db.updateConnection({ providerId: 'codex', enabled: true })
    expect(db.getConnection('codex')?.enabled).toBe(true)
  })
})
