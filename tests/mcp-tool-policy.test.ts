import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportTeamPackage } from '../src/backend/collaboration/team-package'
import { buildDiagnostics } from '../src/backend/diagnostics/diagnostics'
import { acpMcp, claudeMcp, codexMcp } from '../src/backend/mcp/mcp-launch'
import { requireMcpPolicyVersion } from '../src/backend/mcp/policy-version'
import { MemoryService } from '../src/backend/memory/memory-service'
import * as cliAuth from '../src/backend/providers/cli-auth'
import { CodexAdapter } from '../src/backend/providers/codex-adapter'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type { ExecutionOptions, McpLaunchServer } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { SkillService } from '../src/backend/skills/skill-service'
import { OrchbotDatabase } from '../src/backend/storage/db'
import {
  agentAuthority,
  assertMcpToolSupport,
  mcpToolSupport,
  parseMcpToolPolicy,
} from '../src/shared/authority'
import { SUPPORTED_PROVIDERS } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

const cli = fileURLToPath(new URL('./fixtures/session-cli.mjs', import.meta.url))
const mount = (policy?: McpLaunchServer['toolPolicy']): McpLaunchServer => ({
  name: 'mail',
  transport: 'stdio',
  command: 'fake-mcp',
  args: [],
  env: {},
  toolPolicy: policy,
})

describe('contratos de política MCP', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('Codex recebe allow vazio e deny na configuração nativa de cada servidor, inclusive HTTP', () => {
    const args = codexMcp([
      mount({ allow: [], deny: ['send'] }),
      {
        ...mount({ allow: ['read'], deny: ['read'] }),
        name: 'api',
        transport: 'http',
        url: 'https://example.com/mcp',
      },
    ]).args
    expect(args).toContain('mcp_servers.mail.enabled_tools=[]')
    expect(args).toContain('mcp_servers.mail.disabled_tools=["send"]')
    expect(args).toContain('mcp_servers.api.enabled_tools=["read"]')
    expect(args).toContain('mcp_servers.api.disabled_tools=["read"]')
  })
  it('Claude bloqueia nomes MCP exatos sem usar allowedTools, que concederia aprovação', () => {
    const args = claudeMcp([mount({ deny: ['send'] })]).args
    expect(args).toContain('--strict-mcp-config')
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('mcp__mail__send')
    expect(args).not.toContain('--allowedTools')
    expect(() => claudeMcp([mount({ allow: [], deny: [] })])).toThrow('somente a lista de bloqueio')
    expect(() => claudeMcp([mount({ deny: ['read.item'] })])).toThrow('ponto')
    expect(() => acpMcp([mount({ deny: ['send'] })])).toThrow('não aplica')
  })
  it.each([
    null,
    {},
    { deny: '*' },
    { deny: ['send*'] },
    { deny: ['x y'] },
    { deny: ['x()'] },
    { deny: [], native: ['Bash'] },
    { allow: null, deny: [] },
    { deny: Array(129).fill('x') },
  ])('recusa política inválida: %j', (raw) => {
    expect(() => parseMcpToolPolicy(raw)).toThrow()
  })
  it('deduplica nomes sem transformar allow vazio em acesso total', () => {
    expect(parseMcpToolPolicy({ deny: ['send', 'send'] })).toEqual({ deny: ['send'] })
    expect(parseMcpToolPolicy({ allow: [], deny: [] })).toEqual({ allow: [], deny: [] })
  })
  it('descreve todas as engines e não atribui filtro ou sandbox a integrações sem suporte', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      const info = agentAuthority({ provider, autonomyLevel: 'cautious' })
      expect(info.isolation).toContain('não adiciona sandbox')
      if (!['codex', 'claude'].includes(provider))
        expect(() => assertMcpToolSupport(provider, { deny: ['send'] })).toThrow()
    }
    expect(mcpToolSupport('antigravity')).toBe('transport')
    expect(mcpToolSupport('custom:example')).toBe('none')
    expect(agentAuthority({ provider: 'copilot', autonomyLevel: 'cautious' }).approvals).toContain(
      '--allow-all-tools',
    )
    expect(agentAuthority({ provider: 'codex', autonomyLevel: 'cautious' }).approvals).toContain(
      'workspace-write',
    )
    expect(agentAuthority({ provider: 'codex' }).approvals).toContain('herdados')
  })
  it('valida versão sem iniciar prompt e recusa versões antigas ou respostas inconclusivas', async () => {
    for (const version of [
      'codex-cli 0.165.0',
      'v999.0',
      'codex-cli 0.166.0-beta',
      'secret: do-not-echo',
    ]) {
      vi.stubEnv('ORCHBOT_TEST_CLI_VERSION', version)
      await expect(
        requireMcpPolicyVersion('codex', [mount({ allow: [], deny: [] })], { cliPath: cli }),
      ).rejects.toThrow('turno foi bloqueado')
    }
    vi.stubEnv('ORCHBOT_TEST_CLI_VERSION', 'codex-cli 0.166.0')
    await expect(
      requireMcpPolicyVersion('codex', [mount({ deny: ['send'] })], { cliPath: cli }),
    ).resolves.toBeUndefined()
    vi.stubEnv('ORCHBOT_TEST_CLI_VERSION', '2.1.318 (Claude Code)')
    await expect(
      requireMcpPolicyVersion('claude', [mount({ deny: ['send'] })], { cliPath: cli }),
    ).resolves.toBeUndefined()
    await expect(
      requireMcpPolicyVersion('codex', [mount()], { cliPath: '/does-not-exist' }),
    ).resolves.toBeUndefined()
  })
})

