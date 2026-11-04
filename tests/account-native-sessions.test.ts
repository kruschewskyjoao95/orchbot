import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderRegistry } from '../src/backend/providers/registry'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

const cli = fileURLToPath(new URL('./fixtures/account-session-cli.mjs', import.meta.url))
describe.each(['codex', 'claude'] as const)('%s account session ownership', (provider) => {
  let dir: string
  let db: OrchbotDatabase
  let registry: ProviderRegistry
  let queue: QueueManager
  const calls = (): Array<{ owner: string; id: string; resume?: string; profile: string }> =>
    fs
      .readFileSync(path.join(dir, 'account-cli-calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-account-native-'))
    db = new OrchbotDatabase(path.join(dir, 'test.db'), testSecretStorage)
    for (const connection of db.listConnections())
      db.updateConnection({
        providerId: connection.providerId,
        enabled: connection.providerId === provider,
        ...(connection.providerId === provider ? { cliPath: cli } : {}),
      })
    vi.stubEnv('CODEX_API_KEY', 'ambient-key')
    vi.stubEnv('ANTHROPIC_API_KEY', 'ambient-key')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'ambient-oauth')
    registry = new ProviderRegistry()
    queue = new QueueManager(db, registry)
  })
  afterEach(() => {
    queue.close()
    registry.interruptAll()
    db.close()
    vi.unstubAllEnvs()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  async function run(agentId: string, threadId: string, prompt: string) {
    const task = queue.enqueue(agentId, threadId, prompt)
    // Cada turno sobe um CLI falso; com a suíte inteira em paralelo passa de 1 s.
    await vi.waitFor(() => expect(db.getTask(task.id)?.status).toBe('completed'), {
      timeout: 5000,
    })
  }

  it('starts a new account-owned session on quota fallback and resumes that account afterwards', async () => {
    const first = db.createProviderAccount({
      providerId: provider,
      label: 'A',
      authMode: 'api_key',
      apiKey: 'quota-on-second-A',
    })
    db.createProviderAccount({
      providerId: provider,
      label: 'B',
      authMode: 'api_key',
      apiKey: 'healthy-B',
    })
    db.updateProviderAccount({ providerId: provider, id: provider, enabled: false })
    const agent = db.createAgent({
      name: 'Bot',
      provider,
      accountId: first.id,
      model: 'kept-model',
      workspacePath: dir,
      browserAccess: false,
    })
    const thread = db.listThreads(agent.id)[0]
    await run(agent.id, thread.id, 'First turn on A')
    await run(agent.id, thread.id, 'Quota on A; continue on B')
    await run(agent.id, thread.id, 'Stay on B')
    const log = calls()
    expect(log.map((entry) => entry.owner)).toEqual(['A', 'A', 'B', 'B'])
    expect(log[1].resume).toBe(log[0].id)
    expect(log[2].resume).toBeUndefined()
    expect(log[2].profile).not.toBe(log[0].profile)
    expect(log[3].resume).toBe(log[2].id)
    expect(db.listMessages(thread.id).at(-1)?.text).toBe('B turn 2')
    expect(db.getAgent(agent.id)?.model).toBe('kept-model')
  })

  it('does not resume a session belonging to another explicit CLI profile', async () => {
    const first = db.createProviderAccount({
      providerId: provider,
      label: 'Profile A',
      authMode: 'cli_profile',
      profilePath: path.join(dir, 'profile-A'),
    })
    const second = db.createProviderAccount({
      providerId: provider,
      label: 'Profile B',
      authMode: 'cli_profile',
      profilePath: path.join(dir, 'profile-B'),
    })
    const agent = db.createAgent({
      name: 'Bot',
      provider,
      accountId: first.id,
      model: 'test',
      workspacePath: dir,
    })
    const thread = db.listThreads(agent.id)[0]
    await run(agent.id, thread.id, 'Profile A task')
    db.updateAgent({ id: agent.id, accountId: second.id })
    await run(agent.id, thread.id, 'Profile B task')
    db.updateAgent({ id: agent.id, accountId: first.id })
    await run(agent.id, thread.id, 'Back to profile A with fresh context')
    expect(calls().map((entry) => entry.owner)).toEqual(['profile-A', 'profile-B', 'profile-A'])
    expect(calls().every((entry) => entry.resume === undefined)).toBe(true)
  })

  it('keeps the selected account and its session after restarting the application', async () => {
    const account = db.createProviderAccount({
      providerId: provider,
      label: 'B',
      authMode: 'api_key',
      apiKey: 'healthy-B',
    })
    const agent = db.createAgent({
      name: 'Bot',
      provider,
      accountId: account.id,
      model: 'test',
      workspacePath: dir,
    })
    const thread = db.listThreads(agent.id)[0]
    await run(agent.id, thread.id, 'Before restart')
    const original = calls()[0]
    queue.close()
    db.close()
    db = new OrchbotDatabase(path.join(dir, 'test.db'), testSecretStorage)
    registry = new ProviderRegistry()
    queue = new QueueManager(db, registry)
    await run(agent.id, thread.id, 'After restart')
    expect(db.getAgent(agent.id)?.accountId).toBe(account.id)
    expect(calls()[1]).toMatchObject({ resume: original.id, profile: original.profile, owner: 'B' })
  })
})
