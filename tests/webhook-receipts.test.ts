import fs from 'node:fs'
import type http from 'node:http'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderRegistry } from '../src/backend/providers/registry'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { startWebhookServer } from '../src/backend/triggers/webhook-server'
import { testSecretStorage } from './secret-storage-fixture'

describe('recibos duráveis de webhook', () => {
  let dir: string
  let db: OrchbotDatabase
  let queue: QueueManager
  let server: http.Server
  let base: string
  let agentId: string
  let route: string
  const changed = vi.fn()
  const executed = vi.fn()

  const open = async () => {
    db = new OrchbotDatabase(path.join(dir, 'orchbot.db'), testSecretStorage)
    const registry = new ProviderRegistry()
    registry.registerAdapter({
      id: 'codex',
      name: 'Mock',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, _options, callbacks) => {
        executed(prompt)
        setTimeout(() => callbacks.onDone('feito'), 0)
        return { interrupt() {} }
      },
    })
    queue = new QueueManager(db, registry, { onTaskStatusChanged: changed })
    server = await startWebhookServer(db, queue, 0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/t`
  }
  const close = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    queue.close()
    db.close()
  }
  const post = (key?: string, target = route, body = '{"item":"x"}') =>
    fetch(`${base}/${target}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key === undefined ? {} : { 'Idempotency-Key': key }),
      },
      body,
    })

  beforeEach(async () => {
    changed.mockClear()
    executed.mockClear()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-webhook-receipts-'))
    await open()
    const agent = db.createAgent({
      name: 'Loja',
      provider: 'codex',
      model: 'gpt',
      workspacePath: dir,
    })
    agentId = agent.id
    queue.pause(agentId)
    const trigger = db.createWebhookTrigger(agentId, 'Pedido', 'Confira o estoque')
    route = `${trigger.id}/${trigger.token}`
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('entregas concorrentes devolvem a mesma conversa e executam uma única tarefa', async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => post('pedido-1')))
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(202))
    const results = await Promise.all(responses.map((r) => r.json()))
    expect(new Set(results.map((r) => r.threadId)).size).toBe(1)
    expect(db.listTasks(agentId)).toHaveLength(1)
    expect(db.listMessages(results[0].threadId)).toHaveLength(1)
    expect(changed).toHaveBeenCalledTimes(1)
    queue.resume(agentId)
    await vi.waitFor(() => expect(db.listTasks(agentId)[0].status).toBe('completed'))
    expect(executed).toHaveBeenCalledTimes(1)
    expect(await (await post('pedido-1')).json()).toEqual(results[0])
    expect(db.listTasks(agentId)).toHaveLength(1)
  })

  it('o recibo e a tarefa pendente sobrevivem à reabertura do banco e servidor', async () => {
    const first = await (await post('persistente')).json()
    await close()
    await open()
    expect(await (await post('persistente')).json()).toEqual(first)
    expect(db.listTasks(agentId)).toHaveLength(1)
    expect(db.listTasks(agentId)[0].status).toBe('pending')
  })

  it('adiciona a tabela de recibos a um banco existente sem perder os trabalhos anteriores', async () => {
    const first = await (await post()).json()
    await close()
    const old = new DatabaseSync(path.join(dir, 'orchbot.db'))
    old.exec('DROP TABLE webhook_receipts')
    old.close()
    await open()
    expect(db.listMessages(first.threadId)).toHaveLength(1)
    const second = await (await post('novo')).json()
    expect(await (await post('novo')).json()).toEqual(second)
    expect(db.listTasks(agentId)).toHaveLength(2)
  })

  it('chaves diferentes e chamadas sem chave continuam criando trabalhos independentes', async () => {
    for (const key of ['a', 'b', undefined, undefined]) expect((await post(key)).status).toBe(202)
    expect(db.listTasks(agentId)).toHaveLength(4)
  })

  it('a mesma chave em outro gatilho não colide', async () => {
    const other = db.createWebhookTrigger(agentId, 'Outro', 'Outra instrução')
    const a = await (await post('mesmo-id')).json()
    const b = await (await post('mesmo-id', `${other.id}/${other.token}`)).json()
    expect(a.threadId).not.toBe(b.threadId)
    expect(db.listTasks(agentId)).toHaveLength(2)
  })

  it('um reenvio com corpo diferente preserva o primeiro trabalho', async () => {
    const a = await (await post('original')).json()
    const b = await (await post('original', route, '{"item":"outro"}')).json()
    expect(b).toEqual(a)
    expect(db.listMessages(a.threadId)[0].text).not.toContain('outro')
    expect(db.listTasks(agentId)).toHaveLength(1)
  })

  it('apagar a conversa não permite repetir a entrega enquanto o recibo é válido', async () => {
    const first = await (await post('apagado')).json()
    queue.deleteThread(first.threadId)
    expect(await (await post('apagado')).json()).toEqual(first)
    expect(db.listTasks(agentId)).toHaveLength(0)
  })

  it('reenvios não prolongam os sete dias de retenção', async () => {
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const first = await (await post('expira')).json()
    clock.mockReturnValue(now + 7 * 24 * 60 * 60 * 1000 - 1)
    expect(await (await post('expira')).json()).toEqual(first)
    clock.mockReturnValue(now + 7 * 24 * 60 * 60 * 1000)
    expect((await (await post('expira')).json()).threadId).not.toBe(first.threadId)
    expect(db.listTasks(agentId)).toHaveLength(2)
  })

  it.each(['', 'x'.repeat(201), 'com espaço'])(
    'recusa chave inválida antes de criar trabalho: %j',
    async (key) => {
      expect((await post(key)).status).toBe(400)
      expect(db.listTasks(agentId)).toHaveLength(0)
    },
  )

  it('recusa dois cabeçalhos de chave na mesma requisição', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        `${base}/${route}`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': ['a', 'b'] },
        },
        (res) => {
          res.resume()
          resolve(res.statusCode)
        },
      )
      req.on('error', reject)
      req.end('{}')
    })
    expect(status).toBe(400)
    expect(db.listTasks(agentId)).toHaveLength(0)
  })

  it('reenvios continuam exigindo token válido e respeitando o limite de corpo', async () => {
    await post('seguro')
    expect((await post('seguro', `${route.split('/')[0]}/errado`)).status).toBe(404)
    const large = await post('seguro', route, 'x'.repeat(1024 * 1024 + 10)).catch(() => null)
    if (large) expect(large.status).toBe(413)
    expect(db.listTasks(agentId)).toHaveLength(1)
  })

  it('falha ao persistir a tarefa desfaz conversa e mensagem e permite retry', async () => {
    const before = db.listThreads(agentId).length
    const fail = vi.spyOn(db, 'enqueueTask').mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    expect((await post('falha')).status).toBe(503)
    expect(db.listThreads(agentId)).toHaveLength(before)
    expect(db.listTasks(agentId)).toHaveLength(0)
    expect(db.searchMessages('estoque', { agentId })).toHaveLength(0)
    expect(changed).not.toHaveBeenCalled()
    fail.mockRestore()
    expect((await post('falha')).status).toBe(202)
    expect(db.listTasks(agentId)).toHaveLength(1)
  })

  it('falha ao gravar o recibo desfaz também a tarefa e não agenda execução', async () => {
    const before = db.listThreads(agentId).length
    const storage = new DatabaseSync(path.join(dir, 'orchbot.db'))
    try {
      storage.exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON webhook_receipts
        BEGIN SELECT RAISE(ABORT, 'receipt storage unavailable'); END`)
      expect((await post('recibo-falhou')).status).toBe(503)
      expect(db.listThreads(agentId)).toHaveLength(before)
      expect(db.listTasks(agentId)).toHaveLength(0)
      expect(db.searchMessages('estoque', { agentId })).toHaveLength(0)
      expect(changed).not.toHaveBeenCalled()
      storage.exec('DROP TRIGGER fail_receipt')
      expect((await post('recibo-falhou')).status).toBe(202)
      expect(db.listTasks(agentId)).toHaveLength(1)
    } finally {
      storage.close()
    }
  })
})
