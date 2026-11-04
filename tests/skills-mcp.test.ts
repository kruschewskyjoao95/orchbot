import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claudeMcp, codexMcp } from '../src/backend/mcp/mcp-launch'
import type { ExecutionOptions, McpLaunchServer } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { parseSkillDirectives } from '../src/backend/skills/skill-protocol'
import { SkillService, parseSkillFile } from '../src/backend/skills/skill-service'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { Agent } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

describe('skills locais', () => {
  let db: OrchbotDatabase
  let svc: SkillService
  let tmp: string
  let agent: Agent

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'))
    const bundled = path.join(tmp, 'bundled')
    fs.mkdirSync(path.join(bundled, 'exemplo'), { recursive: true })
    fs.writeFileSync(
      path.join(bundled, 'exemplo', 'SKILL.md'),
      '---\nname: exemplo\ndescription: Skill de exemplo\n---\n\nFaça X.\n',
    )
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    svc = new SkillService(db, path.join(tmp, 'lib'), bundled)
    fs.mkdirSync(path.join(tmp, 'ws'))
    agent = db.createAgent({
      name: 'Ana',
      workspacePath: path.join(tmp, 'ws'),
      provider: 'claude',
      model: 'opus',
    } as never)
  })

  it('cria, revisa com histórico, ativa por agente e remove', () => {
    const s = svc.create({ name: 'Revisão de PR', description: 'Revisa PRs', body: 'Passo 1' })
    expect(s.slug).toBe('revisao-de-pr')
    expect(() => svc.create({ name: 'Revisão de PR', description: 'x', body: 'y' })).toThrow(
      'Já existe',
    )
    const v2 = svc.revise(s.slug, { description: 'Revisa PRs com rigor', body: 'Passo 1 e 2' })
    expect(v2.version).toBe(2)
    expect(fs.existsSync(path.join(tmp, 'lib', s.slug, '.history', 'v1.md'))).toBe(true)
    expect(svc.get(s.slug).body).toBe('Passo 1 e 2')

    db.setAgentSkills(agent.id, [s.slug])
    expect(svc.contextSection(agent.id)).toContain('revisao-de-pr: Revisa PRs com rigor')
    expect(svc.remove(s.slug)).toBe(true)
    expect(db.listAgentSkills(agent.id)).toEqual([])
    expect(() => svc.get('../etc')).toThrow()
  })

  it('catálogo embutido instala offline e marca como instalado', () => {
    expect(svc.catalog()).toEqual([
      { slug: 'exemplo', name: 'exemplo', description: 'Skill de exemplo', installed: false },
    ])
    expect(svc.installBundled('exemplo').source).toBe('bundled')
    expect(svc.catalog()[0].installed).toBe(true)
    expect(() => svc.installBundled('exemplo')).toThrow('Já existe')
  })

  it('instalação de pasta recusa symlinks, pastas sem SKILL.md e descrição ausente', () => {
    const dir = path.join(tmp, 'ws', 'minha')
    fs.mkdirSync(dir)
    expect(() => svc.installFolder(dir)).toThrow('SKILL.md')
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: minha\n---\ncorpo')
    expect(() => svc.installFolder(dir)).toThrow('description')
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: minha\ndescription: d\n---\ncorpo')
    fs.symlinkSync('/etc/hostname', path.join(dir, 'link'))
    expect(() => svc.installFolder(dir)).toThrow('simbólicos')
    fs.rmSync(path.join(dir, 'link'))
    expect(svc.installFolder(dir).slug).toBe('minha')
  })

  it('agente cria, carrega, revisa e instala só o que é dele', () => {
    const run = (text: string) => svc.run(agent, parseSkillDirectives(text))
    const created = run(
      '[[SKILL:create]] Deploy Seguro :: Como publicar\n1. rode os testes [[/SKILL]]',
    )[0]
    expect(created).toContain('proposta')
    expect(created).toContain('aceitar')
    expect(db.listAgentSkills(agent.id)).toEqual([])
    expect(svc.list()).toEqual([])
    const [proposal] = db.listSkillProposals()
    expect(proposal.slug).toBe('deploy-seguro')
    svc.decideProposal(proposal.id, true)
    expect(db.listAgentSkills(agent.id)).toEqual(['deploy-seguro'])
    expect(() => svc.decideProposal(proposal.id, false)).toThrow('já foi respondida')
    expect(run('[[SKILL:load]] deploy-seguro [[/SKILL]]')[0]).toContain('1. rode os testes')
    expect(
      run('[[SKILL:revise]] deploy-seguro :: Publicar\n1. testes\n2. tag [[/SKILL]]')[0],
    ).toContain('revisão')
    expect(svc.get('deploy-seguro').version).toBe(1)
    expect(run('[[SKILL:create]] deploy-seguro :: x\ny [[/SKILL]]')[0]).toContain('já existe')
    const [revision] = db.listSkillProposals()
    svc.decideProposal(revision.id, true)
    expect(svc.get('deploy-seguro').version).toBe(2)
    svc.create({ name: 'Alheia', description: 'd', body: 'b' })
    expect(run('[[SKILL:load]] alheia [[/SKILL]]')[0]).toContain('não está ativa')
    expect(run('[[SKILL:revise]] alheia :: x\ny [[/SKILL]]')[0]).toContain('não está ativa')
    expect(run('[[SKILL:install]] ../../etc [[/SKILL]]')[0]).toMatch(/dentro do seu workspace|erro/)

    const local = path.join(tmp, 'ws', 'pasta')
    fs.mkdirSync(local)
    fs.writeFileSync(path.join(local, 'SKILL.md'), '---\nname: local\ndescription: d\n---\ncorpo')
    expect(run('[[SKILL:install]] pasta [[/SKILL]]')[0]).toContain('proposta')
    expect(svc.list().some((x) => x.slug === 'local')).toBe(false)
    const [install] = db.listSkillProposals()
    svc.decideProposal(install.id, true)
    expect(db.listAgentSkills(agent.id)).toContain('local')
    expect(parseSkillFile('sem cabeçalho').body).toBe('sem cabeçalho')
  })
})

