import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { controlInput } from '../src/backend/control/contract'
import { startControlServer } from '../src/backend/control/server'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type { ExecutionCallbacks } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { callControl } from '../src/control/client'
import { createMcpHandler } from '../src/control/mcp'
import { mergeMessage, snapshotIsCurrent } from '../src/renderer/src/recovery'
import type { Message } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

describe('controle local e recuperação da conversa', () => {
  let dir: string
  let db: OrchbotDatabase
  let queue: QueueManager
  let control: Awaited<ReturnType<typeof startControlServer>> | undefined
  let agentId: string
  let current: ExecutionCallbacks | undefined
  const executed = vi.fn()
  beforeEach(() => {
    executed.mockClear()
    current = undefined
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-control-'))
    db = new OrchbotDatabase(path.join(dir, 'db'), testSecretStorage)
    const registry = new ProviderRegistry()
    registry.registerAdapter({
      id: 'codex',
      name: 'fake',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, options, callbacks) => {
        executed(prompt, options)
        current = callbacks
        return { interrupt: () => callbacks.onInterrupted?.() }
      },
    })
    queue = new QueueManager(db, registry)
    agentId = db.createAgent({
      name: 'Dev',
      provider: 'codex',
      model: 'test',
      workspacePath: dir,
    }).id
    queue.pause(agentId)
  })
  afterEach(async () => {
    await control?.close()
    control = undefined
    queue.close()
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })
  const args = () => ({ requestId: 'job-1', agentId, prompt: 'Analise os testes' })
  const start = async () => {
    control = await startControlServer(db, queue, path.join(dir, 'control.json'))
    return control.file
  }

  it('persiste tarefa e recibo atomicamente, devolve o mesmo resultado após reabrir o banco', () => {
    const first = queue.enqueueControl('job', agentId, 'Faça isso')
    const snapshot = queue.threadSnapshot(first.threadId)
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.messages.map((message) => message.text)).toEqual(['Faça isso'])
    queue.close()
    db.close()
    db = new OrchbotDatabase(path.join(dir, 'db'), testSecretStorage)
    queue = new QueueManager(db, new ProviderRegistry())
    expect(queue.enqueueControl('job', agentId, 'Faça isso')).toEqual(first)
    expect(db.listTasks(agentId)).toHaveLength(1)
    expect(() => queue.enqueueControl('job', agentId, 'Outro')).toThrow('outro conteúdo')
  })
  it('desfaz mensagem, conversa e recibo se a fila falhar', () => {
    const enqueue = vi.spyOn(db, 'enqueueTask').mockImplementationOnce(() => {
      throw new Error('disco cheio')
    })
    expect(() => queue.enqueueControl('job', agentId, 'Faça')).toThrow('disco cheio')
    expect(db.listTasks(agentId)).toEqual([])
    expect(db.listThreads(agentId)).toHaveLength(1) // conversa inicial
    enqueue.mockRestore()
    expect(queue.enqueueControl('job', agentId, 'Faça').taskId).toBeTruthy()
  })
  it('recupera o texto vivo, preserva-o ao cancelar outra tarefa e limpa quando termina', async () => {
    const first = queue.enqueueControl('job', agentId, 'Faça')
    queue.resume(agentId)
    await vi.waitFor(() => expect(current).toBeDefined())
    current?.onChunk('parte', 'parte')
    const snapshot = queue.threadSnapshot(first.threadId)
    expect(snapshot.streamingText).toBe('parte')
    expect(snapshot.tasks[0].status).toBe('running')
    const pending = queue.enqueue(agentId, first.threadId, 'Depois')
    queue.cancel(pending.id)
    expect(queue.threadSnapshot(first.threadId).streamingText).toBe('parte')
    current?.onDone('feito')
    expect(queue.threadSnapshot(first.threadId).streamingText).toBe('')
    expect(
      queue.threadSnapshot(first.threadId).messages.some((message) => message.text === 'feito'),
    ).toBe(true)
    expect(queue.threadSnapshot(first.threadId).revision).toBeGreaterThan(snapshot.revision)
  })
  it('inicia sem assinatura IPC, reconecta os listeners sem perder o buffer e recusa conversa ausente', async () => {
    const task = queue.enqueueControl('job', agentId, 'Faça')
    queue.resume(agentId)
    await vi.waitFor(() => expect(current).toBeDefined())
    current?.onChunk('a', 'a')
    queue.setEvents({})
    expect(queue.threadSnapshot(task.threadId).streamingText).toBe('a')
    expect(() => queue.threadSnapshot('ausente')).toThrow()
    queue.cancel(task.taskId)
    expect(queue.threadSnapshot(task.threadId).streamingText).toBe('')
  })
  it('não aplica snapshot atrasado, de outra conversa, nem duplica/reordena mensagens repetidas', () => {
    const task = queue.enqueueControl('job', agentId, 'Faça')
    const snapshot = queue.threadSnapshot(task.threadId)
    expect(snapshotIsCurrent(snapshot, task.threadId, snapshot.revision)).toBe(true)
    expect(snapshotIsCurrent(snapshot, task.threadId, snapshot.revision + 1)).toBe(false)
    expect(snapshotIsCurrent(snapshot, 'outra', 0)).toBe(false)
    const one = snapshot.messages[0]
    const two: Message = { ...one, id: '2', text: 'segunda' }
    expect(mergeMessage([one, two], { ...one, text: 'atualizada' }).map((item) => item.id)).toEqual(
      [one.id, '2'],
    )
    expect(mergeMessage([one], one)).toHaveLength(1)
  })
  it('só aceita conexão autenticada, recusa Origin e remove arquivo ao desligar', async () => {
    const file = await start()
    const connection = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(fs.statSync(file).mode & 0o077).toBe(0)
    expect((await fetch(connection.url, { method: 'POST', body: '{}' })).status).toBe(403)
    expect(
      (
        await fetch(connection.url, {
          method: 'POST',
          headers: { authorization: `Bearer ${connection.token}`, Origin: 'https://evil.example' },
          body: '{}',
        })
      ).status,
    ).toBe(403)
    expect(await callControl(file, 'list_agents', {})).toEqual([
      { id: agentId, name: 'Dev', provider: 'codex', runtime: 'host' },
    ])
    await control?.close()
    control = undefined
    expect(fs.existsSync(file)).toBe(false)
    await expect(callControl(file, 'list_agents', {})).rejects.toThrow()
  })
  it('cliente e MCP enviam, consultam e cancelam sem duplicar trabalho', async () => {
    const file = await start()
    const handler = createMcpHandler((method, params) => callControl(file, method, params))
    expect(await handler({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toMatchObject({
      error: { code: -32002 },
    })
    expect(
      await handler({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25' },
      }),
    ).toMatchObject({ result: { capabilities: { tools: {} } } })
    expect(await handler({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined()
    expect(await handler({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).toMatchObject({
      result: { tools: expect.arrayContaining([expect.objectContaining({ name: 'send_task' })]) },
    })
    const [a, b] = await Promise.all([
      callControl(file, 'send_task', args()),
      callControl(file, 'send_task', args()),
    ])
    expect(a).toEqual(b)
    const task = { taskId: (a as { taskId: string }).taskId }
    expect(await callControl(file, 'get_task', task)).toMatchObject({
      task: { status: 'pending' },
      snapshot: { messages: [expect.objectContaining({ text: args().prompt })] },
    })
    expect(
      await handler({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'cancel_task', arguments: task },
      }),
    ).toMatchObject({ result: { isError: false } })
    expect(db.getTask(task.taskId)?.status).toBe('cancelled')
    expect(
      await handler({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'grant_permission', arguments: {} },
      }),
    ).toMatchObject({ result: { isError: true } })
    expect(db.listTasks(agentId)).toHaveLength(1)
    expect(executed).not.toHaveBeenCalled()
  })
  it('recusa segredo público, symlink e redirecionamento do cliente para fora de loopback', async () => {
    const file = await start()
    fs.chmodSync(file, 0o644)
    await expect(callControl(file, 'list_agents', {})).rejects.toThrow('privado')
    fs.chmodSync(file, 0o600)
    const link = path.join(dir, 'link')
    fs.symlinkSync(file, link)
    await expect(callControl(link, 'list_agents', {})).rejects.toThrow('regular')
    const connection = JSON.parse(fs.readFileSync(file, 'utf8'))
    connection.url = 'https://example.com/rpc'
    fs.writeFileSync(file, JSON.stringify(connection))
    await expect(callControl(file, 'list_agents', {})).rejects.toThrow('inválida')
  })
  it.skipIf(process.env.ORCHBOT_TEST_BUILT_CONTROL !== '1')(
    'CLI compilada funciona como consumidor real e MCP mantém stdout JSONL',
    async () => {
      const file = await start()
      const cli = path.resolve('out/main/control.js')
      const listed = await promisify(execFile)(process.execPath, [cli, 'list_agents', file])
      expect(JSON.parse(listed.stdout)).toContainEqual(expect.objectContaining({ id: agentId }))
      const output = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          [cli, 'mcp', file],
          { timeout: 10000 },
          (error, stdout) => (error ? reject(error) : resolve(stdout)),
        )
        child.stdin?.end(
          [
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'initialize',
              params: { protocolVersion: '2025-11-25' },
            }),
            JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
            JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: {
                name: 'send_task',
                arguments: { ...args(), prompt: 'Corrija a regressão em português 🐎' },
              },
            }),
            '{invalid',
            JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
            '',
          ].join('\n'),
        )
      })
      const replies = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(replies).toHaveLength(4)
      expect(replies[1]).toMatchObject({ id: 2, result: { isError: false } })
      expect(replies[2]).toMatchObject({ error: { code: -32700 } })
      expect(db.listTasks(agentId)[0].prompt).toBe('Corrija a regressão em português 🐎')
    },
  )

  it.each([
    ['send_task', { ...args(), approved: true }],
    ['send_task', { ...args(), prompt: '' }],
    ['send_task', { ...args(), requestId: 'a\nb' }],
    ['get_task', { taskId: 'x', token: 'secret' }],
    ['list_agents', { account: true }],
    ['set_runtime', {}],
  ])('valida contrato: %s %j', (method, params) => {
    expect(() => controlInput(method, params)).toThrow()
  })
})
