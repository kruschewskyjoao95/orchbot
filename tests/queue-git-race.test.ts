import { expect, it, vi } from 'vitest'
import type { ExecutionCallbacks } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

// O contexto git é esperado antes do turno: segura a resposta para cancelar no meio dela.
const pendingGit: Array<(text: string | null) => void> = []
vi.mock('../src/backend/context/git-context', () => ({
  buildGitContext: () => new Promise((resolve) => pendingGit.push(resolve)),
}))

it('não executa a tarefa cancelada enquanto o contexto git era montado', async () => {
  const db = new OrchbotDatabase(':memory:', testSecretStorage)
  const executed: string[] = []
  const registry = {
    getAdapter: () => ({
      id: 'codex',
      name: 'mock',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt: string) => {
        executed.push(prompt)
        return { interrupt: () => {} }
      },
    }),
    registerActiveExecution() {},
    removeActiveExecution() {},
    interruptThread: () => true,
  }
  const queue = new QueueManager(db, registry as never)
  const agent = db.createAgent({
    name: 'Git',
    provider: 'codex',
    model: 'gpt-4o',
    workspacePath: '/tmp',
  })
  const threadId = db.listThreads(agent.id)[0].id
  const task = queue.enqueue(agent.id, threadId, 'Cancelada')
  await vi.waitFor(() => expect(pendingGit).toHaveLength(1))
  queue.cancel(task.id)
  for (const done of pendingGit.splice(0)) done('[CONTEXTO GIT]')
  await new Promise((r) => setTimeout(r, 50))
  expect(executed).not.toContain('Cancelada')
  queue.close()
  db.close()
})

function queueWithHeldSummary(db: OrchbotDatabase, executed: string[]) {
  return new QueueManager(db, {
    getAdapter: () => ({
      id: 'codex',
      name: 'mock',
      supportsSessionResume: true,
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt: string, _options: unknown, callbacks: ExecutionCallbacks) => {
        if (prompt.startsWith('Resuma')) {
          callbacks.onDone('resumo do modelo')
          return { interrupt: () => {} }
        }
        executed.push(prompt)
        setTimeout(() => callbacks.onDone('ok'), 0)
        return { interrupt: () => {} }
      },
    }),
    registerActiveExecution() {},
    removeActiveExecution() {},
    interruptThread: () => false,
  } as never)
}

async function threadReadyToCompact(db: OrchbotDatabase) {
  const agent = db.createAgent({
    name: 'Git',
    provider: 'codex',
    model: 'gpt-4o',
    workspacePath: '/tmp',
  })
  const threadId = db.listThreads(agent.id)[0].id
  const session = '11111111-2222-4333-8444-555555555555'
  db.saveProviderSession(threadId, 'codex', 'escopo', session)
  db.addMessage(threadId, 'user', 'x'.repeat(520_000))
  for (let i = 0; i < 7; i++) db.addMessage(threadId, i % 2 ? 'assistant' : 'user', `m${i}`)
  await new Promise((r) => setTimeout(r, 5))
  return { agent, threadId, session }
}

it('pausar durante o resumo devolve a tarefa à fila e mantém a sessão', async () => {
  const db = new OrchbotDatabase(':memory:', testSecretStorage)
  const executed: string[] = []
  const queue = queueWithHeldSummary(db, executed)
  const { agent, threadId, session } = await threadReadyToCompact(db)

  const task = queue.enqueue(agent.id, threadId, 'Pausada')
  await vi.waitFor(() => expect(pendingGit).toHaveLength(1))
  queue.pause(agent.id)
  for (const done of pendingGit.splice(0)) done(null)
  await vi.waitFor(() => expect(db.getTask(task.id)?.status).toBe('pending'))
  expect(executed).toEqual([])
  expect(db.getThreadSummary(threadId)).toBeUndefined()
  expect(db.getProviderSession(threadId, 'codex', 'escopo')).toBe(session)

  queue.resume(agent.id)
  await vi.waitFor(() => expect(pendingGit).toHaveLength(1))
  for (const done of pendingGit.splice(0)) done(null)
  await vi.waitFor(() => expect(executed).toEqual(['Pausada']))
  expect(db.getTask(task.id)?.status).toBe('completed')

  queue.close()
  db.close()
})

it('cancelar depois do modelo e antes do git terminar não apaga a sessão', async () => {
  const db = new OrchbotDatabase(':memory:', testSecretStorage)
  const executed: string[] = []
  const sessionsAtSummary: Array<string | undefined> = []
  const { agent, threadId, session } = await threadReadyToCompact(db)
  const queue = new QueueManager(db, {
    getAdapter: () => ({
      id: 'codex',
      name: 'mock',
      supportsSessionResume: true,
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt: string, _options: unknown, callbacks: ExecutionCallbacks) => {
        if (prompt.startsWith('Resuma')) {
          sessionsAtSummary.push(db.getProviderSession(threadId, 'codex', 'escopo'))
          callbacks.onDone('resumo do modelo')
          return { interrupt: () => {} }
        }
        executed.push(prompt)
        setTimeout(() => callbacks.onDone('ok'), 0)
        return { interrupt: () => {} }
      },
    }),
    registerActiveExecution() {},
    removeActiveExecution() {},
    interruptThread: () => false,
  } as never)

  const task = queue.enqueue(agent.id, threadId, 'Cancelada')
  await vi.waitFor(() => expect(pendingGit).toHaveLength(1))
  expect(sessionsAtSummary).toEqual([session])
  expect(db.getThreadSummary(threadId)).toBeUndefined()
  queue.cancel(task.id)
  const next = queue.enqueue(agent.id, threadId, 'Seguinte')
  expect(executed).toEqual([])
  for (const done of pendingGit.splice(0)) done(null)
  await vi.waitFor(() => expect(pendingGit).toHaveLength(1))
  expect(db.getProviderSession(threadId, 'codex', 'escopo')).toBe(session)
  expect(sessionsAtSummary).toEqual([session, session])
  expect(executed).toEqual([])
  for (const done of pendingGit.splice(0)) done(null)
  await vi.waitFor(() => expect(executed).toEqual(['Seguinte']))
  expect(executed).not.toContain('Cancelada')
  expect(db.getTask(task.id)?.status).toBe('cancelled')
  expect(db.getTask(next.id)?.status).toBe('completed')

  queue.close()
  db.close()
})
