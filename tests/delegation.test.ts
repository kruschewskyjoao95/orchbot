import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DelegationService } from '../src/backend/delegation/delegation-service'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { Agent } from '../src/shared/types'

class MockRegistry {
  getAdapter() {
    return {
      id: 'codex',
      name: 'Mock',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (_p: string, _o: unknown, cb: { onDone: (s: string) => void }) => {
        setTimeout(() => cb.onDone('OK delegado'), 5)
        return { interrupt: () => {} }
      },
    }
  }
  registerActiveExecution() {}
  removeActiveExecution() {}
  interruptThread() {
    return true
  }
}

describe('Fase 4: Colaboração Agente-a-Agente (DelegationService)', () => {
  let db: OrchbotDatabase
  let queue: QueueManager
  let delegation: DelegationService
  let agentA: Agent
  let agentB: Agent

  beforeEach(() => {
    db = new OrchbotDatabase(':memory:')
    queue = new QueueManager(
      db,
      new MockRegistry() as unknown as import('../src/backend/providers/registry').ProviderRegistry,
    )
    delegation = new DelegationService(db, queue)

    agentA = db.createAgent({
      name: 'Codex Engenheiro',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: '/tmp/agent-a',
    })

    agentB = db.createAgent({
      name: 'Claude Reviewer',
      provider: 'claude',
      model: 'claude-3-7-sonnet',
      workspacePath: '/tmp/agent-b',
    })
  })

  afterEach(() => {
    queue.close()
    db.close()
  })

  it('deve permitir que o Agente A delegue uma tarefa ao Agente B', async () => {
    const { task, message } = await delegation.delegate({
      fromAgentId: agentA.id,
      toAgentId: agentB.id,
      prompt: 'Revise este código para mim',
    })

    expect(task.id).toBeDefined()
    expect(task.agentId).toBe(agentB.id)
    expect(task.status).toBe('pending')

    expect(message.senderAgentId).toBe(agentA.id)
    expect(message.recipientAgentId).toBe(agentB.id)
    expect(message.text).toContain('[Tarefa Delegada por Codex Engenheiro (codex)]')

    // Deve estar registrado na conversa do Agente B
    const bThreads = db.listThreads(agentB.id)
    const bMessages = db.listMessages(bThreads[0].id)
    expect(bMessages.some((m) => m.id === message.id)).toBe(true)
  })

  it('deve impedir que um agente delegue para si mesmo', async () => {
    await expect(
      delegation.delegate({
        fromAgentId: agentA.id,
        toAgentId: agentA.id,
        prompt: 'Auto-delegação',
      }),
    ).rejects.toThrow('Um agente não pode delegar uma tarefa para si mesmo')
  })

  it('deve barrar delegações em loop que excedam a profundidade máxima (Anti-loop)', async () => {
    // Cria uma tarefa pré-existente com profundidade máxima atingida
    const threadsA = db.listThreads(agentA.id)
    const parentTask = db.enqueueTask(agentA.id, threadsA[0].id, 'Tarefa Raiz', 2)

    db.updateTaskStatus(parentTask.id, 'completed')

    // Tentar delegar com profundidade máxima deve lançar erro
    await expect(
      delegation.delegate({
        fromAgentId: agentA.id,
        toAgentId: agentB.id,
        prompt: 'Delegação em cascata profunda',
        parentTaskId: parentTask.id,
      }),
    ).rejects.toThrow('Limite máximo de profundidade de delegação atingido')
  })
})
