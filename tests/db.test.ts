import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { validateCreateAgentInput } from '../src/shared/types'

describe('Orchbot Database and Persistence', () => {
  let db: OrchbotDatabase

  beforeEach(() => {
    db = new OrchbotDatabase(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('deve inicializar tabelas e retornar lista vazia de agentes', () => {
    const agents = db.listAgents()
    expect(agents).toEqual([])
  })

  it('deve criar um agente e persistir no banco', () => {
    const input = validateCreateAgentInput({
      name: 'Agente de Teste',
      provider: 'codex',
      model: 'gpt-4o',
      workspacePath: '/tmp/test-workspace',
      instructions: 'Instruções de teste',
    })

    const agent = db.createAgent(input)
    expect(agent.id).toBeDefined()
    expect(agent.name).toBe('Agente de Teste')
    expect(agent.provider).toBe('codex')

    const list = db.listAgents()
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(agent.id)

    // Verifica se a thread inicial foi criada automaticamente
    const threads = db.listThreads(agent.id)
    expect(threads.length).toBe(1)
    expect(threads[0].title).toBe('Conversa Inicial')
  })

  it('deve recuperar agente por id', () => {
    const input = validateCreateAgentInput({
      name: 'Agente 2',
      provider: 'claude',
      model: 'claude-3-7-sonnet',
      workspacePath: '/tmp/workspace-2',
    })

    const created = db.createAgent(input)
    const fetched = db.getAgent(created.id)
    expect(fetched).not.toBeNull()
    expect(fetched?.name).toBe('Agente 2')
    expect(fetched?.provider).toBe('claude')
  })

  it('deve deletar um agente em cascata', () => {
    const input = validateCreateAgentInput({
      name: 'Agente Deletável',
      provider: 'codex',
      model: 'gpt-4o-mini',
      workspacePath: '/tmp/del',
    })

    const created = db.createAgent(input)
    expect(db.listAgents().length).toBe(1)

    const ok = db.deleteAgent(created.id)
    expect(ok).toBe(true)
    expect(db.listAgents().length).toBe(0)
    expect(db.listThreads(created.id).length).toBe(0)
  })
})
