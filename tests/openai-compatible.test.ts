import { type Server, createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleAdapter } from '../src/backend/providers/openai-compatible-adapter'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type { ProviderRuntimeConfig } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

const id = 'custom:11111111-1111-4111-8111-111111111111' as const
const adapter = new OpenAiCompatibleAdapter(id, 'Test API')
describe('OpenAI-compatible HTTP provider', () => {
  let server: Server
  let endpoint: string
  let mode: string
  let requests: Array<{
    url: string
    key?: string
    body: { model?: string; messages?: Array<{ role: string; content: string }>; stream?: boolean }
  }>
  beforeEach(async () => {
    mode = 'normal'
    requests = []
    server = createServer((req, res) => {
      void (async () => {
        let body = ''
        for await (const chunk of req) body += chunk
        requests.push({
          url: req.url ?? '',
          key: req.headers.authorization,
          body: body ? JSON.parse(body) : {},
        })
        if (mode === 'unauthorized' || mode === 'quota') {
          res.writeHead(mode === 'quota' ? 429 : 401, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              error: { message: `Invalid ${req.headers.authorization ?? 'quota'}` },
            }),
          )
          return
        }
        if (mode === 'redirect') {
          res.writeHead(307, { Location: `${endpoint}/capture` })
          res.end()
          return
        }
        if (req.url?.endsWith('/models')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify(
              mode === 'bad-models'
                ? {}
                : { data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-a' }, { id: null }] },
            ),
          )
          return
        }
        if (mode === 'json') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              choices: [{ message: { content: 'Plain JSON response' }, finish_reason: 'stop' }],
            }),
          )
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        if (mode === 'hang') {
          res.write('data: {"choices":[{"delta":{"content":"Start"}}]}\n\n')
          return
        }
        let text =
          ': heartbeat\r\n\r\ndata: {"choices":[{"delta":{"content":"Olá "}}]}\r\n\r\ndata: {"choices":[\r\ndata: {"delta":{"content":"🌍"}}]}\r\n\r\n'
        if (mode === 'stream-error') text += 'data: {"error":{"message":"Stream failure"}}\n\n'
        else if (mode === 'malformed') text += 'data: {not-json}\n\n'
        else if (mode === 'tool-calls')
          text += 'data: {"choices":[{"delta":{"tool_calls":[{"id":"tool-1"}]}}]}\n\n'
        else if (mode !== 'truncated')
          text +=
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"total_tokens":12}}\n\ndata: [DONE]'
        const bytes = Buffer.from(text)
        for (let i = 0; i < bytes.length; i += 7) {
          if (res.destroyed) break
          res.write(bytes.subarray(i, i + 7))
          await new Promise((resolve) => setImmediate(resolve))
        }
        res.end()
      })().catch(() => res.destroy())
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not start')
    endpoint = `http://127.0.0.1:${address.port}/api/v1`
  })
  afterEach(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function run(config: ProviderRuntimeConfig = { endpoint }) {
    const onChunk = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    const onInterrupted = vi.fn()
    const active = adapter.executeTurn(
      'User prompt',
      {
        workspacePath: process.cwd(),
        model: 'model-a',
        instructions: 'System instructions',
        providerConfig: config,
      },
      { onChunk, onDone, onError, onInterrupted },
    )
    return { active, onChunk, onDone, onError, onInterrupted }
  }

  it('discovers real model IDs and streams fragmented UTF-8 SSE with heartbeats and multiline data', async () => {
    expect(await adapter.discoverModels({ endpoint, apiKey: 'secret' })).toEqual([
      'model-a',
      'model-b',
    ])
    const turn = run({ endpoint: `${endpoint}/`, apiKey: 'secret' })
    await vi.waitFor(() => expect(turn.onDone).toHaveBeenCalledWith('Olá 🌍'))
    expect(turn.onChunk.mock.calls).toEqual([
      ['Olá ', 'Olá '],
      ['🌍', 'Olá 🌍'],
    ])
    expect(turn.onError).not.toHaveBeenCalled()
    expect(requests).toMatchObject([
      { url: '/api/v1/models', key: 'Bearer secret' },
      {
        url: '/api/v1/chat/completions',
        key: 'Bearer secret',
        body: {
          model: 'model-a',
          stream: true,
          messages: [
            { role: 'system', content: 'System instructions' },
            { role: 'user', content: 'User prompt' },
          ],
        },
      },
    ])
  })

  it('accepts JSON responses from servers that do not stream', async () => {
    mode = 'json'
    const turn = run()
    await vi.waitFor(() => expect(turn.onDone).toHaveBeenCalledWith('Plain JSON response'))
    expect(requests[0].key).toBeUndefined()
  })

  it.each(['unauthorized', 'quota'])('reports %s without exposing the API key', async (value) => {
    mode = value
    const turn = run({ endpoint, apiKey: 'private-key' })
    await vi.waitFor(() => expect(turn.onError).toHaveBeenCalledTimes(1))
    expect(turn.onError.mock.calls[0][0]).toContain(value === 'quota' ? '429' : '401')
    expect(turn.onError.mock.calls[0][0]).not.toContain('private-key')
    expect(turn.onDone).not.toHaveBeenCalled()
    expect(await adapter.checkAvailability({ endpoint, apiKey: 'private-key' })).toMatchObject({
      available: false,
      error: expect.stringContaining('[REDACTED]'),
    })
  })

  it.each(['stream-error', 'malformed', 'truncated', 'tool-calls'])(
    'reports %s after partial output without treating it as success',
    async (value) => {
      mode = value
      const turn = run()
      await vi.waitFor(() => expect(turn.onError).toHaveBeenCalledTimes(1))
      expect(turn.onChunk).toHaveBeenCalled()
      expect(turn.onDone).not.toHaveBeenCalled()
    },
  )

  it('cancels an in-flight stream without completion or error callbacks', async () => {
    mode = 'hang'
    const turn = run()
    await vi.waitFor(() => expect(turn.onChunk).toHaveBeenCalledWith('Start', 'Start'))
    turn.active.interrupt()
    await vi.waitFor(() => expect(turn.onInterrupted).toHaveBeenCalledTimes(1))
    expect(turn.onDone).not.toHaveBeenCalled()
    expect(turn.onError).not.toHaveBeenCalled()
  })

  it('rejects malformed model lists and refuses redirects', async () => {
    mode = 'bad-models'
    expect(await adapter.checkAvailability({ endpoint })).toMatchObject({ available: false })
    mode = 'redirect'
    const turn = run({ endpoint, apiKey: 'secret' })
    await vi.waitFor(() => expect(turn.onError).toHaveBeenCalled())
    expect(requests.some((req) => req.url.endsWith('/capture'))).toBe(false)
  })

  it('does not infer authenticated chat access from a public model list', async () => {
    expect(await adapter.checkAvailability({ endpoint })).toMatchObject({
      available: true,
      readiness: 'unverified',
    })
    mode = 'unauthorized'
    expect(await adapter.checkAvailability({ endpoint, apiKey: 'wrong-key' })).toMatchObject({
      available: false,
      readiness: 'login_required',
      authStatus: 'missing',
    })
    expect(requests.every((request) => request.url.endsWith('/models'))).toBe(true)
  })

  it('includes registered custom providers in availability and supports unregistering', async () => {
    const registry = new ProviderRegistry()
    for (const builtin of registry.listAdapters())
      vi.spyOn(builtin, 'checkAvailability').mockResolvedValue({ available: true })
    registry.registerAdapter(adapter)
    const statuses = await registry.checkAllAvailability({ [id]: { endpoint } })
    expect(statuses[id]).toMatchObject({ available: true })
    registry.unregisterAdapter(id)
    expect(() => registry.getAdapter(id)).toThrow('não encontrado')
  })

  it('executes a saved custom provider through the real queue and persists its response', async () => {
    const db = new OrchbotDatabase(':memory:', testSecretStorage)
    const connection = db.createCustomProvider({
      name: 'API test',
      endpoint,
      defaultModel: 'model-a',
      apiKey: 'queue-secret',
    })
    if (!connection.providerId.startsWith('custom:')) throw new Error('Invalid custom ID')
    const registry = new ProviderRegistry()
    registry.registerAdapter(
      new OpenAiCompatibleAdapter(connection.providerId as `custom:${string}`, connection.name),
    )
    const queue = new QueueManager(db, registry)
    try {
      const agent = db.createAgent({
        name: 'ApiBot',
        provider: connection.providerId,
        model: connection.defaultModel,
        workspacePath: process.cwd(),
      })
      const thread = db.listThreads(agent.id)[0]
      const task = queue.enqueue(agent.id, thread.id, 'API task')
      await vi.waitFor(() => expect(db.getTask(task.id)?.status).toBe('completed'))
      expect(db.listMessages(thread.id).find((message) => message.role === 'assistant')?.text).toBe(
        'Olá 🌍',
      )
      expect(requests[0]).toMatchObject({ key: 'Bearer queue-secret', body: { model: 'model-a' } })
      expect(JSON.stringify(db.listConnections())).not.toContain('queue-secret')
    } finally {
      queue.close()
      db.close()
    }
  })
})