describe('persistência e execução com política MCP', () => {
  let dir: string
  let db: OrchbotDatabase
  let queue: QueueManager
  let registry: ProviderRegistry
  let agentId: string
  let serverId: string
  const seen: ExecutionOptions[] = []
  beforeEach(() => {
    seen.length = 0
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-mcp-policy-'))
    db = new OrchbotDatabase(path.join(dir, 'test.db'), testSecretStorage)
    for (const c of db.listConnections())
      db.updateConnection({
        providerId: c.providerId,
        enabled: c.providerId === 'codex',
        ...(c.providerId === 'codex' ? { cliPath: cli } : {}),
      })
    registry = new ProviderRegistry()
    registry.registerAdapter({
      id: 'codex',
      name: 'Mock',
      supportsSessionResume: true,
      checkAvailability: async () => ({ available: true }),
      executeTurn: (_p, opts, cb) => {
        seen.push(opts)
        setTimeout(() => {
          cb.onSessionId?.('11111111-2222-4333-8444-555555555555')
          cb.onDone('feito')
        }, 0)
        return { interrupt() {} }
      },
    })
    queue = new QueueManager(db, registry)
    agentId = db.createAgent({
      name: 'Ana',
      provider: 'codex',
      model: 'local',
      workspacePath: dir,
    }).id
    serverId = db.saveMcpServer({
      name: 'mail',
      transport: 'stdio',
      command: 'fake-mcp',
      env: { TOKEN: 'private-mcp-value' },
    }).id
    db.setAgentMcp(agentId, [serverId])
  })
  afterEach(() => {
    queue.close()
    registry.interruptAll()
    db.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const run = async () => {
    const task = queue.enqueue(agentId, db.listThreads(agentId)[0].id, 'teste')
    await vi.waitFor(() => expect(['completed', 'failed']).toContain(db.getTask(task.id)?.status))
    return db.getTask(task.id)
  }

  it('preserva política ao alternar outro servidor e ao reabrir o banco', () => {
    db.setAgentMcpToolPolicy(agentId, serverId, { allow: ['read'], deny: ['send'] })
    const other = db.saveMcpServer({ name: 'other', transport: 'http', url: 'https://example.com' })
    db.setAgentMcp(agentId, [serverId, other.id])
    expect(db.getAgentMcpLaunch(agentId)[0].toolPolicy).toEqual({ allow: ['read'], deny: ['send'] })
    db.close()
    db = new OrchbotDatabase(path.join(dir, 'test.db'), testSecretStorage)
    expect(
      db.getAgentMcpToolPolicies(agentId).find((p) => p.serverId === serverId)?.policy,
    ).toEqual({ allow: ['read'], deny: ['send'] })
  })
  it('migra vínculos antigos sem trocar suas permissões implícitas', () => {
    queue.close()
    db.close()
    const raw = new DatabaseSync(path.join(dir, 'test.db'))
    raw.exec('ALTER TABLE agent_mcp DROP COLUMN tool_policy')
    raw.close()
    db = new OrchbotDatabase(path.join(dir, 'test.db'), testSecretStorage)
    expect(db.listAgentMcp(agentId)).toEqual([serverId])
    expect(db.getAgentMcpToolPolicies(agentId)[0].policy).toEqual({ deny: [] })
    expect(db.getAgentMcpLaunch(agentId)[0].toolPolicy).toBeUndefined()
  })
  it('não grava regras em servidor não vinculado nem aceita política incompatível com a engine', () => {
    expect(() => db.setAgentMcpToolPolicy(agentId, 'other', { deny: [] })).toThrow('não vinculado')
    db.updateAgent({ id: agentId, provider: 'acp' })
    expect(() => db.setAgentMcpToolPolicy(agentId, serverId, { deny: ['send'] })).toThrow(
      'não aplica',
    )
    expect(db.getAgentMcpToolPolicies(agentId)[0].policy).toEqual({ deny: [] })
  })
  it('trocar a política cria sessão nova e preserva a restrição no turno seguinte', async () => {
    expect((await run())?.status).toBe('completed')
    expect((await run())?.status).toBe('completed')
    expect(seen[1].resumeSessionId).toBeDefined()
    db.setAgentMcpToolPolicy(agentId, serverId, { allow: ['read'], deny: ['send'] })
    expect((await run())?.status).toBe('completed')
    expect(seen[2].resumeSessionId).toBeUndefined()
    expect(seen[2].providerConfig?.mcpServers?.[0].toolPolicy).toEqual({
      allow: ['read'],
      deny: ['send'],
    })
    expect((await run())?.status).toBe('completed')
    expect(seen[3].resumeSessionId).toBeDefined()
  })
  it('o adapter Codex leva o filtro aos processos de início e retomada', async () => {
    registry.registerAdapter(new CodexAdapter())
    db.setAgentMcpToolPolicy(agentId, serverId, { allow: ['read'], deny: ['send'] })
    expect((await run())?.status).toBe('completed')
    expect((await run())?.status).toBe('completed')
    const calls = fs
      .readFileSync(path.join(dir, 'cli-calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.args).toContain('mcp_servers.mail.enabled_tools=["read"]')
      expect(call.args).toContain('mcp_servers.mail.disabled_tools=["send"]')
    }
    expect(calls[1].resume).toBe(calls[0].id)
  })
  it('compactor e curador recebem a mesma política que o turno principal', async () => {
    db.setAgentMcpToolPolicy(agentId, serverId, { deny: ['send'] })
    const compact = vi
      .spyOn(MemoryService.prototype, 'compactIfNeeded')
      .mockResolvedValue(undefined)
    const review = vi.spyOn(MemoryService.prototype, 'maybeReview').mockImplementation(() => {})
    const task = queue.enqueue(agentId, db.listThreads(agentId)[0].id, 'uma tarefa')
    queue.markFromPerson(task.id)
    await vi.waitFor(() => expect(db.getTask(task.id)?.status).toBe('completed'))
    expect(compact.mock.calls[0][0].config.mcpServers?.[0].toolPolicy).toEqual({ deny: ['send'] })
    expect(review.mock.calls[0][0].config.mcpServers?.[0].toolPolicy).toEqual({ deny: ['send'] })
  })
  it('o adapter Claude reaplica deny e configuração estrita ao retomar a sessão', async () => {
    db.updateConnection({ providerId: 'claude', enabled: true, cliPath: cli })
    db.updateAgent({ id: agentId, provider: 'claude' })
    vi.stubEnv('ORCHBOT_TEST_CLI_VERSION', '2.1.318 (Claude Code)')
    db.setAgentMcpToolPolicy(agentId, serverId, { deny: ['send'] })
    expect((await run())?.status).toBe('completed')
    expect((await run())?.status).toBe('completed')
    const calls = fs
      .readFileSync(path.join(dir, 'cli-calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.args).toContain('--strict-mcp-config')
      expect(call.args[call.args.indexOf('--disallowedTools') + 1]).toBe('mcp__mail__send')
      expect(JSON.stringify(call.args)).not.toContain('private-mcp-value')
    }
    expect(calls[1].resume).toBe(calls[0].id)
  })
  it('Claude sem servidores escolhidos usa MCP estrito vazio, sem reativar MCP do perfil', async () => {
    db.updateConnection({ providerId: 'claude', enabled: true, cliPath: cli })
    db.updateAgent({ id: agentId, provider: 'claude' })
    db.setAgentMcp(agentId, [])
    expect((await run())?.status).toBe('completed')
    const call = JSON.parse(fs.readFileSync(path.join(dir, 'cli-calls.jsonl'), 'utf8').trim())
    expect(call.args).toContain('--strict-mcp-config')
    expect(JSON.parse(call.args[call.args.indexOf('--mcp-config') + 1])).toEqual({ mcpServers: {} })
  })
  it('failover de cota para Claude não relaxa uma allowlist exclusiva do Codex', async () => {
    db.setAgentMcpToolPolicy(agentId, serverId, { allow: ['read'], deny: [] })
    db.updateConnection({ providerId: 'claude', enabled: true })
    const executeClaude = vi.fn()
    registry.registerAdapter({
      id: 'claude',
      name: 'Mock Claude',
      checkAvailability: async () => ({ available: true }),
      executeTurn: executeClaude,
    })
    registry.registerAdapter({
      id: 'codex',
      name: 'Quota mock',
      checkAvailability: async () => ({ available: true }),
      executeTurn: (_p, _opts, cb) => {
        setTimeout(() => cb.onError('429 quota exceeded'), 0)
        return { interrupt() {} }
      },
    })
    const task = await run()
    expect(task?.status).toBe('failed')
    expect(task?.error).toContain('somente a lista de bloqueio')
    expect(executeClaude).not.toHaveBeenCalled()
  })
  it('cancelar enquanto verifica a versão não inicia o adapter depois da resposta', async () => {
    db.setAgentMcpToolPolicy(agentId, serverId, { deny: ['send'] })
    let release: (probe: cliAuth.CliProbe) => void = () => {}
    const probe = vi.spyOn(cliAuth, 'runCliProbe').mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const task = queue.enqueue(agentId, db.listThreads(agentId)[0].id, 'não iniciar')
    await vi.waitFor(() => expect(probe).toHaveBeenCalled())
    queue.cancel(task.id)
    release({ stdout: 'codex-cli 0.166.0', stderr: '', code: 0, killed: false })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(seen).toEqual([])
    expect(db.getTask(task.id)?.status).toBe('cancelled')
  })
  it('mudar para engine sem suporte bloqueia o turno antes de chamar o adapter', async () => {
    db.setAgentMcpToolPolicy(agentId, serverId, { deny: ['send'] })
    db.updateConnection({ providerId: 'gemini', enabled: true })
    db.updateAgent({ id: agentId, provider: 'gemini' })
    const execute = vi.fn()
    registry.registerAdapter({
      id: 'gemini',
      name: 'Gemini mock',
      checkAvailability: async () => ({ available: true }),
      executeTurn: execute,
    })
    const task = await run()
    expect(task?.status).toBe('failed')
    expect(task?.error).toContain('não aplica')
    expect(execute).not.toHaveBeenCalled()
  })
  it('versão antiga bloqueia sem executar e sem vazar a resposta do probe', async () => {
    db.setAgentMcpToolPolicy(agentId, serverId, { deny: ['send'] })
    vi.stubEnv('ORCHBOT_TEST_CLI_VERSION', 'private-version-response')
    const task = await run()
    expect(task?.status).toBe('failed')
    expect(task?.error).not.toContain('private-version-response')
    expect(seen).toEqual([])
  })
  it('não muda política nem servidores durante um turno esperando aprovação', () => {
    const task = db.enqueueTask(agentId, db.listThreads(agentId)[0].id, 'pendente')
    db.updateTaskStatus(task.id, 'running')
    expect(() => db.setAgentMcpToolPolicy(agentId, serverId, { deny: ['send'] })).toThrow(
      'Pare o turno',
    )
    expect(() => db.setAgentMcp(agentId, [])).toThrow('Pare o turno')
    expect(db.listAgentMcp(agentId)).toEqual([serverId])
    expect(db.getAgentMcpToolPolicies(agentId)[0].policy).toEqual({ deny: [] })
  })
  it('política corrompida bloqueia a execução mas continua permitindo exportar diagnóstico sem segredos', async () => {
    const raw = new DatabaseSync(path.join(dir, 'test.db'))
    raw.prepare('UPDATE agent_mcp SET tool_policy = ?').run('{"deny":"invalid"}')
    raw.close()
    expect((await run())?.status).toBe('failed')
    expect(seen).toEqual([])
    const report = buildDiagnostics(db, { appVersion: 'test', providers: {} })
    expect(report.agents[0].mcpPolicies.valid).toBe(false)
    expect(JSON.stringify(report)).not.toContain('private-mcp-value')
  })
  it('pacotes de equipe continuam excluindo política e atribuições MCP', () => {
    db.setAgentMcpToolPolicy(agentId, serverId, { deny: ['private_tool_name'] })
    const skills = new SkillService(db, path.join(dir, 'skills'))
    const source = exportTeamPackage(db, skills, null)
    expect(source).not.toContain('private_tool_name')
    expect(source).not.toContain(serverId)
    expect(source).not.toContain('private-mcp-value')
  })
})
