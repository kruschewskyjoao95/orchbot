import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { CollaborationService } from '../src/backend/collaboration/collaboration-service'
import { buildGitContext } from '../src/backend/context/git-context'
import { acpMcp } from '../src/backend/mcp/mcp-launch'
import { MemoryService } from '../src/backend/memory/memory-service'
import { resolveAgent } from '../src/backend/orchestration/resolve-agent'
import { AcpAdapter } from '../src/backend/providers/acp-adapter'
import type { McpLaunchServer, ProviderAdapter } from '../src/backend/providers/types'
import { parseClaudeUsage, parseCodexUsage, readCodexContext } from '../src/backend/providers/usage'
import { QueueManager } from '../src/backend/queue/queue-manager'
import { SkillService } from '../src/backend/skills/skill-service'
import { OrchbotDatabase } from '../src/backend/storage/db'
import { testSecretStorage } from './secret-storage-fixture'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pend-'))
const newDb = () => new OrchbotDatabase(':memory:', testSecretStorage)
const mkAgent = (db: OrchbotDatabase, name = 'Ana', workspacePath = os.tmpdir()) =>
  db.createAgent({ name, workspacePath, provider: 'claude', model: 'opus' } as never)

describe('uso real de tokens', () => {
  it('lê o uso do Claude: contexto da última requisição e janela do modelo principal', () => {
    const u = parseClaudeUsage({
      usage: {
        input_tokens: 5,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 900,
        output_tokens: 40,
        iterations: [
          {
            input_tokens: 3,
            cache_read_input_tokens: 500,
            cache_creation_input_tokens: 0,
            output_tokens: 10,
          },
          {
            input_tokens: 2,
            cache_read_input_tokens: 400,
            cache_creation_input_tokens: 100,
            output_tokens: 30,
          },
        ],
      },
      modelUsage: {
        'claude-haiku-5-5': { inputTokens: 10, outputTokens: 5, contextWindow: 200000 },
        'claude-opus-5-5': {
          inputTokens: 5,
          cacheReadInputTokens: 900,
          outputTokens: 40,
          contextWindow: 1000000,
        },
      },
    })
    expect(u).toMatchObject({
      inputTokens: 1005,
      cachedTokens: 900,
      outputTokens: 40,
      contextTokens: 532,
      contextWindow: 1000000,
    })
    expect(parseClaudeUsage({})).toBeUndefined()
  })

  it('o contador do Codex é acumulado: vira consumo por turno e reinicia com nova sessão', () => {
    const db = newDb()
    const agent = mkAgent(db)
    const thread = db.listThreads(agent.id)[0].id
    const cum = (i: number, o: number) =>
      parseCodexUsage({ usage: { input_tokens: i, cached_input_tokens: 0, output_tokens: o } })
    expect(cum(22179, 38)?.cumulative).toBe(true)
    expect(db.perTurnUsage(thread, 's1', cum(22179, 38) as never)).toMatchObject({
      inputTokens: 22179,
      outputTokens: 38,
    })
    expect(db.perTurnUsage(thread, 's1', cum(64471, 170) as never)).toMatchObject({
      inputTokens: 42292,
      outputTokens: 132,
    })
    // sessão nova (ex.: compactação): não subtrai o acumulado da anterior
    expect(db.perTurnUsage(thread, 's2', cum(9000, 20) as never)).toMatchObject({
      inputTokens: 9000,
      outputTokens: 20,
    })
  })

  it('lê o contexto real do arquivo de sessão do Codex', () => {
    const home = tmp()
    const dir = path.join(home, 'sessions', '2026', '11', '03')
    fs.mkdirSync(dir, { recursive: true })
    const id = '01a1a228-ff9e-7553-93f5-3847528d6147'
    const ev = (last: number, total: number) =>
      JSON.stringify({
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: { input_tokens: last, output_tokens: 41 },
            total_token_usage: { input_tokens: total },
            model_context_window: 475000,
          },
        },
      })
    fs.writeFileSync(
      path.join(dir, `rollout-2026-11-03T13-05-58-${id}.jsonl`),
      `${ev(18745, 18745)}\n{"payload":{"type":"outra"}}\n${ev(26794, 64471)}\n`,
    )
    expect(readCodexContext(id, home)).toEqual({ contextTokens: 26835, contextWindow: 475000 })
    expect(readCodexContext('00000000-0000-0000-0000-000000000000', home)).toBeUndefined()
  })

  it('a medição só vale enquanto o turno continuar a mesma sessão nativa', () => {
    const db = newDb()
    const agent = mkAgent(db)
    const thread = db.listThreads(agent.id)[0].id
    const session = '11111111-2222-4333-8444-555555555555'
    db.saveProviderSession(thread, 'claude', 'escopo-a', session)
    const reply = db.addMessage(thread, 'assistant', 'ok')
    db.setMessageUsage(
      reply.id,
      { inputTokens: 150000, outputTokens: 100, contextTokens: 150100, contextWindow: 200000 },
      session,
    )
    const svc = new MemoryService(db)
    const usage = (live: { provider: string; scope?: string }) =>
      svc.contextUsage(thread, 'opus', '9999', live).measured

    expect(usage({ provider: 'claude', scope: 'escopo-a' })).toBe(true)
    expect(usage({ provider: 'claude' })).toBe(true)
    expect(usage({ provider: 'codex' })).toBe(false) // trocou de provedor
    expect(usage({ provider: 'claude', scope: 'escopo-b' })).toBe(false) // outra conta/workspace
    db.saveProviderSession(thread, 'claude', 'escopo-a', '99999999-2222-4333-8444-555555555555')
    expect(usage({ provider: 'claude', scope: 'escopo-a' })).toBe(false) // sessão nova
    db.clearProviderSession(thread)
    expect(usage({ provider: 'claude' })).toBe(false) // sessão reiniciada
  })

  it('compacta pelo contexto medido (mesmo com texto curto) e ignora a medição depois do resumo', async () => {
    const db = newDb()
    const agent = mkAgent(db)
    const thread = db.listThreads(agent.id)[0].id
    for (let i = 0; i < 9; i++) db.addMessage(thread, i % 2 ? 'assistant' : 'user', `m${i}`)
    const last = db.addMessage(thread, 'assistant', 'resposta curta')
    const session = '11111111-2222-4333-8444-555555555555'
    db.saveProviderSession(thread, 'claude', 'escopo', session)
    db.setMessageUsage(
      last.id,
      { inputTokens: 150000, outputTokens: 100, contextTokens: 150100, contextWindow: 200000 },
      session,
    )
    const svc = new MemoryService(db)
    expect(svc.contextUsage(thread, 'opus')).toMatchObject({
      tokens: 150100,
      window: 200000,
      measured: true,
    })

    const adapter = {
      supportsSessionResume: true,
      executeTurn: () => {
        throw new Error('sem modelo')
      },
    }
    const notice = await svc.compactIfNeeded(
      { agent, adapter: adapter as unknown as ProviderAdapter, config: {} },
      thread,
      '9999',
    )
    expect(notice).toContain('compactado')
    expect(svc.contextUsage(thread, 'opus').measured).toBe(false)
  })

  it('o Perfil usa o número real e não conta a mensagem do usuário duas vezes', () => {
    const db = newDb()
    const agent = mkAgent(db)
    const thread = db.listThreads(agent.id)[0].id
    db.addMessage(thread, 'user', 'x'.repeat(4000))
    const a = db.addMessage(thread, 'assistant', 'ok')
    db.setMessageUsage(a.id, { inputTokens: 30000, outputTokens: 500, cachedTokens: 20000 })
    db.addMessage(thread, 'user', 'y'.repeat(360)) // sem uso medido: continua estimado (100)
    const stats = db.getProfileStats()
    expect(stats.measuredTokens).toBe(30500)
    expect(stats.totalTokens).toBe(30500 + 100)
  })
})

