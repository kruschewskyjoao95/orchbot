import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    expect(
      svc.run(agentId, [{ kind: 'MEMORY', action: 'remember', body: '1. rode os testes' }])[0],
    ).toContain('não memorizado')
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

  it('interrompe o resumo e não apaga a sessão se o turno for cancelado', async () => {
    const session = '11111111-2222-4333-8444-555555555555'
    for (let i = 0; i < 9; i++) db.addMessage(threadId, i % 2 ? 'assistant' : 'user', `m${i}`)
    const last = db.addMessage(threadId, 'assistant', 'resposta curta')
    db.saveProviderSession(threadId, 'codex', 'escopo', session)
    db.setMessageUsage(
      last.id,
      { inputTokens: 150000, outputTokens: 100, contextTokens: 150100, contextWindow: 200000 },
      session,
    )
    let interrupted = false
    const ctrl = new AbortController()
    const adapter = {
      supportsSessionResume: true,
      executeTurn: () => ({
        interrupt: () => {
          interrupted = true
        },
      }),
    }
    const pending = svc.compactIfNeeded(
      { agent: db.getAgent(agentId) as Agent, adapter: adapter as never, config: {} },
      threadId,
      '9999',
      'escopo',
      { signal: ctrl.signal },
    )
    ctrl.abort()
    await expect(pending).resolves.toBeUndefined()
    expect(interrupted).toBe(true)
    expect(db.getThreadSummary(threadId)).toBeUndefined()
    expect(db.getProviderSession(threadId, 'codex', 'escopo')).toBe(session)
  })

  it('não grava o resumo se o cancelamento chega depois do modelo e antes da gravação', async () => {
    const session = '11111111-2222-4333-8444-555555555555'
    for (let i = 0; i < 9; i++) db.addMessage(threadId, i % 2 ? 'assistant' : 'user', `m${i}`)
    const last = db.addMessage(threadId, 'assistant', 'resposta curta')
    db.saveProviderSession(threadId, 'codex', 'escopo', session)
    db.setMessageUsage(
      last.id,
      { inputTokens: 150000, outputTokens: 100, contextTokens: 150100, contextWindow: 200000 },
      session,
    )
    let releaseReady = () => {}
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve
    })
    let modelDone = false
    const ctrl = new AbortController()
    const adapter = {
      supportsSessionResume: true,
      executeTurn: (_p: string, _o: unknown, cb: { onDone: (text: string) => void }) => {
        queueMicrotask(() => {
          modelDone = true
          cb.onDone('resumo que não pode ser gravado')
        })
        return { interrupt: () => {} }
      },
    }
    const pending = svc.compactIfNeeded(
      { agent: db.getAgent(agentId) as Agent, adapter: adapter as never, config: {} },
      threadId,
      '9999',
      'escopo',
      { signal: ctrl.signal, ready },
    )
    await vi.waitFor(() => expect(modelDone).toBe(true))
    await Promise.resolve()
    ctrl.abort()
    releaseReady()
    await expect(pending).resolves.toBeUndefined()
    expect(db.getThreadSummary(threadId)).toBeUndefined()
    expect(db.getProviderSession(threadId, 'codex', 'escopo')).toBe(session)
  })

  it('estima tokens e janela', () => {
    expect(estimateTokens('a'.repeat(36))).toBe(10)
    expect(contextWindowFor('gemini-3.8-pro')).toBe(1_000_000)
  })
})
