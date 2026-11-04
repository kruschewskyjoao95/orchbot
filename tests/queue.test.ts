import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type { ExecutionCallbacks, ProviderAdapter } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { Agent, ProviderInfo, SupportedProvider } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

// Mock de ProviderRegistry para testes rápidos e isolados
class MockProviderRegistry {
  public executedPrompts: string[] = []
  public executedKeys: Array<string | undefined> = []

  public getAdapter(_id: SupportedProvider): ProviderAdapter {
    return {
      id: 'codex',
      name: 'Mock Adapter',
      checkAvailability: async (): Promise<ProviderInfo> => ({ available: true }),
      executeTurn: (prompt, options, callbacks) => {
        this.executedPrompts.push(prompt)
        this.executedKeys.push(options.providerConfig?.apiKey)
        // Simula execução síncrona/imediata com sucesso
        setTimeout(() => {
          callbacks.onChunk('Chunk 1', 'Chunk 1')
          callbacks.onDone(`Resposta para: ${prompt}`)
        }, 10)
        return { interrupt: () => {} }
      },
    }
  }

  public registerActiveExecution() {}
  public removeActiveExecution() {}
  public interruptThread() {
    return true
  }
}

describe('Fase 3: Fila Durável FIFO (QueueManager)', () => {
  let db: OrchbotDatabase
  let mockRegistry: MockProviderRegistry
  let queue: QueueManager
  let testAgent: Agent
  let threadId: string

  beforeEach(() => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    mockRegistry = new MockProviderRegistry()
    queue = new QueueManager(
      db,
      mockRegistry as unknown as import('../src/backend/providers/registry').ProviderRegistry,
    )

    testAgent = db.createAgent({
      name: 'FilaBot',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: '/tmp/queue-test',
    })

    const threads = db.listThreads(testAgent.id)
    threadId = threads[0].id
  })

  afterEach(() => {
    queue.close()
    if (db.isOpen()) db.close()
  })

  it('abre a chave apenas para execução do provedor', async () => {
    db.updateConnection({ providerId: 'codex', apiKey: 'private-test-key' })
    const task = queue.enqueue(testAgent.id, threadId, 'Usar chave')
    await vi.waitFor(() => expect(db.getTask(task.id)?.status).toBe('completed'))
    expect(mockRegistry.executedKeys).toEqual(['private-test-key'])
    expect(JSON.stringify(db.listMessages(threadId))).not.toContain('private-test-key')
  })

  it('falha com aviso quando o cofre não abre e permite executar após recuperação', async () => {
    const keyRead = vi.spyOn(db, 'getConnectionApiKey').mockImplementation(() => {
      throw new Error('Cofre indisponível')
    })
    const task = queue.enqueue(testAgent.id, threadId, 'Falha do cofre')
    await vi.waitFor(() => expect(db.getTask(task.id)?.status).toBe('failed'))
    expect(mockRegistry.executedPrompts).toEqual([])
    keyRead.mockRestore()
    const next = queue.enqueue(testAgent.id, threadId, 'Recuperado')
    await vi.waitFor(() => expect(db.getTask(next.id)?.status).toBe('completed'))
    expect(mockRegistry.executedPrompts).toEqual(['Recuperado'])
  })

  it('ignora callbacks atrasados depois de fechar a fila e o banco', async () => {
    let callbacks: ExecutionCallbacks | undefined
    const adapter = mockRegistry.getAdapter('codex')
    vi.spyOn(mockRegistry, 'getAdapter').mockReturnValue({
      ...adapter,
      executeTurn: (_prompt, _options, handlers) => {
        callbacks = handlers
        return { interrupt: () => {} }
      },
    })
    queue.enqueue(testAgent.id, threadId, 'Fechar antes da resposta')
    await vi.waitFor(() => expect(callbacks).toBeDefined())
    queue.close()
    db.close()
    expect(() => callbacks?.onDone('Resposta atrasada')).not.toThrow()
    expect(() => callbacks?.onError('Erro atrasado')).not.toThrow()
  })

  it.each(['cancel', 'deleteThread'] as const)(
    'não executa a tarefa interrompida durante a compactação (%s)',
    async (action) => {
      const adapter = mockRegistry.getAdapter('codex')
      const pending: Array<() => void> = []
      vi.spyOn(mockRegistry, 'getAdapter').mockReturnValue({
        ...adapter,
        executeTurn: (prompt, options, handlers) => {
          if (!prompt.startsWith('Resuma')) return adapter.executeTurn(prompt, options, handlers)
          pending.push(() => handlers.onDone('resumo'))
          return { interrupt: () => {} }
        },
      })
      for (let i = 0; i < 40; i++) db.addMessage(threadId, i % 2 ? 'assistant' : 'user', `m${i}`)
      await new Promise((r) => setTimeout(r, 5))
      const first = queue.enqueue(testAgent.id, threadId, 'Cancelada')
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      if (action === 'cancel') queue.cancel(first.id)
      else queue.deleteThread(threadId)
      for (const done of pending.splice(0)) done()
      await new Promise((r) => setTimeout(r, 50))
      expect(mockRegistry.executedPrompts).not.toContain('Cancelada')
      expect(db.getTask(first.id)?.status).toBe(action === 'cancel' ? 'cancelled' : undefined)
      const other = db.createThread(testAgent.id, 'Outra conversa')
      const next = queue.enqueue(testAgent.id, other.id, 'Continuar após compactação')
      await vi.waitFor(() => expect(db.getTask(next.id)?.status).toBe('completed'))
    },
  )

  it('ignora o resultado do navegador quando a conversa é excluída durante a ação', async () => {
    let resolveBrowser: (result: unknown) => void = () => {}
    const browser = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveBrowser = resolve
        }),
    )
    queue.setBrowserExecutor(browser)
    const adapter = mockRegistry.getAdapter('codex')
    vi.spyOn(mockRegistry, 'getAdapter').mockReturnValue({
      ...adapter,
      executeTurn: (prompt, options, callbacks) => {
        if (prompt !== 'Navegar') return adapter.executeTurn(prompt, options, callbacks)
        setTimeout(() => callbacks.onDone('[[BROWSER:inspect]] [[/BROWSER]]'), 0)
        return { interrupt: () => {} }
      },
    })
    queue.enqueue(testAgent.id, threadId, 'Navegar')
    await vi.waitFor(() => expect(browser).toHaveBeenCalledTimes(1))
    queue.deleteThread(threadId)
    const other = db.createThread(testAgent.id, 'Outra conversa')
    const next = queue.enqueue(testAgent.id, other.id, 'Continuar após navegador')
    resolveBrowser({ text: 'Resultado atrasado' })
    await vi.waitFor(() => expect(db.getTask(next.id)?.status).toBe('completed'))
    expect(db.getThread(threadId)).toBeNull()
    expect(db.listTasks(testAgent.id)).toHaveLength(1)
  })

  it.each(['onDone', 'onError', 'onInterrupted'] as const)(
    'exclui a conversa ativa e aguarda %s sem afetar outras conversas',
    async (terminal) => {
      queue.close()
      const registry = new ProviderRegistry()
      const runs: Array<{ prompt: string; callbacks: ExecutionCallbacks }> = []
      const interrupt = vi.fn()
      const onStreamChunk = vi.fn()
      registry.registerAdapter({
        id: 'codex',
        name: 'Controlled provider',
        checkAvailability: async () => ({ available: true }),
        executeTurn: (prompt, _options, callbacks) => {
          runs.push({ prompt, callbacks })
          return { interrupt }
        },
      })
      queue = new QueueManager(db, registry, { onStreamChunk })
      const other = db.createThread(testAgent.id, 'Outra conversa')
      const running = queue.enqueue(testAgent.id, threadId, 'Em execução')
      await vi.waitFor(() => expect(runs).toHaveLength(1))
      const cancelled = queue.enqueue(testAgent.id, threadId, 'Não executar')
      const next = queue.enqueue(testAgent.id, other.id, 'Continuar na outra conversa')

      expect(queue.deleteThread(threadId)).toBe(true)
      expect(interrupt).toHaveBeenCalledTimes(1)
      expect(db.getThread(threadId)).toBeNull()
      expect(db.getTask(running.id)).toBeNull()
      expect(db.getTask(cancelled.id)).toBeNull()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(runs).toHaveLength(1)
      onStreamChunk.mockClear()
      const callbacks = runs[0].callbacks
      expect(() => callbacks.onNotice?.('Aviso atrasado')).not.toThrow()
      callbacks.onChunk('Texto atrasado', 'Texto atrasado')
      expect(onStreamChunk).not.toHaveBeenCalled()
      expect(() => {
        if (terminal === 'onInterrupted') callbacks.onInterrupted?.()
        else callbacks[terminal]('Retorno atrasado')
      }).not.toThrow()
      await vi.waitFor(() => expect(runs).toHaveLength(2))
      expect(runs[1].prompt).toBe('Continuar na outra conversa')

      // Retornos duplicados da conversa apagada não podem liberar o turno seguinte.
      expect(() => {
        callbacks.onDone('Resposta atrasada')
        callbacks.onError('429 quota exceeded')
        callbacks.onInterrupted?.()
      }).not.toThrow()
      const third = queue.enqueue(testAgent.id, other.id, 'Esperar o segundo turno')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(runs).toHaveLength(2)
      runs[1].callbacks.onDone('Concluído')
      await vi.waitFor(() => expect(runs).toHaveLength(3))
      expect(db.getTask(next.id)?.status).toBe('completed')
      runs[2].callbacks.onDone('Concluído também')
      await vi.waitFor(() => expect(db.getTask(third.id)?.status).toBe('completed'))
    },
  )

  it('no canal, o resultado do participante volta ao dono sem esgotar a profundidade', async () => {
    const helper = db.createAgent({
      name: 'Ajudante',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: '/tmp/queue-test',
    })
    const ch = queue.collab.createChannel({
      title: 'C',
      ownerAgentId: testAgent.id,
      memberIds: [helper.id],
    })
    const ownerThread = ch.members.find((m) => m.agentId === testAgent.id)?.threadId as string
    const helperThread = ch.members.find((m) => m.agentId === helper.id)?.threadId as string
    queue.enqueue(helper.id, helperThread, 'faça a etapa 1', 2, {
      originThreadId: ownerThread,
      originAgentId: testAgent.id,
    })
    await vi.waitFor(() =>
      expect(db.listTasks(testAgent.id).some((t) => t.threadId === ownerThread)).toBe(true),
    )
    const back = db.listTasks(testAgent.id).find((t) => t.threadId === ownerThread)
    expect(back?.delegationDepth).toBe(2)
    expect(back?.prompt).toContain('Continue coordenando')
  })

  it('deve enfileirar tarefas e manter a ordem FIFO', async () => {
    const task1 = queue.enqueue(testAgent.id, threadId, 'Tarefa 1')
    const task2 = queue.enqueue(testAgent.id, threadId, 'Tarefa 2')
    const task3 = queue.enqueue(testAgent.id, threadId, 'Tarefa 3')

    expect(task1.status).toBe('pending')
    expect(task2.status).toBe('pending')
    expect(task3.status).toBe('pending')

    await vi.waitFor(() => expect(db.getTask(task3.id)?.status).toBe('completed'))

    expect(mockRegistry.executedPrompts).toEqual(['Tarefa 1', 'Tarefa 2', 'Tarefa 3'])

    // Verifica que as mensagens foram gravadas no banco
    const msgs = db.listMessages(threadId)
    const assistantMsgs = msgs.filter((m) => m.role === 'assistant')
    expect(assistantMsgs.length).toBe(3)
    expect(assistantMsgs[0].text).toContain('Tarefa 1')
    expect(assistantMsgs[1].text).toContain('Tarefa 2')
    expect(assistantMsgs[2].text).toContain('Tarefa 3')
  })

  it('mantém a pausa após reiniciar o app', () => {
    queue.pause(testAgent.id)
    const restarted = new QueueManager(db, mockRegistry as never)
    expect(restarted.isPaused(testAgent.id)).toBe(true)
    restarted.resume(testAgent.id)
    expect(new QueueManager(db, mockRegistry as never).isPaused(testAgent.id)).toBe(false)
  })

  it('deve pausar a fila e não processar tarefas subsequentes até retomar', async () => {
    queue.pause(testAgent.id)
    expect(queue.isPaused(testAgent.id)).toBe(true)

    const task = queue.enqueue(testAgent.id, threadId, 'Tarefa Pausada')
    expect(task.status).toBe('pending')

    await new Promise((resolve) => setTimeout(resolve, 50))
    // Nada executado pois a fila está pausada
    expect(mockRegistry.executedPrompts.length).toBe(0)

    // Retoma
    queue.resume(testAgent.id)
    expect(queue.isPaused(testAgent.id)).toBe(false)

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mockRegistry.executedPrompts).toEqual(['Tarefa Pausada'])
  })

  it('deve cancelar tarefa pendente', async () => {
    queue.pause(testAgent.id)

    const task = queue.enqueue(testAgent.id, threadId, 'Tarefa Cancelar')
    const ok = queue.cancel(task.id)
    expect(ok).toBe(true)

    const updated = db.getTask(task.id)
    expect(updated?.status).toBe('cancelled')

    queue.resume(testAgent.id)
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Tarefa cancelada não deve ser executada
    expect(mockRegistry.executedPrompts.length).toBe(0)
  })

  it('deve permitir retry em tarefa cancelada ou falha', async () => {
    queue.pause(testAgent.id)

    const task = queue.enqueue(testAgent.id, threadId, 'Tarefa Retry')
    queue.cancel(task.id)
    expect(db.getTask(task.id)?.status).toBe('cancelled')

    // Dá retry
    queue.retry(task.id)
    expect(db.getTask(task.id)?.status).toBe('pending')

    queue.resume(testAgent.id)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mockRegistry.executedPrompts).toEqual(['Tarefa Retry'])
  })

  it('parar o robô interrompe o CLI e não deixa o pedido seguinte começar', async () => {
    queue.close()
    const registry = new ProviderRegistry()
    const started: string[] = []
    const interrupted: string[] = []
    const adapter: ProviderAdapter = {
      id: 'codex',
      name: 'Preso',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt) => {
        started.push(prompt)
        return {
          interrupt: () => {
            interrupted.push(prompt)
          },
        }
      },
    }
    registry.registerAdapter(adapter)
    const local = new QueueManager(db, registry)
    try {
      const running = local.enqueue(testAgent.id, threadId, 'Trabalhando')
      await vi.waitFor(() => expect(started).toContain('Trabalhando'))
      const next = local.enqueue(testAgent.id, threadId, 'Depois')
      const other = db.createAgent({
        name: 'Outro',
        provider: 'codex',
        model: 'gpt-4o',
        workspacePath: '/tmp/queue-test',
      })
      const otherThread = db.listThreads(other.id)[0].id
      local.pause(other.id)
      const otherTask = local.enqueue(other.id, otherThread, 'Do outro')

      local.stopAgent(testAgent.id)

      expect(interrupted).toEqual(['Trabalhando'])
      expect(db.getTask(running.id)?.status).toBe('cancelled')
      expect(db.getTask(next.id)?.status).toBe('cancelled')
      expect(db.getTask(otherTask.id)?.status).toBe('pending')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(started).toEqual(['Trabalhando'])

      local.resume(other.id)
      await vi.waitFor(() => expect(started).toContain('Do outro'))
    } finally {
      local.close()
    }
  })
})