describe('MCP em agentes ACP', () => {
  it('converte stdio com env em lista e só envia HTTP se o agente declarar suporte', () => {
    const servers: McpLaunchServer[] = [
      {
        name: 'gh',
        transport: 'stdio' as const,
        command: 'npx',
        args: ['-y', 'x'],
        env: { TOKEN: 's' },
      },
      {
        name: 'api',
        transport: 'http' as const,
        url: 'https://x.dev/mcp',
        args: [],
        env: {},
        bearerToken: 'b',
      },
    ]
    const which = (c: string) => `/usr/bin/${c}`
    expect(acpMcp(servers, {}, which)).toEqual({
      servers: [
        {
          name: 'gh',
          command: '/usr/bin/npx',
          args: ['-y', 'x'],
          env: [{ name: 'TOKEN', value: 's' }],
        },
      ],
      skipped: ['api'],
    })
    expect(acpMcp(servers, { http: true }, which).servers[1]).toEqual({
      type: 'http',
      name: 'api',
      url: 'https://x.dev/mcp',
      headers: [{ name: 'Authorization', value: 'Bearer b' }],
    })
  })

  it('o agente ACP recebe os servidores no session/new e o usuário é avisado dos ignorados', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/acp-agent.mjs', import.meta.url))
    const log = path.join(tmp(), 'wire.log')
    const notices: string[] = []
    const done = new Promise<void>((resolve) => {
      new AcpAdapter().executeTurn(
        'oi',
        {
          workspacePath: process.cwd(),
          providerConfig: {
            cliPath: process.execPath,
            cliArgs: [fixture, 'normal', log],
            mcpServers: [
              {
                name: 'gh',
                transport: 'stdio',
                command: process.execPath,
                args: ['srv.js'],
                env: { TOKEN: 'abc' },
              },
              { name: 'api', transport: 'http', url: 'https://x.dev/mcp', args: [], env: {} },
            ],
          },
        },
        {
          onChunk() {},
          onDone: () => resolve(),
          onError: () => resolve(),
          onNotice: (t) => notices.push(t),
        },
      )
    })
    await done
    const wire = fs
      .readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
    const params = wire.find((m) => m.method === 'session/new')?.params
    expect(params.mcpServers).toEqual([
      {
        name: 'gh',
        command: process.execPath,
        args: ['srv.js'],
        env: [{ name: 'TOKEN', value: 'abc' }],
      },
    ])
    expect(notices.join()).toContain('api')
  })
})

