import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderRegistry } from '../src/backend/providers/registry'
import type { ExecutionOptions } from '../src/backend/providers/types'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { SkillService } from '../src/backend/skills/skill-service'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

describe('fila aplica autoridade Docker', () => {
  let dir: string
  let db: OrchbotDatabase
  let queue: QueueManager
  let agentId: string
  let threadId: string
  let seen: ExecutionOptions[]
  let answer: string
  const hostBrowser = vi.fn(async () => 'host browser')
  const hostComputer = vi.fn(async () => 'host computer')
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-docker-queue-'))
    db = new OrchbotDatabase(path.join(dir, 'db'), testSecretStorage)
    db.updateConnection({ providerId: 'codex', apiKey: 'regression-fake-key', enabled: true })
    seen = []
    answer = 'feito'
    const registry = new ProviderRegistry()
    registry.registerAdapter({
      id: 'codex',
      name: 'fake',
      supportsSessionResume: true,
      checkAvailability: async () => ({ available: true }),
      executeTurn: (_prompt, options, callbacks) => {
        seen.push(options)
        setTimeout(() => {
          callbacks.onSessionId?.('11111111-2222-4333-8444-555555555555')
          callbacks.onDone(answer)
        }, 0)
        return { interrupt: () => callbacks.onInterrupted?.() }
      },
    })
    queue = new QueueManager(db, registry)
    queue.setBrowserExecutor(hostBrowser)
    queue.setComputerExecutor(hostComputer)
    const agent = db.createAgent({
      name: 'Isolado',
      provider: 'codex',
      model: 'test',
      workspacePath: dir,
      computerUse: true,
    })
    agentId = agent.id
    threadId = db.listThreads(agentId)[0].id
    db.setAgentRuntime(agentId, 'docker')
    hostBrowser.mockClear()
    hostComputer.mockClear()
  })
  afterEach(() => {
    queue.close()
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const run = async () => {
    const task = queue.enqueue(agentId, threadId, 'Uma tarefa')
    await vi.waitFor(() => expect(['completed', 'failed']).toContain(db.getTask(task.id)?.status))
    return db.getTask(task.id)
  }
  it('inclui browser MCP interno e runtime no turno, nunca retoma uma sessão descartada', async () => {
    expect((await run())?.status).toBe('completed')
    expect((await run())?.status).toBe('completed')
    expect(seen).toHaveLength(2)
    for (const options of seen) {
      expect(options.providerConfig?.docker).toEqual({ workspacePath: dir })
      expect(options.providerConfig?.mcpServers).toEqual([
        expect.objectContaining({ name: 'orchbot_browser', command: 'playwright-mcp' }),
      ])
      expect(options.resumeSessionId).toBeUndefined()
      expect(options.extraDirs).toBeUndefined()
      expect(options.instructions).not.toContain('[USO DO COMPUTADOR]')
    }
  })
  it('recusa MCP stdio do host e não invoca o adapter como fallback', async () => {
    const server = db.saveMcpServer({ name: 'local', transport: 'stdio', command: '/host/tool' })
    db.setAgentMcp(agentId, [server.id])
    expect((await run())?.error).toContain('apenas MCP HTTP')
    expect(seen).toEqual([])
  })
  it('browserAccess desligado remove Playwright e preserva MCP HTTP explícito', async () => {
    db.updateAgent({ id: agentId, browserAccess: false })
    const server = db.saveMcpServer({
      name: 'remote',
      transport: 'http',
      url: 'https://example.invalid/mcp',
    })
    db.setAgentMcp(agentId, [server.id])
    expect((await run())?.status).toBe('completed')
    expect(seen[0].providerConfig?.mcpServers?.map((entry) => entry.name)).toEqual(['remote'])
  })
  it('bloqueia browser/computador do host, mensagens para colegas e cadeia de handoff', async () => {
    const target = db.createAgent({
      name: 'Host',
      provider: 'codex',
      model: 'test',
      workspacePath: dir,
    })
    db.updateAgent({ id: agentId, handoffAgentId: target.id })
    answer =
      '[[BROWSER:open]] https://example.invalid [[/BROWSER]]\n[[COMPUTER:open]] terminal [[/COMPUTER]]\n[[AGENT:send]] Host :: execute no host [[/AGENT]]\nFeito'
    await run()
    await vi.waitFor(() =>
      expect(
        db.listTasks(agentId).every((task) => ['completed', 'failed'].includes(task.status)),
      ).toBe(true),
    )
    expect(hostBrowser).not.toHaveBeenCalled()
    expect(hostComputer).not.toHaveBeenCalled()
    expect(db.listTasks(target.id)).toEqual([])
  })
  it('não usa leitura/espelho do host para seguir symlinks criados no workspace Docker', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-host-secret-'))
    try {
      const secret = path.join(outside, 'secret')
      fs.writeFileSync(secret, 'HOST_ONLY_SECRET')
      fs.symlinkSync(secret, path.join(dir, 'ORCHBOT.md'))
      const mirror = path.join(dir, '.orchbot', 'agent', 'MEMORY.md')
      fs.rmSync(mirror, { force: true })
      fs.symlinkSync(secret, mirror)
      db.addMemory(agentId, 'nova memória')
      expect(fs.readFileSync(secret, 'utf8')).toBe('HOST_ONLY_SECRET')
      await run()
      expect(seen[0].instructions).not.toContain('HOST_ONLY_SECRET')
      const skills = new SkillService(db, path.join(dir, 'library'))
      const isolated = db.getAgent(agentId)
      if (!isolated) throw new Error('Agente ausente')
      expect(
        skills.run(isolated, [{ action: 'install', target: dir, body: '' }]).join(''),
      ).toContain('host não lê')
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('conversa mantém requisito Docker nas continuações e em novos pedidos após troca para host', async () => {
    const first = await run()
    expect(first?.requiredRuntime).toBe('docker')
    db.setAgentRuntime(agentId, 'host')
    const next = await run()
    expect(next?.requiredRuntime).toBe('docker')
    expect(next?.status).toBe('failed')
    expect(seen).toHaveLength(1)
  })
})
