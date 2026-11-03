import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProviderRegistry } from '../src/backend/providers/registry'
import { OrchbotDatabase } from '../src/backend/storage/db'

describe('Conexões & Provedores (Codex, Claude, Grok, Muse)', () => {
  let tmpDir: string
  let dbPath: string
  let db: OrchbotDatabase

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-connections-test-'))
    dbPath = path.join(tmpDir, 'test.db')
    db = new OrchbotDatabase(dbPath)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('deve inicializar com as 4 conexões padrão (Codex, Claude, Grok, Muse)', () => {
    const connections = db.listConnections()
    expect(connections.length).toBe(4)

    const ids = connections.map((c) => c.providerId)
    expect(ids).toContain('codex')
    expect(ids).toContain('claude')
    expect(ids).toContain('grok')
    expect(ids).toContain('muse')

    const codex = connections.find((c) => c.providerId === 'codex')
    expect(codex?.enabled).toBe(true)
    expect(codex?.defaultModel).toBe('gpt-6.1-sol')
    expect(codex?.models).toContain('gpt-6.1-sol')
    expect(codex?.models).toContain('o1')

    const claude = connections.find((c) => c.providerId === 'claude')
    expect(claude?.enabled).toBe(true)
    expect(claude?.defaultModel).toBe('claude-sonnet-5-5')
    expect(claude?.models).toContain('claude-sonnet-5-5')

    const grok = connections.find((c) => c.providerId === 'grok')
    expect(grok?.enabled).toBe(true)
    expect(grok?.defaultModel).toBe('grok-3')
    expect(grok?.models).toContain('grok-3')

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
    expect(updated.apiKey).toBe('xai-test-key-12345')
    expect(updated.endpoint).toBe('https://custom.xai.endpoint/v1')
    expect(updated.defaultModel).toBe('grok-beta')

    const retrieved = db.getConnection('grok')
    expect(retrieved?.enabled).toBe(false)
    expect(retrieved?.apiKey).toBe('xai-test-key-12345')
    expect(retrieved?.endpoint).toBe('https://custom.xai.endpoint/v1')
    expect(retrieved?.defaultModel).toBe('grok-beta')
  })

  it('deve verificar disponibilidade no ProviderRegistry para os 4 provedores', async () => {
    const registry = new ProviderRegistry()
    const statuses = await registry.checkAllAvailability()

    expect(statuses.codex).toBeDefined()
    expect(statuses.claude).toBeDefined()
    expect(statuses.grok).toBeDefined()
    expect(statuses.muse).toBeDefined()

    expect(typeof statuses.codex.available).toBe('boolean')
    expect(typeof statuses.claude.available).toBe('boolean')
    expect(typeof statuses.grok.available).toBe('boolean')
    expect(typeof statuses.muse.available).toBe('boolean')
  })

  it('deve permitir reativar conexão previamente desativada', () => {
    db.updateConnection({ providerId: 'codex', enabled: false })
    expect(db.getConnection('codex')?.enabled).toBe(false)

    db.updateConnection({ providerId: 'codex', enabled: true })
    expect(db.getConnection('codex')?.enabled).toBe(true)
  })
})
