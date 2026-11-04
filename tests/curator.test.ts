import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isProcedure, parseCuratorPlan } from '../src/backend/memory/curator'
import { memoryFreshness } from '../src/backend/memory/decay'
import { MemoryService } from '../src/backend/memory/memory-service'
import type { ProviderAdapter } from '../src/backend/providers/types'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { Agent } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

describe('curador e busca de memória', () => {
  it('separa fato de procedimento no schema', () => {
    expect(isProcedure('1. rode os testes')).toBe(true)
    expect(isProcedure('prefere pnpm')).toBe(false)
    const plan = parseCuratorPlan(
      'ok {"fact":{"text":"1. publique","kind":"task"},"update":{"id":"abc","text":"usa bun"},"forget":["zz"],"skill":{"slug":"Publicar","description":"Quando publicar","body":"1. testes"}} fim',
    )
    expect(plan?.fact).toBeUndefined()
    expect(plan?.update).toEqual({ id: 'abc', text: 'usa bun' })
    expect(plan?.forget).toEqual(['zz'])
    expect(plan?.skill?.slug).toBe('Publicar')
    expect(parseCuratorPlan('sem json')).toBeNull()
    const now = Date.now()
    const week = new Date(now - 7 * 86_400_000).toISOString()
    expect(memoryFreshness('task', week, now)).toBeCloseTo(0.5, 5)
    expect(
      memoryFreshness('preference', new Date(now - 90 * 86_400_000).toISOString(), now),
    ).toBeCloseTo(0.5, 5)
  })

  describe('com banco', () => {
    let db: OrchbotDatabase
    let agentId: string
    let threadId: string

    beforeEach(() => {
      db = new OrchbotDatabase(':memory:', testSecretStorage)
      const agent = db.createAgent({
        name: 'A',
        workspacePath: '/tmp',
        provider: 'codex',
        model: 'gpt',
      } as never)
      agentId = agent.id
      threadId = db.createThread(agentId, 'Conversa').id
    })

    it('a busca fica no agente, atualiza o índice e deixa a tarefa antiga para trás', () => {
      const old = new Date(Date.now() - 40 * 86_400_000).toISOString()
      db.addMemory(agentId, 'tarefa antiga vitest do deploy', 'task', old)
      db.addMemory(agentId, 'preferência atual vitest do cliente', 'preference')
      const other = db.createAgent({
        name: 'B',
        workspacePath: '/tmp',
        provider: 'codex',
        model: 'x',
      } as never)
      db.addMemory(other.id, 'segredo vitest do outro robô', 'preference')
      const hits = db.searchMemories(agentId, 'vitest')
      expect(hits.map((hit) => hit.kind)).toEqual(['preference', 'task'])
      expect(hits.every((hit) => hit.agentId === agentId)).toBe(true)

      const memory = db.addMemory(agentId, 'o projeto usa pnpm hoje')
      expect(db.updateMemory(agentId, memory.id.slice(0, 8), 'o projeto usa bun hoje')).toBe(true)
      expect(db.searchMemories(agentId, 'bun')[0]?.text).toContain('bun')
      expect(db.searchMemories(agentId, 'pnpm')).toEqual([])
    })

    it('o passo do curador grava fato e proposta, e recusa checklist como memória', async () => {
      db.addMessage(threadId, 'user', 'quando for publicar, rode os testes antes')
      db.addMessage(threadId, 'assistant', 'certo')
      const adapter = {
        executeTurn: (
          _prompt: string,
          _options: unknown,
          cb: { onDone: (text: string) => void },
        ) => {
          setTimeout(
            () =>
              cb.onDone(
                '{"fact":{"text":"1. rode os testes\\n2. publique","kind":"task"},"forget":[],"skill":{"slug":"publicar","description":"Como publicar","body":"1. rode os testes\\n2. publique"}}',
              ),
            1,
          )
          return { interrupt() {} }
        },
      }
      const svc = new MemoryService(db)
      const seen: string[] = []
      const agent = db.getAgent(agentId) as Agent
      for (let i = 0; i < 8; i++)
        svc.maybeReview(
          { agent, adapter: adapter as unknown as ProviderAdapter, config: {} },
          threadId,
          (text) => seen.push(text),
        )
      await vi.waitFor(() => expect(seen).toHaveLength(1))
      expect(db.listMemories(agentId)).toEqual([])
      expect(db.listSkillProposals().map((item) => item.slug)).toEqual(['publicar'])
      expect(seen[0]).toContain('Proposta de skill: publicar')
    })
  })
})
