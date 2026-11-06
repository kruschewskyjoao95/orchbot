import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { draftAgent } from '../src/backend/collaboration/agent-drafter'
import {
  parseCollabDirectives,
  stripCollabDirectives,
} from '../src/backend/collaboration/collab-protocol'
import {
  CollaborationService,
  channelWorkspace,
} from '../src/backend/collaboration/collaboration-service'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { Agent } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

describe('colaboração entre agentes e canais', () => {
  let db: OrchbotDatabase
  let svc: CollaborationService
  let enq: Array<{ agentId: string; prompt: string; depth: number; origin?: unknown }>
  let cancelled: string[]
  let ws: string
  let a: Agent
  let b: Agent
  let c: Agent

  const mk = (name: string, workspacePath: string, projectId?: string) =>
    db.createAgent({ name, workspacePath, provider: 'codex', model: 'x', projectId } as never)

  beforeEach(() => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    enq = []
    cancelled = []
    svc = new CollaborationService(db, {
      enqueue: (agentId, _t, prompt, depth, origin) => enq.push({ agentId, prompt, depth, origin }),
      cancelTask: (id) => !!cancelled.push(id),
    })
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-'))
    fs.mkdirSync(path.join(ws, 'a'))
    fs.mkdirSync(path.join(ws, 'b'))
    a = mk('Ana', path.join(ws, 'a'))
    b = mk('Bruno', path.join(ws, 'b'))
    c = mk('Carla', ws)
  })

  const ctx = (agent: Agent, depth = 1) => ({ threadId: db.listThreads(agent.id)[0].id, depth })
  const run = (agent: Agent, text: string, depth = 1) =>
    svc.run(agent, ctx(agent, depth), parseCollabDirectives(text))

  it('parseia blocos e ignora inválidos', () => {
    const t =
      'ok [[AGENT:send]] Bruno :: oi [[/AGENT]] [[AGENT:list]] [[/AGENT]] [[AGENT:send]] sem separador [[/AGENT]] [[AGENT:x]]y[[/AGENT]]'
    expect(parseCollabDirectives(t).map((d) => d.action)).toEqual(['send', 'list'])
    expect(stripCollabDirectives(t)).toBe('ok')
  })

  it('send entrega, enfileira e permite responder e reagir', () => {
    const { lines } = run(a, '[[AGENT:send]] Bruno :: revise o PR [[/AGENT]]')
    expect(lines[0]).toContain('enviado a Bruno')
    expect(enq).toHaveLength(1)
    expect(enq[0]).toMatchObject({ agentId: b.id, depth: 2 })
    const id = /id (\w{8})/.exec(enq[0].prompt)?.[1] as string

    run(b, `[[AGENT:react]] ${id} :: 👍 [[/AGENT]]`)
    const sys = db.listMessages(db.listThreads(a.id)[0].id).find((m) => m.role === 'system')
    expect(sys?.text).toContain('👍 Bruno reagiu')
    expect(enq).toHaveLength(1) // reação não gasta turno

    const r = run(b, `[[AGENT:reply]] ${id} :: feito [[/AGENT]]`, 2)
    expect(r.lines[0]).toContain('resposta enviada a Ana')
    expect(enq[1]).toMatchObject({ agentId: a.id, depth: 3 })
    expect(run(c, `[[AGENT:reply]] ${id} :: intruso [[/AGENT]]`).lines[0]).toContain(
      'não encontrada',
    )
  })

  it('entrega mensagens diretas na conversa mais recente do destinatário', () => {
    const recent = db.createThread(b.id, 'Nova')
    run(a, '[[AGENT:send]] Bruno :: oi [[/AGENT]]')
    expect(db.listMessages(recent.id).some((m) => m.text === 'oi')).toBe(true)
  })

  it('o dono do canal pode pedir novas etapas depois do primeiro retorno', () => {
    const ch = svc.createChannel({ title: 'Etapas', ownerAgentId: a.id, memberIds: [b.id] })
    const ownerThread = ch.members.find((m) => m.agentId === a.id)?.threadId as string
    const ask = (depth: number) =>
      svc.run(
        a,
        { threadId: ownerThread, depth },
        parseCollabDirectives('[[CHANNEL:ask]] Bruno :: etapa [[/CHANNEL]]'),
      ).lines[0]
    expect(ask(3)).toContain('pedido enviado')
    expect(ask(8)).toContain('limite')
  })

  it('limita o encadeamento e respeita projetos', () => {
    expect(run(a, '[[AGENT:send]] Bruno :: x [[/AGENT]]', 3).lines[0]).toContain('limite')
    const p = db.createProject({ name: 'P', path: ws } as never)
    const d = mk('Dora', ws, p.id)
    expect(run(d, '[[AGENT:list]] [[/AGENT]]').lines[0]).toContain('nenhum outro')
    expect(run(d, '[[AGENT:send]] Ana :: oi [[/AGENT]]').lines[0]).toContain('não encontrado')
  })

  it('transfere arquivos só de dentro do workspace', () => {
    fs.writeFileSync(path.join(ws, 'a', 'dados.txt'), 'olá')
    expect(run(a, '[[AGENT:file]] Bruno :: dados.txt [[/AGENT]]').lines[0]).toContain(
      'entregue a Bruno',
    )
    expect(
      fs.readFileSync(path.join(ws, 'b', '.orchbot', 'inbox', 'Ana', 'dados.txt'), 'utf8'),
    ).toBe('olá')
    fs.writeFileSync(path.join(ws, 'a', 'dados.txt'), 'nova versão')
    run(a, '[[AGENT:file]] Bruno :: dados.txt [[/AGENT]]')
    const inbox = path.join(ws, 'b', '.orchbot', 'inbox', 'Ana')
    expect(fs.readFileSync(path.join(inbox, 'dados.txt'), 'utf8')).toBe('olá')
    expect(fs.readFileSync(path.join(inbox, 'dados (2).txt'), 'utf8')).toBe('nova versão')
    expect(
      run(a, '[[AGENT:file]] Bruno :: ../b/.orchbot/inbox/Ana/dados.txt [[/AGENT]]').lines[0],
    ).toContain('dentro do seu workspace')
    fs.symlinkSync('/etc/hostname', path.join(ws, 'a', 'link'))
    expect(run(a, '[[AGENT:file]] Bruno :: link [[/AGENT]]').lines[0]).toContain(
      'dentro do seu workspace',
    )
  })

  it('ciclo do canal: dono, ask, parar, retomar, reatribuir, arquivar e restaurar', () => {
    const ch = svc.createChannel({
      title: 'Lançamento',
      goal: 'Publicar v2',
      ownerAgentId: a.id,
      memberIds: [b.id],
    })
    expect(ch.members).toHaveLength(2)
    svc.post(ch.id, 'comecem')
    expect(enq[0]).toMatchObject({ agentId: a.id, depth: 1 })

    const ownerThread = ch.members.find((m) => m.agentId === a.id)?.threadId as string
    const out = svc.run(
      a,
      { threadId: ownerThread, depth: 1 },
      parseCollabDirectives('[[CHANNEL:ask]] Bruno :: faça o build [[/CHANNEL]]'),
    )
    expect(out.lines[0]).toContain('pedido enviado a Bruno')
    expect(enq[1]).toMatchObject({
      agentId: b.id,
      depth: 2,
      origin: { originThreadId: ownerThread, originAgentId: a.id },
    })
    expect(svc.contextSections(a, ownerThread).join()).toContain('DONO da tarefa')

    db.enqueueTask(b.id, ch.members[1].threadId, 'tarefa', 1)
    svc.stop(ch.id)
    expect(cancelled).toHaveLength(1)
    expect(() => svc.post(ch.id, 'x')).toThrow('parado')
    expect(
      svc.run(
        a,
        { threadId: ownerThread, depth: 1 },
        parseCollabDirectives('[[CHANNEL:ask]] Bruno :: y [[/CHANNEL]]'),
      ).lines[0],
    ).toContain('parado')

    svc.resume(ch.id)
    expect(svc.reassign(ch.id, c.id).ownerAgentId).toBe(c.id)
    expect(db.getChannel(ch.id)?.members.map((m) => m.agentId)).toContain(c.id)

    svc.archive(ch.id)
    expect(db.listChannels()).toHaveLength(0)
    expect(db.listChannels(true)).toHaveLength(1)
    expect(() => svc.resume(ch.id)).toThrow('Restaure')
    const restored = svc.restore(ch.id)
    expect(restored.archived).toBe(false)
    expect(restored.status).toBe('stopped')
  })

  it('canal injeta instruções e pasta compartilhada no contexto', () => {
    const shared = path.join(ws, 'canal')
    fs.mkdirSync(shared)
    const ch = svc.createChannel({
      title: 'Lançamento',
      goal: 'Publicar v2',
      ownerAgentId: a.id,
      memberIds: [b.id],
      instructions: 'Use o checklist em SHIP.md.',
      workspacePath: shared,
    })
    expect(ch).toMatchObject({
      instructions: 'Use o checklist em SHIP.md.',
      workspacePath: shared,
    })
    const ownerThread = ch.members.find((m) => m.agentId === a.id)?.threadId
    if (!ownerThread) throw new Error('thread do dono ausente')
    const briefing = svc.contextSections(a, ownerThread).join('\n')
    expect(briefing).toContain('Use o checklist em SHIP.md.')
    expect(briefing).toContain(shared)
    expect(channelWorkspace(ch, a.workspacePath)).toBe(shared)
    expect(channelWorkspace({ workspacePath: '  ' }, a.workspacePath)).toBe(a.workspacePath)
  })

  it('rascunho de agente cai no modo local sem provedor disponível', async () => {
    const registry = {
      getAdapter: () => ({ checkAvailability: async () => ({ available: false }) }),
    }
    const draft = await draftAgent(
      db,
      registry as never,
      'Revisor de código que aponta riscos de segurança',
    )
    expect(draft.source).toBe('local')
    expect(draft.name).toBeTruthy()
    expect(draft.instructions).toContain('Revisor')
    await expect(draftAgent(db, registry as never, '  ')).rejects.toThrow()
  })

  it('avatar é salvo na criação e na edição', () => {
    const x = db.createAgent({
      name: 'X',
      workspacePath: ws,
      provider: 'codex',
      model: 'm',
      avatar: '🧪',
    } as never)
    expect(db.getAgent(x.id)?.avatar).toBe('🧪')
    db.updateAgent({ id: x.id, avatar: '🚀' })
    expect(db.getAgent(x.id)?.avatar).toBe('🚀')
  })
})
