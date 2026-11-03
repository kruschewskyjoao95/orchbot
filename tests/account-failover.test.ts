import fs from 'node:fs'
import { type Server, createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleAdapter } from '../src/backend/providers/openai-compatible-adapter'
import { ProviderRegistry } from '../src/backend/providers/registry'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

describe('Quota fallback between accounts', () => {
  let db: OrchbotDatabase
  let queue: QueueManager
  let registry: ProviderRegistry
  let server: Server
  let endpoint: string
  let dir: string
  let requests: Array<{ key: string; model: string }>
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-account-failover-'))
    db = new OrchbotDatabase(path.join(dir, 'test.db'), testSecretStorage)
    // Tests must never execute real installed agents on a fallback.
    for (const connection of db.listConnections())
      db.updateConnection({ providerId: connection.providerId, enabled: false })
    registry = new ProviderRegistry()
    queue = new QueueManager(db, registry)
    requests = []
    server = createServer((request, response) => {
      void (async () => {
        let body = ''
        for await (const chunk of request) body += chunk
        const key = request.headers.authorization?.replace('Bearer ', '') ?? ''
        requests.push({ key, model: JSON.parse(body).model })
        if (key.startsWith('quota') || key === 'unauthorized') {
          response.writeHead(key === 'unauthorized' ? 401 : 429, {
            'Content-Type': 'application/json',
          })
          response.end(JSON.stringify({ error: { message: `Rejected key ${key}` } }))
        } else {
          response.writeHead(200, { 'Content-Type': 'text/event-stream' })
          response.end(
            'data: {"choices":[{"delta":{"content":"Completed"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
          )
        }
      })().catch(() => response.destroy())
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server failed')
    endpoint = `http://127.0.0.1:${address.port}/v1`
  })
  afterEach(async () => {
    queue.close()
    registry.interruptAll()
    db.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const provider = (name: string, apiKey: string, defaultModel = 'default-model') => {
    const connection = db.createCustomProvider({ name, apiKey, defaultModel, endpoint })
    if (!connection.providerId.startsWith('custom:')) throw new Error('Expected custom provider')
    registry.registerAdapter(
      new OpenAiCompatibleAdapter(connection.providerId as `custom:${string}`, name),
    )
    return connection.providerId
  }

  it('tries another account on the same provider before another provider and keeps the robot model', async () => {
    const first = provider('First', 'quota-private-key')
    const alternate = db.createProviderAccount({
      providerId: first,
      label: 'Work',
      authMode: 'api_key',
      apiKey: 'healthy-key',
    })
    provider('Other provider', 'other-key')
    const agent = db.createAgent({
      name: 'Bot',
      provider: first,
      model: 'robot-specific-model',
      workspacePath: dir,
    })
    const thread = db.listThreads(agent.id)[0]
    const task = queue.enqueue(agent.id, thread.id, 'Do the task')
    await vi.waitFor(() => expect(db.getTask(task.id)?.status).toBe('completed'))
    expect(requests).toEqual([
      { key: 'quota-private-key', model: 'robot-specific-model' },
      { key: 'healthy-key', model: 'robot-specific-model' },
    ])
    expect(db.getAgent(agent.id)).toMatchObject({ provider: first, accountId: alternate.id })
    const notice =
      db.listMessages(thread.id).find((message) => message.role === 'system')?.text ?? ''
    expect(notice).toContain('Padrão')
    expect(notice).toContain('Work')
    expect(notice).not.toContain('quota-private-key')
    expect(db.listMessages(thread.id).at(-1)?.text).toBe('Completed')
  })

  it('exhausts the original provider accounts before switching providers', async () => {
    const first = provider('First', 'quota-a')
    db.createProviderAccount({
      providerId: first,
      label: 'Second account',
      authMode: 'api_key',
      apiKey: 'quota-b',
    })
    const other = provider('Other', 'healthy-other', 'other-model')
    const agent = db.createAgent({
      name: 'Bot',
      provider: first,
      model: 'robot-model',
      workspacePath: dir,
    })
    const task = queue.enqueue(agent.id, db.listThreads(agent.id)[0].id, 'Retry in order')
    await vi.waitFor(() => expect(db.getTask(task.id)?.status).toBe('completed'))
    expect(requests).toEqual([
      { key: 'quota-a', model: 'robot-model' },
      { key: 'quota-b', model: 'robot-model' },
      { key: 'healthy-other', model: 'other-model' },
    ])
    expect(db.getAgent(agent.id)).toMatchObject({ provider: other, accountId: other })
  })

  it('does not loop when all accounts are exhausted and skips disabled accounts', async () => {
    const id = provider('Limited', 'quota-a')
    const disabled = db.createProviderAccount({
      providerId: id,
      label: 'Disabled',
      authMode: 'api_key',
      apiKey: 'healthy-disabled',
    })
    db.updateProviderAccount({ providerId: id, id: disabled.id, enabled: false })
    db.createProviderAccount({
      providerId: id,
      label: 'Exhausted',
      authMode: 'api_key',
      apiKey: 'quota-b',
    })
    const agent = db.createAgent({
      name: 'Bot',
      provider: id,
      model: 'robot-model',
      workspacePath: dir,
    })
    const task = queue.enqueue(agent.id, db.listThreads(agent.id)[0].id, 'Exhaust quotas')
    await vi.waitFor(() => expect(db.getTask(task.id)?.status).toBe('failed'))
    expect(requests.map((request) => request.key)).toEqual(['quota-a', 'quota-b'])
  })

  it('does not rotate identities after authentication or other non-quota errors', async () => {
    const id = provider('Unauthorized', 'unauthorized')
    db.createProviderAccount({
      providerId: id,
      label: 'Do not use',
      authMode: 'api_key',
      apiKey: 'healthy-key',
    })
    const agent = db.createAgent({ name: 'Bot', provider: id, model: 'model', workspacePath: dir })
    const task = queue.enqueue(agent.id, db.listThreads(agent.id)[0].id, 'Must fail')
    await vi.waitFor(() => expect(db.getTask(task.id)?.status).toBe('failed'))
    expect(requests).toHaveLength(1)
    expect(db.getTask(task.id)?.error).toContain('401')
  })

  it('uses the pinned account first and refuses a disabled pinned account', async () => {
    const id = provider('Pinned', 'default-key')
    const pinned = db.createProviderAccount({
      providerId: id,
      label: 'Pinned',
      authMode: 'api_key',
      apiKey: 'pinned-key',
    })
    const agent = db.createAgent({
      name: 'Bot',
      provider: id,
      accountId: pinned.id,
      model: 'model',
      workspacePath: dir,
    })
    const thread = db.listThreads(agent.id)[0]
    const first = queue.enqueue(agent.id, thread.id, 'Use pinned')
    await vi.waitFor(() => expect(db.getTask(first.id)?.status).toBe('completed'))
    db.updateProviderAccount({ providerId: id, id: pinned.id, enabled: false })
    const next = queue.enqueue(agent.id, thread.id, 'Do not use any other identity')
    await vi.waitFor(() => expect(db.getTask(next.id)?.status).toBe('failed'))
    expect(requests.map((request) => request.key)).toEqual(['pinned-key'])
  })
})