describe('MCP por agente', () => {
  let db: OrchbotDatabase
  let agent: Agent

  beforeEach(() => {
    db = new OrchbotDatabase(':memory:', testSecretStorage)
    agent = db.createAgent({
      name: 'Ana',
      workspacePath: os.tmpdir(),
      provider: 'claude',
      model: 'opus',
    } as never)
  })

  it('guarda segredos criptografados e nunca os devolve à interface', () => {
    const s = db.saveMcpServer({
      name: 'gh',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'x'],
      env: { TOKEN: 'segredo' },
    })
    expect(s.envKeys).toEqual(['TOKEN'])
    expect(JSON.stringify(db.listMcpServers())).not.toContain('segredo')
    const raw = (
      db as unknown as { db: { prepare: (q: string) => { get: () => { secrets: string } } } }
    ).db
      .prepare('SELECT secrets FROM mcp_servers')
      .get().secrets
    expect(raw).not.toContain('segredo')
    // vazio = manter o segredo
    db.saveMcpServer({
      id: s.id,
      name: 'gh',
      transport: 'stdio',
      command: 'npx',
      env: { TOKEN: '' },
    })
    db.setAgentMcp(agent.id, [s.id])
    expect(db.getAgentMcpLaunch(agent.id)[0].env.TOKEN).toBe('segredo')
  })

  it('valida nome, transporte e variáveis reservadas', () => {
    expect(() => db.saveMcpServer({ name: 'a b', transport: 'stdio', command: 'x' })).toThrow(
      'Nome',
    )
    expect(() => db.saveMcpServer({ name: 'a', transport: 'http', url: 'ftp://x' })).toThrow('URL')
    expect(() =>
      db.saveMcpServer({ name: 'a', transport: 'stdio', command: 'x', env: { PATH: '/x' } }),
    ).toThrow('não permitida')
    expect(() =>
      db.saveMcpServer({ name: 'a', transport: 'stdio', command: 'x', env: { NOVO: '' } }),
    ).toThrow('valor')
    db.saveMcpServer({ name: 'a', transport: 'stdio', command: 'x' })
    expect(() => db.saveMcpServer({ name: 'a', transport: 'stdio', command: 'y' })).toThrow(
      'Já existe',
    )
  })

  it('claude e codex: segredo só no ambiente, nunca nos argumentos', () => {
    const servers: McpLaunchServer[] = [
      {
        name: 'gh',
        transport: 'stdio' as const,
        command: 'npx',
        args: ['-y', 'srv'],
        env: { TOKEN: 'segredo' },
      },
      {
        name: 'api',
        transport: 'http' as const,
        url: 'https://x.dev/mcp',
        args: [],
        env: {},
        bearerToken: 'bearer-secreto',
      },
    ]
    const c = claudeMcp(servers)
    expect(c.args.join(' ')).not.toMatch(/segredo|bearer-secreto/)
    expect(c.args).toContain('--strict-mcp-config')
    expect(c.env).toMatchObject({
      ORCHBOT_MCP_0_TOKEN: 'segredo',
      ORCHBOT_MCP_1_BEARER: 'bearer-secreto',
    })
    const cfg = JSON.parse(c.args[c.args.indexOf('--mcp-config') + 1])
    expect(cfg.mcpServers.gh.env.TOKEN).toBe('${ORCHBOT_MCP_0_TOKEN}')
    expect(cfg.mcpServers.api.headers.Authorization).toBe('Bearer ${ORCHBOT_MCP_1_BEARER}')

    const x = codexMcp(servers)
    expect(x.args.join(' ')).not.toMatch(/segredo|bearer-secreto/)
    expect(x.args).toContain('mcp_servers.gh.env_vars=["TOKEN"]')
    expect(x.args).toContain('mcp_servers.api.url="https://x.dev/mcp"')
    expect(x.env).toMatchObject({ TOKEN: 'segredo', ORCHBOT_MCP_1_BEARER: 'bearer-secreto' })
  })

  it('fila injeta skills e MCP no turno do agente', async () => {
    const s = db.saveMcpServer({
      name: 'gh',
      transport: 'stdio',
      command: 'npx',
      env: { TOKEN: 'segredo' },
    })
    db.setAgentMcp(agent.id, [s.id])
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'q-'))
    const skills = new SkillService(db, path.join(tmp, 'lib'))
    skills.create({ name: 'Boa Prática', description: 'Sempre cite fontes', body: 'x' })
    db.setAgentSkills(agent.id, ['boa-pratica'])

    let seen: ExecutionOptions | undefined
    const registry = {
      getAdapter: () => ({
        id: 'claude',
        name: 'mock',
        checkAvailability: async () => ({ available: true }),
        executeTurn: (
          _p: string,
          options: ExecutionOptions,
          cb: { onDone: (t: string) => void },
        ) => {
          seen = options
          setTimeout(() => cb.onDone('ok'), 5)
          return { interrupt: () => {} }
        },
      }),
      registerActiveExecution() {},
      removeActiveExecution() {},
      interruptThread: () => true,
    }
    const queue = new QueueManager(db, registry as never)
    queue.setSkills(skills)
    const task = queue.enqueue(agent.id, db.listThreads(agent.id)[0].id, 'oi')
    await new Promise((r) => setTimeout(r, 200))
    expect(db.getTask(task.id)?.status).toBe('completed')
    expect(seen?.instructions).toContain('boa-pratica: Sempre cite fontes')
    expect(seen?.providerConfig?.mcpServers?.[0].name).toBe('gh')
    expect(seen?.providerConfig?.extraEnv).toEqual({ ORCHBOT_MCP_0_TOKEN: 'segredo' })
    queue.close()
  })

  it('Antigravity (ACP) também recebe os servidores MCP do agente, sem variáveis de ambiente', async () => {
    const s = db.saveMcpServer({ name: 'gh', transport: 'stdio', command: 'npx', env: { T: 'x' } })
    const gemini = db.createAgent({
      name: 'Gemini',
      provider: 'antigravity',
      model: 'gemini-3-pro',
      workspacePath: os.tmpdir(),
    } as never)
    db.setAgentMcp(gemini.id, [s.id])
    let seen: ExecutionOptions | undefined
    const registry = {
      getAdapter: () => ({
        id: 'antigravity',
        name: 'mock',
        checkAvailability: async () => ({ available: true }),
        executeTurn: (
          _p: string,
          options: ExecutionOptions,
          cb: { onDone: (t: string) => void },
        ) => {
          seen = options
          setTimeout(() => cb.onDone('ok'), 5)
          return { interrupt: () => {} }
        },
      }),
      registerActiveExecution() {},
      removeActiveExecution() {},
      interruptThread: () => true,
    }
    const queue = new QueueManager(db, registry as never)
    queue.enqueue(gemini.id, db.listThreads(gemini.id)[0].id, 'oi')
    await vi.waitFor(() => expect(seen).toBeDefined())
    expect(seen?.providerConfig?.mcpServers?.[0].name).toBe('gh')
    expect(seen?.providerConfig?.extraEnv).toBeUndefined()
    queue.close()
  })
})
