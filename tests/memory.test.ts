import { beforeEach, describe, expect, it } from 'vitest'
import { buildThreadContext } from '../src/backend/context/context-builder'
import { parseMemoryDirectives, stripMemoryDirectives } from '../src/backend/memory/memory-protocol'
import { MemoryService } from '../src/backend/memory/memory-service'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { contextWindowFor, estimateTokens } from '../src/shared/tokens'
import type { Agent } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

describe('memória, histórico e compactação locais', () => {
  let db: OrchbotDatabase
  let svc: MemoryService
  let agentId: string
  let threadId: string

  beforeEach(() => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    const agent = db.createAgent({
      name: 'A',
      workspacePath: '/tmp',
      provider: 'codex',
      model: 'gpt-6.1-sol',
    } as never)
    agentId = agent.id
    threadId = db.createThread(agentId, 'Conversa').id
    svc = new MemoryService(db)
  })

  it('parseia e remove blocos', () => {
    const t =
      'ok [[MEMORY:remember]] usa pnpm [[/MEMORY]] [[HISTORY:read]] abc [[/HISTORY]] [[MEMORY:foo]]x[[/MEMORY]]'
    expect(parseMemoryDirectives(t).map((d) => d.action)).toEqual(['remember', 'read'])
    expect(stripMemoryDirectives(t)).toBe('ok')
  })

  it('remember, search e forget por prefixo de id', () => {
    const [r] = svc.run(agentId, [
      { kind: 'MEMORY', action: 'remember', body: 'Projeto usa pnpm e vitest' },
    ])
    expect(r).toContain('memorizado')
    const id = db.listMemories(agentId)[0].id
    expect(svc.run(agentId, [{ kind: 'MEMORY', action: 'search', body: 'vitest' }])[0]).toContain(
      id.slice(0, 8),
    )
    expect(svc.contextSections(agentId).join()).toContain('pnpm')
    expect(
      svc.run(agentId, [{ kind: 'MEMORY', action: 'forget', body: id.slice(0, 8) }])[0],
    ).toContain('esquecido')
    expect(db.listMemories(agentId)).toHaveLength(0)
  })

  it('history search/read só enxerga o próprio agente', () => {
    const m = db.addMessage(threadId, 'user', 'a chave do deploy fica no cofre zebra')
    db.addMessage(threadId, 'assistant', 'anotado')
    const [s] = svc.run(agentId, [{ kind: 'HISTORY', action: 'search', body: 'zebra' }])
    expect(s).toContain(m.id.slice(0, 8))
    expect(
      svc.run(agentId, [{ kind: 'HISTORY', action: 'read', body: m.id.slice(0, 8) }])[0],
    ).toContain('anotado')
    const other = db.createAgent({
      name: 'B',
      workspacePath: '/tmp',
      provider: 'codex',
      model: 'x',
    } as never)
    expect(svc.run(other.id, [{ kind: 'HISTORY', action: 'read', body: m.id }])[0]).toContain(
      'não encontrada',
    )
  })

  it('compacta com fallback extrativo e passa o resumo ao contexto', async () => {
    for (let i = 0; i < 40; i++)
      db.addMessage(threadId, i % 2 ? 'assistant' : 'user', `mensagem ${i}`)
    const adapter = {
      supportsSessionResume: false,
      executeTurn: () => {
        throw new Error('sem modelo')
      },
    }
    const notice = await svc.compactIfNeeded(
      { agent: db.getAgent(agentId) as Agent, adapter: adapter as never, config: {} },
      threadId,
      '9999',
    )
    expect(notice).toContain('compactado')
    const saved = db.getThreadSummary(threadId) as { summary: string }
    expect(saved.summary).toContain('mensagem 0')
    expect(svc.activeMessages(threadId, '9999')).toHaveLength(6)
    expect(buildThreadContext([], 'padrao', saved.summary).text).toContain('RESUMO COMPACTADO')
  })

  it('estima tokens e janela', () => {
    expect(estimateTokens('a'.repeat(36))).toBe(10)
    expect(contextWindowFor('gemini-3.8-pro')).toBe(1_000_000)
  })
})
