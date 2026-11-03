import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseDelegationDirectives,
  resolveDelegations,
  stripDelegationDirectives,
  teamForOrchestrator,
} from '../src/backend/orchestration/protocol'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type { ProviderAdapter } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { SupportedProvider } from '../src/shared/types'

function fakeAdapter(id: SupportedProvider, respond: (prompt: string) => string): ProviderAdapter {
  return {
    id,
    name: id,
    checkAvailability: async () => ({ available: true, version: 'fake' }),
    executeTurn: (prompt, _options, callbacks) => {
      const text = respond(prompt)
      setTimeout(() => {
        callbacks.onChunk(text, text)
        callbacks.onDone(text)
      }, 5)
      return { interrupt: () => {} }
    },
  }
}

describe('Protocolo de orquestração', () => {
  it('extrai blocos de delegação e limpa o texto visível', () => {
    const text =
      'Vou distribuir.\n\n[[DELEGAR:Revisor]]\nRevise o PR 12.\n[[/DELEGAR]]\n[[DELEGAR:Pesquisador]]\nBusque docs.\n[[/DELEGAR]]'
    const directives = parseDelegationDirectives(text)
    expect(directives).toEqual([
      { target: 'Revisor', task: 'Revise o PR 12.' },
      { target: 'Pesquisador', task: 'Busque docs.' },
    ])
    expect(stripDelegationDirectives(text)).toBe('Vou distribuir.')
  })

  it('resolve por nome e monta equipe do mesmo projeto', () => {
    const base = {
      provider: 'codex' as const,
      model: 'm',
      instructions: '',
      workspacePath: '/tmp',
      createdAt: '',
      updatedAt: '',
    }
    const orch = {
      ...base,
      id: 'o1',
      name: 'Chefe',
      role: 'orchestrator' as const,
      projectId: 'p1',
    }
    const worker = { ...base, id: 'w1', name: 'Revisor', role: 'worker' as const, projectId: 'p1' }
    const outsider = { ...base, id: 'w2', name: 'Outro', role: 'worker' as const, projectId: 'p2' }
    const team = teamForOrchestrator(orch, [orch, worker, outsider])
    expect(team.map((a) => a.id)).toEqual(['w1'])
    const { resolved, unknownTargets } = resolveDelegations(
      [
        { target: 'revisor', task: 'x' },
        { target: 'Ninguém', task: 'y' },
      ],
      team,
    )
    expect(resolved[0]?.agent.id).toBe('w1')
    expect(unknownTargets).toEqual(['Ninguém'])
  })
})

describe('Fluxo orquestrador → especialista → resumo', () => {
  let tmpDir: string
  let db: OrchbotDatabase

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-orch-test-'))
    db = new OrchbotDatabase(path.join(tmpDir, 'test.db'))
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('usuário fala com o orquestrador, especialista executa e o orquestrador resume', async () => {
    const project = db.createProject({ name: 'Equipe', workspacePath: tmpDir })
    const orchestrator = db.createAgent({
      name: 'Chefe',
      role: 'orchestrator',
      projectId: project.id,
      provider: 'codex',
      model: 'fake',
      workspacePath: tmpDir,
    })
    db.createAgent({
      name: 'Revisor',
      role: 'worker',
      description: 'Revisa código',
      projectId: project.id,
      provider: 'claude',
      model: 'fake',
      workspacePath: tmpDir,
    })
    expect(orchestrator.role).toBe('orchestrator')

    const registry = new ProviderRegistry()
    registry.registerAdapter(
      fakeAdapter('codex', (prompt) => {
        if (prompt.includes('[RESULTADO DO ESPECIALISTA')) {
          return 'Resumo final para o usuário: revisão concluída sem riscos.'
        }
        // Garante que o protocolo foi injetado nas instruções via roster
        return 'Vou delegar.\n\n[[DELEGAR:Revisor]]\nRevise o arquivo principal.\n[[/DELEGAR]]'
      }),
    )
    registry.registerAdapter(
      fakeAdapter('claude', () => 'Revisão pronta: nenhum risco encontrado.'),
    )

    const queue = new QueueManager(db, registry, {})
    const orchThread = db.listThreads(orchestrator.id)[0]
    if (!orchThread) throw new Error('thread do orquestrador ausente')
    queue.enqueue(orchestrator.id, orchThread.id, 'Revise meu projeto')

    await vi.waitFor(
      () => {
        const messages = db.listMessages(orchThread.id)
        expect(messages.some((m) => m.text.includes('Resumo final para o usuário'))).toBe(true)
      },
      { timeout: 8000, interval: 50 },
    )

    const messages = db.listMessages(orchThread.id)
    // Delegação anunciada e resultado recebido na conversa do orquestrador
    expect(messages.some((m) => m.text.includes('Delegado para Revisor'))).toBe(true)
    expect(messages.some((m) => m.text.includes('Resultado de Revisor recebido'))).toBe(true)
    // Bloco cru de delegação não aparece como mensagem do assistente
    expect(messages.some((m) => m.role === 'assistant' && m.text.includes('[[DELEGAR'))).toBe(false)
    queue.close()
  })
})
