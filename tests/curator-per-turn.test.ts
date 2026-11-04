import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderRegistry } from '../src/backend/providers/registry'
import type { ProviderAdapter } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

describe('curador depois de cada turno da pessoa', () => {
  let db: OrchbotDatabase
  let queue: QueueManager
  afterEach(() => {
    queue?.close()
    db?.close()
  })

  const boot = (curatorReply: string) => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    const curated: string[] = []
    const turns: string[] = []
    const adapter: ProviderAdapter = {
      id: 'codex',
      name: 'Mock',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, _options, callbacks) => {
        const isCurator = prompt.includes('curador da memória')
        ;(isCurator ? curated : turns).push(prompt)
        setTimeout(() => callbacks.onDone(isCurator ? curatorReply : 'Certo.'), 1)
        return { interrupt: () => {} }
      },
    }
    const registry = {
      getAdapter: () => adapter,
      registerActiveExecution() {},
      removeActiveExecution() {},
      interruptThread: () => true,
    } as unknown as ProviderRegistry
    queue = new QueueManager(db, registry)
    const agent = db.createAgent({
      name: 'Ana',
      provider: 'codex',
      model: 'gpt',
      workspacePath: '/tmp/orchbot-curator-turn',
    })
    const thread = db.listThreads(agent.id)[0].id
    const say = (text: string, fromPerson: boolean) => {
      db.addMessage(thread, 'user', text)
      const task = queue.enqueue(agent.id, thread, text)
      if (fromPerson) queue.markFromPerson(task.id)
    }
    return { curated, turns, agent, thread, say }
  }

  it('cada mensagem da pessoa passa pelo curador; o resto não', async () => {
    const { curated, turns, agent, say } = boot(
      '{"fact":{"text":"Prefere respostas curtas","kind":"preference"},"forget":[]}',
    )
    say('prefiro respostas curtas', true)
    await vi.waitFor(() => expect(curated).toHaveLength(1))
    await vi.waitFor(() =>
      expect(db.listMemories(agent.id).map((m) => m.text)).toEqual(['Prefere respostas curtas']),
    )
    expect(curated[0]).toContain('prefiro respostas curtas')

    say('[RESULTADO DO ESPECIALISTA Bruno] pronto', false)
    await vi.waitFor(() => expect(turns).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 30))
    expect(curated).toHaveLength(1)

    say('e manda em tópicos', true)
    await vi.waitFor(() => expect(curated).toHaveLength(2))
  })

  it('revisão sem mudança não posta aviso na conversa', async () => {
    const { curated, thread, say } = boot('{"forget":[]}')
    say('oi', true)
    await vi.waitFor(() => expect(curated).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(db.listMessages(thread).some((m) => m.text.startsWith('🧠'))).toBe(false)
  })
})