describe('contexto Git', () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=T', ...args], {
      cwd,
      stdio: 'pipe',
    })

  it('traz branch, alterações, commits e (no completo) o diff; fora de um repo devolve null', async () => {
    const dir = tmp()
    git(dir, 'init', '-b', 'principal')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'um\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-m', 'primeiro commit')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'um\ndois api_key=SEGREDO123456\n')
    fs.writeFileSync(path.join(dir, 'novo.txt'), 'x')

    const std = (await buildGitContext(dir, 'padrao')) as string
    expect(std).toContain('Branch: principal')
    expect(std).toContain('M a.txt')
    expect(std).toContain('?? novo.txt')
    expect(std).toContain('primeiro commit')
    expect(std).toContain('Resumo do diff')
    expect(std).not.toContain('+dois')

    const eco = (await buildGitContext(dir, 'economico')) as string
    expect(eco).not.toContain('primeiro commit')

    const full = (await buildGitContext(dir, 'completo')) as string
    expect(full).toContain('+dois')
    expect(full).not.toContain('SEGREDO123456')

    expect(await buildGitContext(tmp(), 'padrao')).toBeNull()
  })

  it('não executa comandos vindos da configuração do repositório (fsmonitor, textconv, filtros)', async () => {
    const dir = tmp()
    git(dir, 'init', '-b', 'main')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'um\n')
    git(dir, 'add', '.')
    git(dir, 'commit', '-m', 'c')
    const marker = path.join(dir, 'PWNED')
    const hook = path.join(dir, 'hook.sh')
    fs.writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 })
    git(dir, 'config', 'core.fsmonitor', hook)
    git(dir, 'config', 'diff.evil.textconv', hook)
    // Filtro clean/process: o git roda em status e diff para comparar o arquivo alterado.
    git(dir, 'config', 'filter.lfs.x.clean', hook)
    git(dir, 'config', 'filter.lfs.x.process', hook)
    fs.writeFileSync(path.join(dir, '.gitattributes'), '*.txt diff=evil filter=lfs.x\n')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'dois\n')
    await buildGitContext(dir, 'completo')
    expect(fs.existsSync(marker)).toBe(false)
  })
})

