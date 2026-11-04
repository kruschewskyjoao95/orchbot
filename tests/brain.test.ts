import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseBrainDirectives,
  parsePageDraft,
  stripBrainDirectives,
  unconfirmedHeadings,
} from '../src/backend/brain/brain-protocol'
import { BrainService } from '../src/backend/brain/brain-service'
import { buildMemoryInstructions } from '../src/backend/memory/memory-protocol'
import type { ProviderRegistry } from '../src/backend/providers/registry'
import type { ProviderAdapter } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { Agent } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

const PAGE = [
  'slug: tom',
  'title: Tom de voz',
  'reason: a pessoa descreveu',
  'source: conversa',
  '---',
  '# Tom',
  '## Voz <!-- não confirmado -->',
  'curto e direto',
].join('\n')

describe('cérebro do projeto', () => {
  let db: OrchbotDatabase
  let brain: BrainService
  let projectId: string
  let worker: Agent
  let leader: Agent

  beforeEach(() => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    brain = new BrainService(db)
    projectId = db.createProject({ name: 'Loja' }).id
    worker = db.createAgent({
      name: 'Redator',
      role: 'worker',
      projectId,
      provider: 'codex',
      model: 'gpt',
      workspacePath: '/tmp/brain',
    })
    leader = db.createAgent({
      name: 'Líder',
      role: 'orchestrator',
      projectId,
      provider: 'codex',
      model: 'gpt',
      workspacePath: '/tmp/brain',
    })
  })

  it('separa fato da empresa da memória do robô', () => {
    const memory = buildMemoryInstructions()
    expect(memory).toContain('NÃO entra em [[MEMORY:remember]]')
    expect(memory).not.toContain('convenção do projeto')
    const workerRules = brain.contextSection(worker) ?? ''
    const leaderRules = brain.contextSection(leader) ?? ''
    expect(workerRules).toContain('[[BRAIN:propose]]')
    expect(workerRules).not.toContain('[[BRAIN:write]]')
    expect(workerRules).toContain('colegas')
    expect(leaderRules).toContain('[[BRAIN:write]]')
    expect(leaderRules).toContain('[[BRAIN:decide]]')
    expect(brain.contextSection({ ...worker, projectId: undefined })).toBeNull()
  })

  it('parseia página, link e seção não confirmada', () => {
    const text = 'ok [[BRAIN:read]] company [[/BRAIN]] [[BRAIN:foo]]x[[/BRAIN]]'
    expect(parseBrainDirectives(text).map((d) => d.action)).toEqual(['read'])
    expect(stripBrainDirectives(text)).toBe('ok')
    const draft = parsePageDraft(PAGE)
    expect(draft).toMatchObject({ slug: 'tom', title: 'Tom de voz' })
    expect(unconfirmedHeadings('## Voz <!-- não confirmado -->\ntexto')).toEqual(['Voz'])
    expect(unconfirmedHeadings('texto <!-- não confirmado -->')).toEqual([])
  })

  it('colega propõe e não grava; líder grava e aceita', () => {
    const proposed = brain.run(worker, [{ action: 'propose', body: PAGE }])
    expect(proposed.lines[0]).toContain('proposta')
    expect(proposed.lines[0]).toContain('não mudou')
    expect(proposed.followUp).toBe(false)
    expect(brain.listPages(projectId)).toHaveLength(0)

    const refused = brain.run(worker, [{ action: 'write', body: PAGE }])
    expect(refused.lines[0]).toContain('recusada')
    expect(brain.listPages(projectId)).toHaveLength(0)

    const written = brain.run(leader, [
      {
        action: 'write',
        body: [
          'slug: company',
          'title: Empresa',
          'type: company',
          '---',
          '# Empresa',
          'vende café',
        ].join('\n'),
      },
    ])
    expect(written.lines[0]).toContain('gravada')
    expect(brain.listPages(projectId)[0]).toMatchObject({ slug: 'company', type: 'company' })

    const open = brain.listProposals(projectId)
    expect(open).toHaveLength(1)
    expect(open[0].unconfirmed).toEqual(['Voz'])
    const accepted = brain.run(leader, [
      { action: 'decide', body: `${open[0].id.slice(0, 8)} aceitar` },
    ])
    expect(accepted.lines[0]).toContain('aceita')
    const page = brain.listPages(projectId).find((item) => item.slug === 'tom')
    expect(page?.content).toContain('curto e direto')
    expect(page?.unconfirmed).toEqual(['Voz'])
    expect(brain.listProposals(projectId)).toHaveLength(0)

    brain.run(worker, [{ action: 'propose', body: PAGE.replace('curto e direto', 'outra versão') }])
    const again = brain.listProposals(projectId)[0]
    brain.decide(again.id, false)
    expect(brain.listPages(projectId).find((item) => item.slug === 'tom')?.content).toContain(
      'curto e direto',
    )
  })

  it('busca e lê só o próprio projeto', () => {
    brain.savePage({
      projectId,
      slug: 'company',
      title: 'Empresa',
      type: 'company',
      content: '# Empresa\nvende café para escritórios',
      replace: true,
    })
    const other = db.createProject({ name: 'Outra' }).id
    brain.savePage({
      projectId: other,
      slug: 'company',
      title: 'Outra',
      content: 'vende pneus',
      replace: true,
    })
    const found = brain.run(worker, [{ action: 'search', body: 'café' }])
    expect(found.followUp).toBe(true)
    expect(found.lines[0]).toContain('[[company]]')
    expect(found.lines[0]).not.toContain('pneus')
    const read = brain.run(worker, [{ action: 'read', body: 'company' }])
    expect(read.lines[0]).toContain('escritórios')
    expect(brain.contextSection(worker)).toContain('vende café')
    expect(brain.contextSection(worker)).not.toContain('pneus')
  })

  it('a pessoa grava e apaga pela mesma porta', () => {
    const page = brain.savePage({ projectId, title: 'Preços', content: '# Preços\n10 reais' })
    expect(page.slug).toBe('precos')
    expect(() => brain.savePage({ projectId, title: 'Preços', content: 'de novo' })).toThrow(
      /Já existe/,
    )
    brain.savePage({
      projectId,
      slug: page.slug,
      title: 'Preços',
      content: '# Preços\n12 reais',
      replace: true,
    })
    expect(brain.deletePage(projectId, page.slug)).toBe(true)
    expect(brain.listPages(projectId)).toHaveLength(0)
  })
})

