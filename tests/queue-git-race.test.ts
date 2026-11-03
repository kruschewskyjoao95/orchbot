import { expect, it, vi } from 'vitest'
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
