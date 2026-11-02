import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProviderAdapter } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { Agent, ProviderInfo, SupportedProvider } from '../src/shared/types'

// Mock de ProviderRegistry para testes rápidos e isolados
class MockProviderRegistry {
  public executedPrompts: string[] = []

  public getAdapter(_id: SupportedProvider): ProviderAdapter {
    return {
      id: 'codex',
      name: 'Mock Adapter',
      checkAvailability: async (): Promise<ProviderInfo> => ({ available: true }),
      executeTurn: (prompt, _options, callbacks) => {
        this.executedPrompts.push(prompt)
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
    db = new OrchbotDatabase(':memory:')
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
    db.close()
  })

  it('deve enfileirar tarefas e manter a ordem FIFO', async () => {
    const task1 = queue.enqueue(testAgent.id, threadId, 'Tarefa 1')
    const task2 = queue.enqueue(testAgent.id, threadId, 'Tarefa 2')
    const task3 = queue.enqueue(testAgent.id, threadId, 'Tarefa 3')

    expect(task1.status).toBe('pending')
    expect(task2.status).toBe('pending')
    expect(task3.status).toBe('pending')

    // Aguarda o término das execuções encadeadas
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(mockRegistry.executedPrompts).toEqual(['Tarefa 1', 'Tarefa 2', 'Tarefa 3'])

    // Verifica que as mensagens foram gravadas no banco
    const msgs = db.listMessages(threadId)
    const assistantMsgs = msgs.filter((m) => m.role === 'assistant')
    expect(assistantMsgs.length).toBe(3)
    expect(assistantMsgs[0].text).toContain('Tarefa 1')
    expect(assistantMsgs[1].text).toContain('Tarefa 2')
    expect(assistantMsgs[2].text).toContain('Tarefa 3')
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
})
