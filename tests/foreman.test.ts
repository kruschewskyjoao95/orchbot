import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrainService } from '../src/backend/brain/brain-service'
import { MemoryService } from '../src/backend/memory/memory-service'
import {
  FOREMAN_INSTRUCTIONS,
  FOREMAN_NAME,
  ensureForeman,
  withForemanProject,
} from '../src/backend/orchestration/foreman'
import { teamForOrchestrator } from '../src/backend/orchestration/protocol'
import { SkillService } from '../src/backend/skills/skill-service'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

describe('coordenador fixo', () => {
  let db: OrchbotDatabase
  let skillsDir: string

  afterEach(() => {
    db?.close()
    if (skillsDir) fs.rmSync(skillsDir, { recursive: true, force: true })
  })

  it('reescreve no boot e esquece preferência, skill, agenda e conta', () => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-skills-'))
    const skills = new SkillService(db, skillsDir)
    const project = db.createProject({ name: 'Loja' })
    const account = db.createProviderAccount({
      providerId: 'codex',
      label: 'Pessoal',
      authMode: 'api_key',
      apiKey: 'sk-test-foreman',
    })
    const hired = db.createAgent({
      name: 'Líder da Equipe',
      role: 'orchestrator',
      description: 'um colega',
      projectId: project.id,
      provider: 'codex',
      model: 'gpt',
      accountId: account.id,
      instructions: 'eu lembro de tudo',
      workspacePath: '/tmp/foreman',
    })
    db.addMemory(hired.id, 'gosta de café')
    db.setAgentSkills(hired.id, ['manual'])
    db.createScheduledTask({
      agentId: hired.id,
      title: 'Resumo',
      prompt: 'resuma o dia',
      cronExpression: '0 9 * * *',
      taskType: 'routine',
    })
    const server = db.saveMcpServer({ name: 'eco', transport: 'stdio', command: 'echo' })
    db.setAgentMcp(hired.id, [server.id])
    db.createSkillProposal({
      agentId: hired.id,
      slug: 'publicar',
      name: 'Publicar',
      description: 'sobe a versão',
      body: 'passos',
    })
    const thread = db.createThread(hired.id, 'Pedido', project.id)
    db.markForeman(hired.id)

    const fixed = ensureForeman(db)
    expect(fixed?.id).toBe(hired.id)
    expect(fixed).toMatchObject({
      name: FOREMAN_NAME,
      systemRole: 'foreman',
      role: 'orchestrator',
      instructions: FOREMAN_INSTRUCTIONS,
      browserAccess: false,
      computerUse: false,
    })
    expect(fixed?.accountId).toBeUndefined()
    expect(fixed?.projectId).toBeUndefined()
    expect(db.listMemories(hired.id)).toEqual([])
    expect(db.listAgentSkills(hired.id)).toEqual([])
    expect(db.listScheduledTasks(hired.id)).toEqual([])
    expect(db.listAgentMcp(hired.id)).toEqual([])
    expect(db.listSkillProposals()).toEqual([])
    expect(db.listSkillProposals('dismissed').map((p) => p.slug)).toEqual(['publicar'])
    expect(db.listThreads(hired.id).some((t) => t.id === thread.id)).toBe(true)

    expect(ensureForeman(db)?.id).toBe(hired.id)
    expect(db.listThreads(hired.id).some((t) => t.id === thread.id)).toBe(true)

    expect(() => db.addMemory(hired.id, 'de novo')).toThrow(/preferência/)
    expect(() => db.setAgentSkills(hired.id, ['manual'])).toThrow(/skill/)
    expect(() => db.setAgentMcp(hired.id, [server.id])).toThrow(/conector/)
    expect(() =>
      db.createScheduledTask({
        agentId: hired.id,
        title: 'Outra',
        prompt: 'x',
        cronExpression: '0 9 * * *',
        taskType: 'routine',
      }),
    ).toThrow(/agenda/)
    expect(() =>
      db.createSkillProposal({
        agentId: hired.id,
        slug: 'outra',
        name: 'Outra',
        description: 'd',
        body: 'b',
      }),
    ).toThrow(/skill/)
    expect(() => db.deleteAgent(hired.id)).toThrow(/não sai/)
    expect(() => db.updateAgent({ id: hired.id, role: 'worker' })).toThrow(/colega/)
    expect(() => db.updateAgent({ id: hired.id, instructions: 'outra' })).toThrow(/instruções/)
    expect(() => db.updateAgent({ id: hired.id, accountId: account.id })).toThrow(/conta/)

    const memory = new MemoryService(db)
    expect(
      memory.run(hired.id, [{ kind: 'MEMORY', action: 'remember', body: 'gosta de café' }])[0],
    ).toContain('recusado')
    expect(memory.contextSections(hired.id)[0]).toContain('não guarda')
    expect(
      skills.run(fixed as NonNullable<typeof fixed>, [
        { action: 'create', target: 'x', body: 'd\nb' },
      ])[0],
    ).toContain('recusado')
    expect(skills.contextSection(hired.id)).toContain('não tem skill')
  })

  it('grava o cérebro da pasta da conversa e só vê a equipe dessa pasta', () => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    const project = db.createProject({ name: 'Loja' })
    const other = db.createProject({ name: 'Outra' })
    const foreman = ensureForeman(db)
    expect(foreman).not.toBeNull()
    db.createAgent({
      name: 'Dentro',
      role: 'worker',
      projectId: project.id,
      provider: 'codex',
      model: 'gpt',
      workspacePath: '/tmp/dentro',
    })
    db.createAgent({
      name: 'Fora',
      role: 'worker',
      projectId: other.id,
      provider: 'codex',
      model: 'gpt',
      workspacePath: '/tmp/fora',
    })
    db.createAgent({
      name: 'Outro líder',
      role: 'orchestrator',
      projectId: project.id,
      provider: 'codex',
      model: 'gpt',
      workspacePath: '/tmp/lider',
    })
    const team = teamForOrchestrator(
      withForemanProject(foreman as NonNullable<typeof foreman>, project.id),
      db.listAgents(),
    ).map((a) => a.name)
    expect(team).toEqual(['Dentro'])

    const brain = new BrainService(db)
    const page = 'slug: tom\ntitle: Tom de voz\n---\ncurto e direto'
    const view = withForemanProject(foreman as NonNullable<typeof foreman>, project.id)
    expect(brain.run(view, [{ action: 'write', body: page }]).lines[0]).toContain('gravada')
    expect(db.listBrainPages(project.id).map((p) => p.slug)).toEqual(['tom'])
    expect(
      brain.run(foreman as NonNullable<typeof foreman>, [{ action: 'write', body: page }]).lines[0],
    ).toContain('sem projeto')
    expect(db.getAgent(foreman?.id ?? '')?.projectId).toBeUndefined()
  })
})
