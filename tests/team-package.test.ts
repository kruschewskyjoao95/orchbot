import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_TEAM_PACKAGE_BYTES,
  exportTeamPackage,
  importTeamPackage,
  parseTeamPackage,
} from '../src/backend/collaboration/team-package'
import { SkillService } from '../src/backend/skills/skill-service'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { effectiveCapabilities } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

const sample = () => ({
  format: 'orchbot.team',
  version: 1,
  project: { name: 'Atendimento', description: 'Equipe da loja' },
  agents: [
    {
      key: 'lead',
      name: 'Ana',
      role: 'orchestrator',
      description: 'Coordena',
      avatar: '🤖',
      instructions: 'Coordene o atendimento.',
      skills: ['review'],
    },
    {
      key: 'writer',
      name: 'Bia',
      role: 'worker',
      description: 'Redige',
      avatar: '✍️',
      instructions: 'Escreva respostas.',
      skills: ['review'],
    },
  ],
  skills: [
    { key: 'review', name: 'Revisão', description: 'Ao revisar', body: 'Confira os fatos.' },
  ],
  channels: [
    {
      title: 'Pedidos',
      goal: 'Atender pedidos',
      owner: 'lead',
      members: ['lead', 'writer'],
      instructions: 'Fale com o cliente.',
    },
  ],
})