describe('cérebro no turno', () => {
  let db: OrchbotDatabase | undefined
  let queue: QueueManager | undefined

  afterEach(() => {
    queue?.close()
    db?.close()
  })

  function scripted(reply: (prompt: string) => string) {
    const prompts: string[] = []
    const instructions: string[] = []
    const adapter: ProviderAdapter = {
      id: 'codex',
      name: 'Mock',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (prompt, options, callbacks) => {
        prompts.push(prompt)
        instructions.push(options.instructions ?? '')
        setTimeout(() => callbacks.onDone(reply(prompt)), 1)
        return { interrupt: () => {} }
      },
    }
    const registry = {
      getAdapter: () => adapter,
      registerActiveExecution() {},
      removeActiveExecution() {},
      interruptThread: () => true,
    } as unknown as ProviderRegistry
    const database = new OrchbotDatabase(':memory:', testSecretStorage)
    const manager = new QueueManager(database, registry)
    db = database
    queue = manager
    return { prompts, instructions, database, manager }
  }

  it('tira o bloco da resposta e não grava quando o colega propõe', async () => {
    const { prompts, instructions, database, manager } = scripted(
      () => `Anotei o tom.\n[[BRAIN:propose]]\n${PAGE}\n[[/BRAIN]]`,
    )
    const projectId = database.createProject({ name: 'Loja' }).id
    const worker = database.createAgent({
      name: 'Redator',
      role: 'worker',
      projectId,
      provider: 'codex',
      model: 'gpt',
      workspacePath: '/tmp/brain',
    })
    const thread = database.listThreads(worker.id)[0].id
    manager.enqueue(worker.id, thread, 'guarda o tom')
    await vi.waitFor(() => expect(prompts).toHaveLength(1))
    await vi.waitFor(() =>
      expect(database.listMessages(thread).some((m) => m.role === 'system')).toBe(true),
    )
    const visible = database.listMessages(thread).find((m) => m.role === 'assistant')
    expect(visible?.text).toBe('Anotei o tom.')
    expect(instructions[0]).toContain('[CÉREBRO DO PROJETO]')
    expect(instructions[0]).toContain('NÃO entra em [[MEMORY:remember]]')
    expect(manager.brain.listPages(projectId)).toHaveLength(0)
    expect(manager.brain.listProposals(projectId)).toHaveLength(1)
  })

  it('devolve a página lida num turno seguinte', async () => {
    const { prompts, database, manager } = scripted((prompt) =>
      prompt.startsWith('[RESULTADO DO CÉREBRO]')
        ? 'A empresa vende café.'
        : '[[BRAIN:read]] company [[/BRAIN]]',
    )
    const projectId = database.createProject({ name: 'Loja' }).id
    manager.brain.savePage({
      projectId,
      slug: 'company',
      title: 'Empresa',
      type: 'company',
      content: 'vende café',
      replace: true,
    })
    const worker = database.createAgent({
      name: 'Redator',
      role: 'worker',
      projectId,
      provider: 'codex',
      model: 'gpt',
      workspacePath: '/tmp/brain',
    })
    manager.enqueue(worker.id, database.listThreads(worker.id)[0].id, 'o que vendemos?')
    await vi.waitFor(() => expect(prompts).toHaveLength(2))
    expect(prompts[1]).toContain('vende café')
    expect(prompts[1]).toContain('[RESULTADO DO CÉREBRO]')
  })
})
