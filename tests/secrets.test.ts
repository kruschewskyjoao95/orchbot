import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { ENCRYPTED_KEY_PREFIX, KEY_STORAGE_ERROR } from '../src/backend/storage/secrets'
import { testSecretStorage } from './secret-storage-fixture'

describe('API key storage', () => {
  let dir: string
  let file: string
  let db: OrchbotDatabase
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-secrets-'))
    file = path.join(dir, 'test.db')
    db = new OrchbotDatabase(file, testSecretStorage)
  })
  afterEach(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const secret = 'secret-key-never-return-to-renderer'

  it('encrypts at rest, returns only metadata, and preserves/replaces/removes keys', () => {
    const updated = db.updateConnection({ providerId: 'grok', apiKey: secret })
    expect(updated.hasApiKey).toBe(true)
    expect(updated).not.toHaveProperty('apiKey')
    expect(JSON.stringify(db.listConnections())).not.toContain(secret)
    expect(db.getConnectionApiKey('grok')).toBe(secret)
    db.updateConnection({ providerId: 'grok', defaultModel: 'another' })
    expect(db.getConnectionApiKey('grok')).toBe(secret)
    db.close()
    expect(fs.readFileSync(file).includes(Buffer.from(secret))).toBe(false)
    db = new OrchbotDatabase(file, testSecretStorage)
    expect(db.getConnectionApiKey('grok')).toBe(secret)
    db.updateConnection({ providerId: 'grok', apiKey: 'replacement' })
    expect(db.getConnectionApiKey('grok')).toBe('replacement')
    db.updateConnection({ providerId: 'grok', apiKey: '' })
    expect(db.getConnectionApiKey('grok')).toBeUndefined()
    expect(db.getConnection('grok')?.hasApiKey).toBe(false)
  })

  it('migrates existing plaintext and clears database/WAL remnants', () => {
    db.close()
    const legacy = new DatabaseSync(file)
    legacy
      .prepare('UPDATE provider_connections SET api_key = ? WHERE provider_id = ?')
      .run(secret, 'grok')
    legacy.close()
    db = new OrchbotDatabase(file, testSecretStorage)
    expect(db.getConnectionApiKey('grok')).toBe(secret)
    for (const name of fs.readdirSync(dir)) {
      expect(fs.readFileSync(path.join(dir, name)).includes(Buffer.from(secret))).toBe(false)
    }
    db.close()
    db = new OrchbotDatabase(file, testSecretStorage)
    expect(db.getConnectionApiKey('grok')).toBe(secret)
  })

  it.each(['basic_text', 'unavailable'])(
    'refuses insecure %s without overwriting existing keys',
    (backend) => {
      db.updateConnection({ providerId: 'grok', apiKey: secret })
      db.close()
      db = new OrchbotDatabase(file, {
        ...testSecretStorage,
        isEncryptionAvailable: () => backend !== 'unavailable',
        getSelectedStorageBackend: () => backend,
      })
      expect(db.getConnection('grok')?.keyStorageError).toBe(KEY_STORAGE_ERROR)
      expect(() => db.getConnectionApiKey('grok')).toThrow(KEY_STORAGE_ERROR)
      expect(() => db.updateConnection({ providerId: 'grok', apiKey: 'new-key' })).toThrow(
        KEY_STORAGE_ERROR,
      )
      db.updateConnection({ providerId: 'grok', enabled: false })
      db.close()
      db = new OrchbotDatabase(file, testSecretStorage)
      expect(db.getConnectionApiKey('grok')).toBe(secret)
    },
  )

  it('preserves legacy keys while the keychain is unavailable and migrates on recovery', () => {
    db.close()
    const legacy = new DatabaseSync(file)
    legacy
      .prepare('UPDATE provider_connections SET api_key = ? WHERE provider_id = ?')
      .run(secret, 'grok')
    legacy.close()
    db = new OrchbotDatabase(file)
    expect(db.getConnection('grok')?.keyStorageError).toBe(KEY_STORAGE_ERROR)
    expect(JSON.stringify(db.listConnections())).not.toContain(secret)
    expect(() => db.getConnectionApiKey('grok')).toThrow(KEY_STORAGE_ERROR)
    db.close()
    db = new OrchbotDatabase(file, testSecretStorage)
    expect(db.getConnectionApiKey('grok')).toBe(secret)
    expect(fs.readFileSync(file).includes(Buffer.from(secret))).toBe(false)
  })

  it('reports unreadable ciphertext without exposing the stored value', () => {
    db.close()
    const raw = new DatabaseSync(file)
    raw
      .prepare('UPDATE provider_connections SET api_key = ? WHERE provider_id = ?')
      .run(`${ENCRYPTED_KEY_PREFIX}corrupt`, 'grok')
    raw.close()
    db = new OrchbotDatabase(file, testSecretStorage)
    expect(db.getConnection('grok')?.hasApiKey).toBe(true)
    expect(db.getConnection('grok')?.keyStorageError).toContain('Cadastre a chave novamente')
    expect(() => db.getConnectionApiKey('grok')).toThrow('Cadastre a chave novamente')
  })

  it('rolls back migration if the OS keychain fails', () => {
    db.close()
    const raw = new DatabaseSync(file)
    raw
      .prepare('UPDATE provider_connections SET api_key = ? WHERE provider_id IN (?, ?)')
      .run(secret, 'grok', 'codex')
    raw.close()
    let calls = 0
    expect(
      () =>
        new OrchbotDatabase(file, {
          ...testSecretStorage,
          encryptString(value) {
            if (++calls === 2) throw new Error('keychain denied')
            return testSecretStorage.encryptString(value)
          },
        }),
    ).toThrow('Não foi possível proteger')
    const check = new DatabaseSync(file)
    const rows = check
      .prepare('SELECT api_key FROM provider_connections WHERE api_key IS NOT NULL')
      .all()
    expect(rows).toEqual([{ api_key: secret }, { api_key: secret }])
    check.close()
    db = new OrchbotDatabase(file, testSecretStorage)
    expect(db.getConnectionApiKey('grok')).toBe(secret)
  })
})