describe('pacote mínimo de equipe', () => {
  let dir: string
  let root: string
  let db: OrchbotDatabase
  let skills: SkillService
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-team-package-'))
    root = path.join(dir, 'workspaces')
    db = new OrchbotDatabase(path.join(dir, 'test.db'), testSecretStorage)
    skills = new SkillService(db, path.join(dir, 'skills'))
    for (const c of db.listConnections())
      db.updateConnection({ providerId: c.providerId, enabled: false })
    db.updateConnection({ providerId: 'claude', enabled: true, defaultModel: 'modelo-local' })
    db.updateSettings({
      defaultProvider: 'claude',
      defaultLocalScripts: true,
      defaultStartsNewChats: true,
      computerUseEnabled: true,
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const importSample = () => importTeamPackage(db, skills, JSON.stringify(sample()), root)

  it('recria agentes, canais e vínculos de skills usando somente configuração local de execução', () => {
    const project = importSample()
    const agents = db.listAgents().filter((a) => a.projectId === project.id)
    expect(agents.map((a) => a.name).sort()).toEqual(['Ana', 'Bia'])
    expect(agents.map((a) => a.id)).not.toContain('lead')
    for (const agent of agents) {
      expect(agent).toMatchObject({
        provider: 'claude',
        model: 'modelo-local',
        autonomyLevel: 'cautious',
        browserAccess: false,
      })
      expect(agent.accountId).toBeUndefined()
      expect(agent.handoffAgentId).toBeUndefined()
      expect(agent.systemRole).toBeUndefined()
      expect(db.listAgentMcp(agent.id)).toEqual([])
      expect(db.listTasks(agent.id)).toEqual([])
      expect(db.listAgentSkills(agent.id)).toEqual(['revisao'])
      expect(effectiveCapabilities(agent, db.getSettings())).toMatchObject({
        localScripts: false,
        startsNewChats: false,
        computerUse: false,
        showPlanBeforeLongTasks: true,
      })
      expect(agent.workspacePath.startsWith(`${project.workspacePath}${path.sep}`)).toBe(true)
      expect(fs.existsSync(agent.workspacePath)).toBe(true)
    }
    expect(new Set(agents.map((a) => a.workspacePath)).size).toBe(2)
    const [channel] = db.listChannels()
    expect(channel).toMatchObject({
      title: 'Pedidos',
      goal: 'Atender pedidos',
      status: 'stopped',
      projectId: project.id,
      instructions: 'Fale com o cliente.',
      workspacePath: '',
    })
    expect(db.getAgent(channel.ownerAgentId ?? '')?.name).toBe('Ana')
    expect(channel.members.map((m) => m.agentId).sort()).toEqual(agents.map((a) => a.id).sort())
    expect(db.listChannelMessages(channel.id)).toHaveLength(1)
    expect(skills.get('revisao').body).toBe('Confira os fatos.')
    expect(db.listScheduledTasks()).toEqual([])
  })

  it('exporta e reimporta a composição sem IDs locais, caminhos, contas, permissões ou histórico', () => {
    const first = importSample()
    const agent = db.listAgents().find((a) => a.name === 'Ana')
    if (!agent) throw new Error('fixture sem agente')
    const account = db.createProviderAccount({
      providerId: 'claude',
      label: 'Privada',
      authMode: 'api_key',
      apiKey: 'segredo-da-conta',
    })
    db.updateAgent({
      id: agent.id,
      accountId: account.id,
      browserAccess: true,
      computerUse: true,
      autonomyLevel: 'autonomous',
    })
    db.addMemory(agent.id, 'Memória privada', 'preference')
    db.addMessage(db.listThreads(agent.id)[0].id, 'user', 'Conversa privada')
    fs.writeFileSync(path.join(dir, 'skills', 'revisao', 'script.sh'), 'NÃO EXPORTAR SCRIPT')
    const source = exportTeamPackage(db, skills, first.id)
    for (const forbidden of [
      agent.id,
      account.id,
      dir,
      'segredo-da-conta',
      'Memória privada',
      'Conversa privada',
      'NÃO EXPORTAR SCRIPT',
      'accountId',
      'provider',
      'model',
      'autonomyLevel',
      'workspacePath',
      'computerUse',
    ])
      expect(source).not.toContain(forbidden)
    const pkg = parseTeamPackage(source)
    expect(pkg.skills).toHaveLength(1)
    expect(pkg.agents.every((a) => a.skills.length === 1)).toBe(true)
    const second = importTeamPackage(db, skills, source, root)
    const exportedAgain = parseTeamPackage(exportTeamPackage(db, skills, second.id))
    expect(exportedAgain.agents.map((a) => a.instructions).sort()).toEqual(
      pkg.agents.map((a) => a.instructions).sort(),
    )
    expect(exportedAgain.skills.map((s) => s.body)).toEqual(pkg.skills.map((s) => s.body))
    expect(exportedAgain.channels[0].goal).toBe(pkg.channels[0].goal)
    expect(exportedAgain.channels[0].instructions).toBe(pkg.channels[0].instructions)
    expect(second.id).not.toBe(first.id)
  })

  it('duas importações não sobrescrevem projeto, agente ou skill existentes', () => {
    const first = importSample()
    skills.revise('revisao', { description: 'Local', body: 'Alteração local' })
    const second = importSample()
    expect(second.name).toBe('Atendimento 2')
    expect(second.workspacePath).not.toBe(first.workspacePath)
    expect(
      db
        .listAgents()
        .filter((a) => a.projectId === second.id)
        .map((a) => a.name)
        .sort(),
    ).toEqual(['Ana 2', 'Bia 2'])
    expect(skills.get('revisao').body).toBe('Alteração local')
    expect(skills.get('revisao-2').body).toBe('Confira os fatos.')
    expect(
      db
        .listChannels()
        .map((c) => c.title)
        .sort(),
    ).toEqual(['Pedidos', 'Pedidos 2'])
  })

  it('não ativa conteúdo importado num agente antigo com vínculo para uma skill ausente', () => {
    const existing = db.createAgent({
      name: 'Antigo',
      provider: 'claude',
      model: 'local',
      workspacePath: '',
    })
    db.setAgentSkills(existing.id, ['revisao'])
    importSample()
    expect(skills.activeFor(existing.id)).toEqual([])
    expect(db.listAgentSkills(existing.id)).toEqual(['revisao'])
    expect(skills.get('revisao-2').body).toBe('Confira os fatos.')
  })

  it('mantém o pacote após reinício do banco e da biblioteca', () => {
    const project = importSample()
    db.close()
    db = new OrchbotDatabase(path.join(dir, 'test.db'), testSecretStorage)
    skills = new SkillService(db, path.join(dir, 'skills'))
    expect(parseTeamPackage(exportTeamPackage(db, skills, project.id)).agents).toHaveLength(2)
    expect(skills.get('revisao').body).toBe('Confira os fatos.')
    expect(db.listChannels()[0].status).toBe('stopped')
  })

  it('exporta Sua Equipe sem coordenador fixo nem canais com participantes de fora', () => {
    const project = importSample()
    const a = db.createAgent({
      name: 'Solto',
      provider: 'claude',
      model: 'local',
      workspacePath: dir,
    })
    const foreman = db.createAgent({
      name: 'Coordenador',
      provider: 'claude',
      model: 'local',
      workspacePath: '',
    })
    db.markForeman(foreman.id)
    db.createChannel({
      title: 'Misto',
      ownerAgentId: a.id,
      memberIds: db
        .listAgents()
        .filter((x) => x.projectId === project.id)
        .map((x) => x.id),
    })
    const pkg = parseTeamPackage(exportTeamPackage(db, skills, null))
    expect(pkg.agents.map((x) => x.name)).toEqual(['Solto'])
    expect(pkg.channels).toEqual([])
    expect(() => exportTeamPackage(db, skills, 'inexistente')).toThrow('Projeto não encontrado')
  })

  it('mascara segredos reconhecidos em instruções e skills ao importar e exportar', () => {
    const pkg = sample()
    pkg.agents[0].instructions = 'password: segredo123'
    pkg.skills[0].body = `token: ghp_${'a'.repeat(36)}`
    const project = importTeamPackage(db, skills, JSON.stringify(pkg), root)
    const source = exportTeamPackage(db, skills, project.id)
    expect(source).toContain('[REDACTED_SECRET]')
    expect(source).not.toContain('segredo123')
    expect(source).not.toContain(`ghp_${'a'.repeat(36)}`)
  })

  it('uma falha no último canal desfaz banco, skills e pastas novas', () => {
    skills.create({ name: 'Preservada', description: 'Local', body: 'não alterar' })
    const before = db.listProjects()
    const pkg = sample()
    pkg.channels.push({ ...pkg.channels[0], title: 'Segundo' })
    vi.spyOn(db, 'createChannel')
      .mockImplementationOnce(db.createChannel.bind(db))
      .mockImplementationOnce(() => {
        throw new Error('disk full')
      })
    expect(() => importTeamPackage(db, skills, JSON.stringify(pkg), root)).toThrow('disk full')
    expect(db.listProjects()).toEqual(before)
    expect(db.listAgents()).toEqual([])
    expect(db.listChannels(true)).toEqual([])
    expect(skills.list().map((s) => s.slug)).toEqual(['preservada'])
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('falha ao gravar uma segunda skill também remove a primeira criada', () => {
    const pkg = sample()
    pkg.skills.push({ key: 'extra', name: 'Extra', description: 'Extra', body: 'Corpo' })
    const create = skills.create.bind(skills)
    vi.spyOn(skills, 'create')
      .mockImplementationOnce(create)
      .mockImplementationOnce(() => {
        throw new Error('sem espaço')
      })
    expect(() => importTeamPackage(db, skills, JSON.stringify(pkg), root)).toThrow('sem espaço')
    expect(skills.list()).toEqual([])
    expect(db.listProjects()).toEqual([])
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('recusa pacote inválido e ausência de provedor antes de criar arquivos', () => {
    expect(() => importTeamPackage(db, skills, '{}', root)).toThrow()
    db.updateConnection({ providerId: 'claude', enabled: false })
    expect(importSample).toThrow('Conecte um provedor')
    expect(fs.existsSync(root)).toBe(false)
    expect(db.listAgents()).toEqual([])
  })

  it.each([
    'accountId',
    'provider',
    'model',
    'workspacePath',
    'autonomyLevel',
    'runtime',
    'browserAccess',
    'localScripts',
    'computerUse',
    'mcpServers',
    'systemRole',
    '__proto__',
  ])('recusa campo de autoridade ou desconhecido no agente: %s', (field) => {
    const pkg = sample()
    const source = JSON.stringify(pkg).replace(
      '"key":"lead"',
      `"${field}":"não importar","key":"lead"`,
    )
    expect(() => importTeamPackage(db, skills, source, root)).toThrow('campo inválido')
    expect(db.listProjects()).toEqual([])
    expect(fs.existsSync(root)).toBe(false)
  })

  it('recusa referências inexistentes, duplicadas, dono fora do canal e versões desconhecidas', () => {
    const invalid = [
      { ...sample(), version: 2 },
      { ...sample(), agents: [] },
      { ...sample(), agents: [sample().agents[0], sample().agents[0]] },
      { ...sample(), skills: [] },
      { ...sample(), channels: [{ ...sample().channels[0], owner: 'fora' }] },
      { ...sample(), channels: [{ ...sample().channels[0], members: ['writer'] }] },
      { ...sample(), channels: [{ ...sample().channels[0], members: ['lead', 'fora'] }] },
      { ...sample(), channels: [{ ...sample().channels[0], members: ['lead', 'lead'] }] },
      { ...sample(), project: { ...sample().project, workspacePath: '/tmp/proibido' } },
      { ...sample(), skills: [{ ...sample().skills[0], files: ['script.sh'] }] },
    ]
    for (const pkg of invalid) expect(() => parseTeamPackage(JSON.stringify(pkg))).toThrow()
    expect(() => parseTeamPackage('null')).toThrow()
    expect(() => parseTeamPackage('não é JSON')).toThrow()
  })

  it('limita tamanho total, quantidade de agentes e tamanho de instruções/skills', () => {
    expect(() => parseTeamPackage(' '.repeat(MAX_TEAM_PACKAGE_BYTES + 1))).toThrow('2 MiB')
    expect(() =>
      parseTeamPackage(JSON.stringify({ ...sample(), agents: Array(21).fill(sample().agents[0]) })),
    ).toThrow('20 itens')
    const pkg = sample()
    pkg.agents[0].instructions = 'x'.repeat(2001)
    expect(() => parseTeamPackage(JSON.stringify(pkg))).toThrow('2000 caracteres')
    pkg.agents[0].instructions = 'válido'
    pkg.skills[0].body = 'á'.repeat(30 * 1024)
    expect(() => parseTeamPackage(JSON.stringify(pkg))).toThrow('40 KiB')
  })
})
