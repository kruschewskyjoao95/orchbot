import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { validateCreateAgentInput } from '../src/shared/types'

describe('Multiple Conversation Threads per Agent', () => {
  let db: OrchbotDatabase

  beforeEach(() => {
    db = new OrchbotDatabase(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('deve criar uma thread inicial ao cadastrar um novo agente', () => {
    const agent = db.createAgent(
      validateCreateAgentInput({
        name: 'Dev Agent',
        provider: 'codex',
        model: 'gpt-4o',
        workspacePath: '/tmp/workspace-dev',
      }),
    )

    const threads = db.listThreads(agent.id)
    expect(threads.length).toBe(1)
    expect(threads[0].title).toBe('Conversa Inicial')
    expect(threads[0].agentId).toBe(agent.id)
  })

  it('deve permitir criar múltiplas threads para o mesmo agente', () => {
    const agent = db.createAgent(
      validateCreateAgentInput({
        name: 'Dev Agent',
        provider: 'claude',
        model: 'claude-3-7-sonnet',
        workspacePath: '/tmp/workspace-claude',
      }),
    )

    const thread2 = db.createThread(agent.id, 'Refatoração do Backend')
    const thread3 = db.createThread(agent.id, 'Debug de Memória')

    const threads = db.listThreads(agent.id)
    expect(threads.length).toBe(3)
    expect(threads.map((t) => t.title)).toContain('Conversa Inicial')
    expect(threads.map((t) => t.title)).toContain('Refatoração do Backend')
    expect(threads.map((t) => t.title)).toContain('Debug de Memória')
    expect(thread2.id).toBeDefined()
    expect(thread3.id).toBeDefined()
  })

  it('deve atualizar o título de uma thread existente', () => {
    const agent = db.createAgent(
      validateCreateAgentInput({
        name: 'Agent',
        provider: 'grok',
        model: 'grok-2',
        workspacePath: '/tmp/workspace-grok',
      }),
    )

    const threads = db.listThreads(agent.id)
    const initialThread = threads[0]

    const updated = db.updateThreadTitle(initialThread.id, 'Planejamento de Arquitetura')
    expect(updated.title).toBe('Planejamento de Arquitetura')
    expect(updated.id).toBe(initialThread.id)

    const reloadedThreads = db.listThreads(agent.id)
    expect(reloadedThreads[0].title).toBe('Planejamento de Arquitetura')
  })

  it('deve manter histórico e mensagens isolados entre diferentes threads do mesmo agente', () => {
    const agent = db.createAgent(
      validateCreateAgentInput({
        name: 'Agent Multi-Topic',
        provider: 'codex',
        model: 'gpt-4o',
        workspacePath: '/tmp/workspace-multi',
      }),
    )

    const threadA = db.listThreads(agent.id)[0]
    const threadB = db.createThread(agent.id, 'Discussão Secundária')

    // Insere mensagem na Thread A
    db.addMessage(threadA.id, 'user', 'Pergunta na Thread A')

    // Insere mensagem na Thread B
    db.addMessage(threadB.id, 'user', 'Pergunta na Thread B')

    const msgsA = db.listMessages(threadA.id)
    const msgsB = db.listMessages(threadB.id)

    expect(msgsA.length).toBe(1)
    expect(msgsA[0].text).toBe('Pergunta na Thread A')

    expect(msgsB.length).toBe(1)
    expect(msgsB[0].text).toBe('Pergunta na Thread B')
  })

  it('deve deletar uma thread e suas mensagens associadas sem afetar outras threads', () => {
    const agent = db.createAgent(
      validateCreateAgentInput({
        name: 'Agent Delete Thread',
        provider: 'codex',
        model: 'gpt-4o',
        workspacePath: '/tmp/workspace-del-thread',
      }),
    )

    const thread1 = db.listThreads(agent.id)[0]
    const thread2 = db.createThread(agent.id, 'Thread Temporária')

    db.addMessage(thread2.id, 'user', 'Mensagem descartável')

    expect(db.listThreads(agent.id).length).toBe(2)
    expect(db.listMessages(thread2.id).length).toBe(1)

    // Deleta thread2
    const deleted = db.deleteThread(thread2.id)
    expect(deleted).toBe(true)

    // Verifica que thread2 e suas mensagens foram apagadas
    const remainingThreads = db.listThreads(agent.id)
    expect(remainingThreads.length).toBe(1)
    expect(remainingThreads[0].id).toBe(thread1.id)
    expect(db.listMessages(thread2.id).length).toBe(0)
  })

  it('deve deletar todas as threads em cascata quando o agente é removido', () => {
    const agent = db.createAgent(
      validateCreateAgentInput({
        name: 'Agent Cascade',
        provider: 'muse',
        model: 'muse-spark-1.3',
        workspacePath: '/tmp/workspace-cascade',
      }),
    )

    db.createThread(agent.id, 'Thread Extra 1')
    db.createThread(agent.id, 'Thread Extra 2')

    expect(db.listThreads(agent.id).length).toBe(3)

    db.deleteAgent(agent.id)
    expect(db.listThreads(agent.id).length).toBe(0)
  })
})