describe('pendências menores', () => {
  it('nome de agente: só exato (ou id único); pedaço do nome não vale', () => {
    const roster = [
      { id: 'aaaaaaaa-1', name: 'Ana' },
      { id: 'bbbbbbbb-2', name: 'Ana Maria' },
      { id: 'cccccccc-3', name: 'Álvaro' },
    ]
    expect(resolveAgent('a', roster)).toEqual({})
    expect(resolveAgent('An', roster)).toEqual({})
    expect(resolveAgent('ana', roster).match?.id).toBe('aaaaaaaa-1')
    expect(resolveAgent('alvaro', roster).match?.id).toBe('cccccccc-3')
    expect(resolveAgent('cccccccc', roster).match?.id).toBe('cccccccc-3')
    expect(
      resolveAgent('Ana', [
        { id: 'x1', name: 'Ana' },
        { id: 'x2', name: 'ana' },
      ]).ambiguous,
    ).toHaveLength(2)
  })

  it('[[AGENT:send]] com pedaço do nome é recusado', () => {
    const db = newDb()
    const ws = tmp()
    const a = mkAgent(db, 'Bruno', ws)
    mkAgent(db, 'Ana', ws)
    const enq: unknown[] = []
    const svc = new CollaborationService(db, {
      enqueue: (...x) => enq.push(x),
      cancelTask: () => true,
    })
    const run = (target: string) =>
      svc.run(a, { threadId: db.listThreads(a.id)[0].id, depth: 1 }, [
        { kind: 'AGENT', action: 'send', target, body: 'oi' },
      ]).lines[0]
    expect(run('a')).toContain('não encontrado')
    expect(run('An')).toContain('não encontrado')
    expect(run('ana')).toContain('enviado a Ana')
    expect(enq).toHaveLength(1)
  })

  it('mensagens de fora vão para a conversa mais ativa, não a mais antiga', () => {
    const db = newDb()
    const agent = mkAgent(db)
    const first = db.listThreads(agent.id)[0]
    const second = db.createThread(agent.id, 'Outra')
    expect(db.getActiveThread(agent.id)?.id).toBe(second.id)
    db.addMessage(first.id, 'user', 'volta aqui') // atividade recente na primeira
    expect(db.getActiveThread(agent.id)?.id).toBe(first.id)
    const ch = db.createChannel({ title: 'C', ownerAgentId: agent.id })
    db.addMessage(ch.members[0].threadId, 'user', 'canal não conta')
    expect(db.getActiveThread(agent.id)?.id).toBe(first.id)
  })

  it('instalação de skill que falha no meio não deixa nada pela metade', () => {
    const db = newDb()
    const root = tmp()
    const lib = path.join(root, 'lib')
    const svc = new SkillService(db, lib)
    const src = path.join(root, 'minha')
    fs.mkdirSync(src)
    fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: minha\ndescription: d\n---\ncorpo')
    fs.writeFileSync(path.join(src, 'extra.txt'), 'x')
    const spy = vi.spyOn(fs, 'copyFileSync').mockImplementation((from) => {
      if (String(from).endsWith('extra.txt')) throw new Error('disco cheio')
      return undefined
    })
    expect(() => svc.installFolder(src)).toThrow('disco cheio')
    spy.mockRestore()
    expect(fs.readdirSync(lib)).toEqual([])
    expect(svc.installFolder(src).slug).toBe('minha')
    // sobra de uma queda do app é varrida na inicialização
    fs.mkdirSync(path.join(lib, '.staging-abc'))
    new SkillService(db, lib)
    expect(fs.existsSync(path.join(lib, '.staging-abc'))).toBe(false)
  })

  it('a revisão de memórias aparece na conversa com o custo', async () => {
    const db = newDb()
    const agent = mkAgent(db)
    const thread = db.listThreads(agent.id)[0].id
    db.addMessage(thread, 'user', 'prefiro respostas curtas')
    db.addMessage(thread, 'assistant', 'certo')
    const adapter = {
      executeTurn: (
        _p: string,
        _o: unknown,
        cb: { onUsage?: (u: unknown) => void; onDone: (t: string) => void },
      ) => {
        cb.onUsage?.({ inputTokens: 900, outputTokens: 60 })
        setTimeout(() => cb.onDone('{"add":["Usuário prefere respostas curtas"],"forget":[]}'), 5)
        return { interrupt() {} }
      },
    }
    const svc = new MemoryService(db)
    const seen: string[] = []
    for (let i = 0; i < 8; i++)
      svc.maybeReview(
        { agent, adapter: adapter as unknown as ProviderAdapter, config: {} },
        thread,
        (t) => seen.push(t),
      )
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toContain('+1 nova(s)')
    expect(seen[0]).toContain('960 tokens')
    expect(db.listMemories(agent.id)[0].text).toContain('respostas curtas')
  })

  it('uma resposta com vários blocos gera um único turno de continuação', async () => {
    const db = newDb()
    const ws = tmp()
    const agent = mkAgent(db, 'Ana', ws)
    mkAgent(db, 'Bruno', ws)
    let turns = 0
    const registry = {
      getAdapter: () => ({
        id: 'claude',
        name: 'mock',
        checkAvailability: async () => ({ available: true }),
        executeTurn: (_p: string, _o: unknown, cb: { onDone: (t: string) => void }) => {
          turns++
          setTimeout(
            () =>
              cb.onDone(
                turns === 1
                  ? 'vou consultar\n[[MEMORY:search]] pnpm [[/MEMORY]]\n[[AGENT:list]] [[/AGENT]]\n[[SKILL:list]] [[/SKILL]]'
                  : 'pronto',
              ),
            5,
          )
          return { interrupt() {} }
        },
      }),
      registerActiveExecution() {},
      removeActiveExecution() {},
      interruptThread: () => true,
    }
    const queue = new QueueManager(db, registry as never)
    queue.setSkills(new SkillService(db, path.join(tmp(), 'lib')))
    const thread = db.listThreads(agent.id)[0].id
    queue.enqueue(agent.id, thread, 'comece')
    await vi.waitFor(
      () => expect(db.listTasks(agent.id).filter((t) => t.status === 'completed')).toHaveLength(2),
      { timeout: 3000 },
    )
    const tasks = db.listTasks(agent.id)
    expect(tasks).toHaveLength(2) // a original + UMA continuação
    const follow = tasks.find((t) => t.prompt.includes('[RESULTADO'))
    expect(follow?.prompt).toContain('[RESULTADO DA MEMÓRIA]')
    expect(follow?.prompt).toContain('[RESULTADO DOS AGENTES]')
    expect(follow?.prompt).toContain('[RESULTADO DAS SKILLS]')
    expect(turns).toBe(2)
    queue.close()
  })
})
