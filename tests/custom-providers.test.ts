import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { isCustomProvider, normalizeProviderEndpoint } from '../src/shared/custom-providers'
import { validateCreateAgentInput } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

const input = {
  name: 'Local model',
  endpoint: 'http://localhost:11434/v1/',
  defaultModel: 'local-model',
}
describe('Custom provider persistence and validation', () => {
  let db: OrchbotDatabase
  let dir: string
  let file: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-custom-'))
    file = path.join(dir, 'test.db')
    db = new OrchbotDatabase(file, testSecretStorage)
  })
  afterEach(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('creates independent providers and persists keys securely across restarts', () => {
    const first = db.createCustomProvider({ ...input, apiKey: 'private-custom-secret' })
    const second = db.createCustomProvider({ ...input, name: 'Other provider' })
    expect(isCustomProvider(first.providerId)).toBe(true)
    expect(first.providerId).not.toBe(second.providerId)
    expect(first).toMatchObject({
      name: input.name,
      endpoint: 'http://localhost:11434/v1',
      enabled: true,
      hasApiKey: true,
      models: [input.defaultModel],
    })
    expect(first).not.toHaveProperty('apiKey')
    expect(JSON.stringify(db.listConnections())).not.toContain('private-custom-secret')
    db.close()
    expect(fs.readFileSync(file).includes(Buffer.from('private-custom-secret'))).toBe(false)
    db = new OrchbotDatabase(file, testSecretStorage)
    expect(db.getConnectionApiKey(first.providerId)).toBe('private-custom-secret')
    expect(db.listConnections()).toHaveLength(13)
  })

  it('preserves keys while editing and protects them when changing the host', () => {
    const provider = db.createCustomProvider({ ...input, apiKey: 'original' })
    db.updateConnection({
      providerId: provider.providerId,
      name: 'Renamed',
      defaultModel: 'model-2',
      endpoint: 'http://localhost:11434/api/v1',
    })
    expect(db.getConnectionApiKey(provider.providerId)).toBe('original')
    expect(db.getConnection(provider.providerId)).toMatchObject({
      name: 'Renamed',
      models: ['model-2'],
    })
    expect(() =>
      db.updateConnection({
        providerId: provider.providerId,
        endpoint: 'https://another.example/v1',
      }),
    ).toThrow('nova chave')
    expect(db.getConnection(provider.providerId)?.endpoint).toBe('http://localhost:11434/api/v1')
    db.updateConnection({
      providerId: provider.providerId,
      endpoint: 'https://another.example/v1',
      apiKey: '',
    })
    expect(db.getConnectionApiKey(provider.providerId)).toBeUndefined()
  })

  it('accepts registered custom providers for robots and blocks removal while in use', () => {
    const provider = db.createCustomProvider(input)
    const robot = {
      name: 'CustomBot',
      provider: provider.providerId,
      model: input.defaultModel,
      workspacePath: dir,
    }
    expect(() => validateCreateAgentInput(robot)).toThrow('Provedor inválido')
    const agent = db.createAgent(
      validateCreateAgentInput(
        robot,
        db.listConnections().map((c) => c.providerId),
      ),
    )
    expect(() => db.deleteCustomProvider(provider.providerId)).toThrow('está em uso')
    db.updateAgent({ id: agent.id, provider: 'codex' })
    expect(db.deleteCustomProvider(provider.providerId)).toBe(true)
    expect(db.getConnection(provider.providerId)).toBeNull()
    expect(db.listThreads(agent.id)).toHaveLength(1)
    expect(() => db.updateAgent({ id: agent.id, provider: provider.providerId })).toThrow(
      'não cadastrado',
    )
    expect(() => db.createAgent(robot)).toThrow('não cadastrado')
    expect(() => db.deleteCustomProvider('codex')).toThrow('Somente')
  })

  it.each([
    'file:///tmp/key',
    'ftp://example.com',
    'https://user:pass@example.com',
    'https://example.com?key=secret',
    'https://example.com#secret',
    'not a url',
  ])('rejects unsafe/ambiguous base URL %s', (endpoint) => {
    expect(() => db.createCustomProvider({ ...input, endpoint })).toThrow()
  })

  it('validates required fields and API key headers before storing anything', () => {
    expect(() => db.createCustomProvider({ ...input, name: ' ' })).toThrow('nome')
    expect(() => db.createCustomProvider({ ...input, defaultModel: '' })).toThrow('modelo')
    expect(() => db.createCustomProvider({ ...input, apiKey: 'key\r\nheader' })).toThrow('Chave')
    expect(db.listConnections()).toHaveLength(11)
    expect(normalizeProviderEndpoint(' https://example.com/api/v1/// ')).toBe(
      'https://example.com/api/v1',
    )
  })

  it('supports keyless local APIs without an OS keychain and refuses plaintext key storage', () => {
    db.close()
    db = new OrchbotDatabase(file)
    expect(db.createCustomProvider(input).hasApiKey).toBe(false)
    expect(() => db.createCustomProvider({ ...input, apiKey: 'secret' })).toThrow(
      'Cofre seguro indisponível',
    )
    expect(db.listConnections()).toHaveLength(12)
  })
})
